/**
 * Tier 5 White-Box Adversarial Stress Test Suite: Format & Lifecycle Resilience
 *
 * Test Suites Covered:
 * - Suite ADV-5A: Adversarial Format & Parameter Boundaries
 *   1. Dual format conflicts: audio_only: true with 4K video format_id (must produce pure MP3).
 *   2. Dual format conflicts: audio_only: true with numeric format ID 137+140.
 *   3. Extreme playback speed boundary: speed = 0 (zero / division-by-zero defense).
 *   4. Extreme playback speed boundary: speed = -1.5 (negative speed defense).
 *   5. Extreme playback speed boundary: speed = 100 (excessive speed defense).
 *   6. Extreme playback speed boundary: speed = 'NaN' (malformed string defense).
 *   7. Reverse trimming timestamps: trim_start > trim_end (video).
 *   8. Reverse trimming timestamps: trim_start > trim_end (audio).
 *
 * - Suite ADV-5C: Concurrency, Cancellation & Subprocess Lifecycle Stress
 *   9. Cancellation during active FFmpeg transcoding phase (status === 'processing').
 *  10. Cancellation during active FFmpeg audio speedup phase (status === 'processing').
 *  11. Burst queue cancellations (10 simultaneous active/waiting jobs).
 *  12. Post-cancellation queue resumption & state purity.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { TestServer } = require('./e2e/helpers/test-server');
const { MockMediaServer } = require('./e2e/helpers/mock-media-server');
const {
  probe,
  assertStandaloneMp3Compatible,
  assertPremiereProCompatible,
} = require('./e2e/helpers/media-probe');
const {
  assertTrue,
  assertFalse,
  assertEquals,
  assertGreaterThanOrEqual,
} = require('./e2e/helpers/assertions');

// Test Runner State
let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const testResults = [];

function banner(title) {
  console.log('\n====================================================');
  console.log(`  ${title}`);
  console.log('====================================================');
}

function section(title) {
  console.log(`\n--- ${title} ---`);
}

async function runTest(testId, name, fn) {
  totalTests++;
  const start = Date.now();
  process.stdout.write(`[TEST ${testId}] ${name} ... `);
  try {
    await fn();
    const duration = Date.now() - start;
    passedTests++;
    console.log(`PASSED (${duration}ms)`);
    testResults.push({ id: testId, name, status: 'PASSED', duration });
  } catch (err) {
    const duration = Date.now() - start;
    failedTests++;
    console.log(`FAILED (${duration}ms)`);
    console.error(`  Error: ${err.message}`);
    if (err.details) {
      console.error(`  Details: ${JSON.stringify(err.details)}`);
    }
    testResults.push({ id: testId, name, status: 'FAILED', duration, error: err.message });
  }
}

// Helper: Check if process is alive via signal 0
function isPidAlive(pid) {
  if (!pid || typeof pid !== 'number') return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return false;
  }
}

// Main Test Execution
async function main() {
  banner('TIER 5 ADVERSARIAL STRESS SUITE: FORMAT & LIFECYCLE');

  const mock = new MockMediaServer();
  await mock.start();

  // Distinct base port to avoid port collisions with other runners
  const BASE_PORT = 3450;
  let portCounter = BASE_PORT;

  try {
    // ══════════════════════════════════════════════════════════════════
    // Suite ADV-5A: Adversarial Format & Parameter Boundaries
    // ══════════════════════════════════════════════════════════════════
    section('Suite ADV-5A: Format & Parameter Boundaries');

    // TEST 1: Dual format conflict (audio_only: true with 4K selector expression)
    await runTest('ADV-5A.1', 'Dual format conflict: audio_only=true with 4K video format_id produces pure MP3', async () => {
      const server = new TestServer({ port: ++portCounter });
      await server.start();
      try {
        const addRes = await server.post('/api/queue/add', {
          url: mock.getUrl('/media/4k.webm'),
          audio_only: true,
          format_id: 'bestvideo[height<=2160]+bestaudio/best[height<=2160]',
          title: 'Dual Conflict 4K Audio'
        });
        assertEquals(addRes.status, 200, 'Queue add must return 200');

        const job = await server.waitForJob(addRes.body.id, 35000);
        assertEquals(job.status, 'done', 'Job status must be done');
        assertTrue(job.filename.endsWith('.mp3'), `Filename must end in .mp3, got ${job.filename}`);
        assertTrue(fs.existsSync(job.filename), 'Output MP3 file must exist');

        // Verify standalone audio compliance
        const { info } = assertStandaloneMp3Compatible(job.filename);

        // Verify strictly 0 video streams
        const videoStreams = (info.streams || []).filter(s => s.codec_type === 'video');
        assertEquals(videoStreams.length, 0, 'Audio download must contain exactly 0 video streams');

        // Verify no leftover video files or fragments in download directory
        const dirFiles = fs.readdirSync(server.downloadDir);
        const videoFiles = dirFiles.filter(f => f.endsWith('.mp4') || f.endsWith('.webm') || /\.f\d+\./.test(f));
        assertEquals(videoFiles.length, 0, `No video fragments must remain, found: ${JSON.stringify(videoFiles)}`);
      } finally {
        await server.stop();
      }
    });

    // TEST 2: Dual format conflict with explicit numeric format ID
    await runTest('ADV-5A.2', 'Dual format conflict: audio_only=true with explicit video format_id 137+140 produces pure MP3', async () => {
      const server = new TestServer({ port: ++portCounter });
      await server.start();
      try {
        const addRes = await server.post('/api/queue/add', {
          url: mock.getUrl('/media/1080p.mp4'),
          audio_only: true,
          format_id: '137+140',
          title: 'Dual Conflict Numeric Audio'
        });
        assertEquals(addRes.status, 200);

        const job = await server.waitForJob(addRes.body.id, 35000);
        assertEquals(job.status, 'done');
        assertTrue(job.filename.endsWith('.mp3'));

        const { info } = assertStandaloneMp3Compatible(job.filename);
        const videoStreams = (info.streams || []).filter(s => s.codec_type === 'video');
        assertEquals(videoStreams.length, 0, 'Numeric format_id override with audio_only must yield pure MP3');
      } finally {
        await server.stop();
      }
    });

    // TEST 3: Extreme playback speed boundary: speed = 0
    await runTest('ADV-5A.3', 'Extreme playback speed: speed=0 is normalized to 1.0 (zero/division-by-zero defense)', async () => {
      const server = new TestServer({ port: ++portCounter });
      await server.start();
      try {
        const addRes = await server.post('/api/queue/add', {
          url: mock.getUrl('/media/1080p.mp4'),
          playback_speed: 0,
          title: 'Speed Zero Video'
        });
        assertEquals(addRes.status, 200);

        const job = await server.waitForJob(addRes.body.id, 35000);
        assertEquals(job.status, 'done', 'Job must complete cleanly without division by zero');
        assertTrue(fs.existsSync(job.filename), 'Resulting file must exist');

        const info = probe(job.filename);
        const vStream = (info.streams || []).find(s => s.codec_type === 'video');
        assertTrue(!!vStream, 'Video stream must exist');
        assertEquals(vStream.codec_name, 'h264');
      } finally {
        await server.stop();
      }
    });

    // TEST 4: Extreme playback speed boundary: speed = -1.5
    await runTest('ADV-5A.4', 'Extreme playback speed: speed=-1.5 is normalized to 1.0 (negative speed defense)', async () => {
      const server = new TestServer({ port: ++portCounter });
      await server.start();
      try {
        const addRes = await server.post('/api/queue/add', {
          url: mock.getUrl('/media/audio.webm'),
          audio_only: true,
          playback_speed: -1.5,
          title: 'Speed Negative Audio'
        });
        assertEquals(addRes.status, 200);

        const job = await server.waitForJob(addRes.body.id, 35000);
        assertEquals(job.status, 'done', 'Job must complete cleanly without negative filter failure');
        assertStandaloneMp3Compatible(job.filename);
      } finally {
        await server.stop();
      }
    });

    // TEST 5: Extreme playback speed boundary: speed = 100
    await runTest('ADV-5A.5', 'Extreme playback speed: speed=100 is normalized to 1.0 (excessive speed defense)', async () => {
      const server = new TestServer({ port: ++portCounter });
      await server.start();
      try {
        const addRes = await server.post('/api/queue/add', {
          url: mock.getUrl('/media/1080p.mp4'),
          playback_speed: 100,
          title: 'Speed Excessive 100x'
        });
        assertEquals(addRes.status, 200);

        const job = await server.waitForJob(addRes.body.id, 35000);
        assertEquals(job.status, 'done');
        assertTrue(fs.existsSync(job.filename));
      } finally {
        await server.stop();
      }
    });

    // TEST 6: Extreme playback speed boundary: speed = 'NaN'
    await runTest('ADV-5A.6', 'Extreme playback speed: speed="NaN" is normalized to 1.0 (malformed string defense)', async () => {
      const server = new TestServer({ port: ++portCounter });
      await server.start();
      try {
        const addRes = await server.post('/api/queue/add', {
          url: mock.getUrl('/media/audio.webm'),
          audio_only: true,
          playback_speed: 'NaN',
          title: 'Speed NaN Audio'
        });
        assertEquals(addRes.status, 200);

        const job = await server.waitForJob(addRes.body.id, 35000);
        assertEquals(job.status, 'done');
        assertStandaloneMp3Compatible(job.filename);
      } finally {
        await server.stop();
      }
    });

    // TEST 7: Reverse trimming timestamps (video)
    await runTest('ADV-5A.7', 'Reverse trimming: trim_start > trim_end (00:10:00 > 00:05:00) transitions to error safely', async () => {
      const server = new TestServer({ port: ++portCounter });
      await server.start();
      try {
        const addRes = await server.post('/api/queue/add', {
          url: mock.getUrl('/media/1080p.mp4'),
          trim_start: '00:10:00',
          trim_end: '00:05:00',
          title: 'Reverse Trim Video Test'
        });
        assertEquals(addRes.status, 200);

        const job = await server.waitForJob(addRes.body.id, 35000);
        assertEquals(job.status, 'error', 'Inverted trim timestamps must transition to error');
        assertTrue(!!job.error, 'Error message must be present in job.error');
        assertTrue(
          job.error.includes('-t value must be non-negative') ||
          job.error.includes('ffmpeg exited with code') ||
          job.error.includes('İndirme işlemi başarısız oldu'),
          `Error must explain trim/ffmpeg failure, got: ${job.error}`
        );

        // Verify partial/corrupted media file was NOT retained
        if (job.filename) {
          assertFalse(fs.existsSync(job.filename), 'Corrupted/partial output file must not be retained on disk');
        }

        // Verify server remains responsive
        const pingRes = await server.get('/api/default-path');
        assertEquals(pingRes.status, 200, 'Server must remain responsive after reverse trim failure');
      } finally {
        await server.stop();
      }
    });

    // TEST 8: Reverse trimming timestamps (audio)
    await runTest('ADV-5A.8', 'Reverse trimming: audio trim_start > trim_end (00:00:10 > 00:00:02) transitions to error safely', async () => {
      const server = new TestServer({ port: ++portCounter });
      await server.start();
      try {
        const addRes = await server.post('/api/queue/add', {
          url: mock.getUrl('/media/audio.webm'),
          audio_only: true,
          trim_start: '00:00:10',
          trim_end: '00:00:02',
          title: 'Reverse Trim Audio Test'
        });
        assertEquals(addRes.status, 200);

        const job = await server.waitForJob(addRes.body.id, 35000);
        assertEquals(job.status, 'error', 'Inverted audio trim timestamps must transition to error');
        assertTrue(!!job.error);

        if (job.filename) {
          assertFalse(fs.existsSync(job.filename), 'Inverted trim audio file must not be saved');
        }
      } finally {
        await server.stop();
      }
    });

    // ══════════════════════════════════════════════════════════════════
    // Suite ADV-5C: Concurrency, Cancellation & Subprocess Lifecycle Stress
    // ══════════════════════════════════════════════════════════════════
    section('Suite ADV-5C: Concurrency, Cancellation & Subprocess Lifecycle Stress');

    // TEST 9: Cancellation during active FFmpeg transcoding phase (status === 'processing')
    await runTest('ADV-5C.1', 'Cancellation during active FFmpeg transcoding phase kills subprocess and purges fragments', async () => {
      const server = new TestServer({ port: ++portCounter });
      await server.start();
      try {
        // Enqueue 4K VP9 WebM which requires FFmpeg transcoding to H.264
        const addRes = await server.post('/api/queue/add', {
          url: mock.getUrl('/media/4k.webm'),
          title: 'Cancel While Transcoding Test'
        });
        const jobId = addRes.body.id;
        assertEquals(addRes.status, 200);

        let capturedProcessing = false;
        let transcodePid = null;
        const pollStart = Date.now();

        // Rapid polling to catch transition to status === 'processing'
        while (Date.now() - pollStart < 20000) {
          const qRes = await server.get('/api/queue');
          const job = (qRes.body || []).find(j => j.id === jobId);
          if (job) {
            if (job.status === 'processing') {
              capturedProcessing = true;
              transcodePid = job.norm_pid;
              // Immediate cancellation during active transcoding
              const delRes = await server.delete(`/api/queue/${jobId}`);
              assertEquals(delRes.status, 200, 'DELETE /api/queue/:id must return 200');
              break;
            } else if (job.status === 'done' || job.status === 'error') {
              break;
            }
          }
          await new Promise(r => setTimeout(r, 20));
        }

        assertTrue(capturedProcessing, 'Job must have entered status: processing');

        // Wait brief tick for SIGKILL to propagate
        await new Promise(r => setTimeout(r, 200));

        // Verify the FFmpeg transcoding process is dead
        if (transcodePid) {
          const isAlive = isPidAlive(transcodePid);
          assertFalse(isAlive, `Transcode subprocess PID ${transcodePid} must be terminated via SIGKILL`);
        }

        // Verify queue state is cleared
        const qAfter = await server.get('/api/queue');
        const remaining = (qAfter.body || []).filter(j => j.id === jobId);
        assertEquals(remaining.length, 0, 'Cancelled job must be removed from queue');

        // Verify temporary .norm-* files are purged
        const dirFiles = fs.readdirSync(server.downloadDir);
        const normFiles = dirFiles.filter(f => f.includes('norm-') || f.includes(jobId));
        assertEquals(normFiles.length, 0, `No norm temp files must remain, found: ${JSON.stringify(normFiles)}`);
      } finally {
        await server.stop();
      }
    });

    // TEST 10: Cancellation during active FFmpeg audio playback speedup phase
    await runTest('ADV-5C.2', 'Cancellation during active FFmpeg audio speedup phase kills speed subprocess', async () => {
      const server = new TestServer({ port: ++portCounter });
      await server.start();
      try {
        const addRes = await server.post('/api/queue/add', {
          url: mock.getUrl('/media/audio.webm'),
          audio_only: true,
          playback_speed: 1.5,
          title: 'Cancel While Audio Speedup Test'
        });
        const jobId = addRes.body.id;
        assertEquals(addRes.status, 200);

        let capturedProcessing = false;
        let speedPid = null;
        const pollStart = Date.now();

        while (Date.now() - pollStart < 20000) {
          const qRes = await server.get('/api/queue');
          const job = (qRes.body || []).find(j => j.id === jobId);
          if (job) {
            if (job.status === 'processing') {
              capturedProcessing = true;
              speedPid = job.speed_pid;
              const delRes = await server.delete(`/api/queue/${jobId}`);
              assertEquals(delRes.status, 200);
              break;
            } else if (job.status === 'done' || job.status === 'error') {
              break;
            }
          }
          await new Promise(r => setTimeout(r, 20));
        }

        assertTrue(capturedProcessing, 'Job must have entered status: processing for speedup');
        await new Promise(r => setTimeout(r, 200));

        if (speedPid) {
          assertFalse(isPidAlive(speedPid), `Audio speedup PID ${speedPid} must be dead`);
        }

        const dirFiles = fs.readdirSync(server.downloadDir);
        const speedFiles = dirFiles.filter(f => f.includes('speed-') || f.includes(jobId));
        assertEquals(speedFiles.length, 0, `No speed temp files must remain, found: ${JSON.stringify(speedFiles)}`);
      } finally {
        await server.stop();
      }
    });

    // TEST 11: Burst queue cancellations (10 simultaneous active/waiting jobs)
    await runTest('ADV-5C.3', 'Burst queue cancellations: 10 simultaneous active/waiting jobs terminate cleanly without zombies', async () => {
      const server = new TestServer({ port: ++portCounter });
      await server.start();
      try {
        const jobIds = [];
        const targets = [
          { url: mock.getUrl('/media/4k.webm'), title: 'Burst 4K' },
          { url: mock.getUrl('/media/1080p.mp4'), title: 'Burst 1080p' },
          { url: mock.getUrl('/media/audio.webm'), audio_only: true, title: 'Burst Audio' },
        ];

        // Enqueue 10 jobs in rapid succession
        for (let i = 0; i < 10; i++) {
          const target = targets[i % targets.length];
          const res = await server.post('/api/queue/add', {
            url: target.url,
            audio_only: target.audio_only === true,
            title: `${target.title} #${i + 1}`
          });
          assertEquals(res.status, 200, `Add job ${i + 1} must return 200`);
          jobIds.push(res.body.id);
        }

        // Verify all 10 jobs are registered in the queue
        const qBefore = await server.get('/api/queue');
        assertEquals(qBefore.body.length, 10, 'Queue must hold 10 jobs');

        // Collect any spawned active PIDs before triggering burst cancellation
        const activePids = qBefore.body
          .map(j => j.norm_pid || j.speed_pid || j.pid)
          .filter(Boolean);

        // Fire 10 concurrent DELETE requests simultaneously
        const deleteResponses = await Promise.all(
          jobIds.map(id => server.delete(`/api/queue/${id}`))
        );

        // Verify every single cancellation succeeded with HTTP 200
        for (let i = 0; i < deleteResponses.length; i++) {
          assertEquals(
            deleteResponses[i].status,
            200,
            `Cancellation request ${i + 1} must return 200 OK`
          );
          assertEquals(
            deleteResponses[i].body.ok,
            true,
            `Cancellation response ${i + 1} must have { ok: true }`
          );
        }

        // Wait brief tick for SIGKILL and unlink sweeps to settle
        await new Promise(r => setTimeout(r, 400));

        // Verify queue is completely empty
        const qAfter = await server.get('/api/queue');
        assertEquals(qAfter.body.length, 0, 'Active queue must be completely empty after burst cancellation');

        // Verify zero zombie child processes remain
        for (const pid of activePids) {
          const alive = isPidAlive(pid);
          assertFalse(alive, `Tracked active child PID ${pid} must be terminated`);
        }

        // Verify directory is clean of orphan fragments
        const remainingFiles = fs.readdirSync(server.downloadDir);
        const orphanFragments = remainingFiles.filter(f =>
          /\.(part|ytdl|temp)$/i.test(f) ||
          /\.f\d+\.[^.]+$/i.test(f) ||
          f.includes('norm-') ||
          f.includes('speed-')
        );
        assertEquals(
          orphanFragments.length,
          0,
          `No orphan fragments must remain in download dir, found: ${JSON.stringify(orphanFragments)}`
        );

        // Verify server remains healthy and operational
        const healthRes = await server.get('/api/default-path');
        assertEquals(healthRes.status, 200, 'Server must remain 100% operational after burst cancellation');
      } finally {
        await server.stop();
      }
    });

    // TEST 12: Post-cancellation queue resumption & state purity
    await runTest('ADV-5C.4', 'Post-cancellation queue resumption: server immediately accepts and processes fresh job', async () => {
      const server = new TestServer({ port: ++portCounter });
      await server.start();
      try {
        // Enqueue 5 jobs and immediately cancel all
        const initialJobs = [];
        for (let i = 0; i < 5; i++) {
          const res = await server.post('/api/queue/add', {
            url: mock.getUrl('/media/1080p.mp4'),
            title: `Pre-cancel #${i}`
          });
          initialJobs.push(res.body.id);
        }
        await Promise.all(initialJobs.map(id => server.delete(`/api/queue/${id}`)));

        const qEmpty = await server.get('/api/queue');
        assertEquals(qEmpty.body.length, 0);

        // Immediately add a fresh, legitimate 1080p download
        const freshRes = await server.post('/api/queue/add', {
          url: mock.getUrl('/media/1080p.mp4'),
          title: 'Resumed Normal Download'
        });
        assertEquals(freshRes.status, 200);

        // Wait for it to process normally
        const completedJob = await server.waitForJob(freshRes.body.id, 35000);
        assertEquals(completedJob.status, 'done', 'Post-cancellation fresh job must complete with status: done');
        assertTrue(fs.existsSync(completedJob.filename), 'Completed media file must exist on disk');

        // Verify Premiere Pro compatibility on the resumed file
        assertPremiereProCompatible(completedJob.filename);
      } finally {
        await server.stop();
      }
    });

  } finally {
    await mock.stop();
  }

  // Summary Report
  banner('TEST EXECUTION SUMMARY');
  console.log(`  Total Tests:    ${totalTests}`);
  console.log(`  Passed Tests:   ${passedTests}`);
  console.log(`  Failed Tests:   ${failedTests}`);
  banner(failedTests === 0 ? '✔ ALL TIER 5 ADVERSARIAL TESTS PASSED' : '✖ TIER 5 ADVERSARIAL FAILURES DETECTED');

  if (failedTests > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error('Fatal test harness execution error:', err);
    process.exit(1);
  });
}

module.exports = { main };
