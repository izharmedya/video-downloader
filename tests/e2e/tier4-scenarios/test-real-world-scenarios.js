/**
 * Tier 4 - Real-World Application Scenarios
 * Simulates realistic end-user workflows from start to finish:
 * 1. 4K Video Download for Premiere Pro NLE Import
 * 2. Standalone MP3 Podcast Extraction for Apple Music / QuickTime
 * 3. Video Highlight Clip Trimming
 * 4. Lecture 2x Playback Speed Acceleration
 * 5. Batch Queueing & Multi-Item Sequential Processing
 * 6. Mid-Stream Cancellation, Cleanup, and Job Retry
 * 7. Custom Media Archiving, Thumbnail Fetch, and Finder Access
 */

const fs = require('fs');
const path = require('path');
const { assertTrue, assertFalse, assertEquals, assertGreaterThan } = require('../helpers/assertions');
const { TestServer } = require('../helpers/test-server');
const { MockMediaServer } = require('../helpers/mock-media-server');
const {
  assertPremiereProCompatible,
  assertStandaloneMp3Compatible,
  assert4KResolution,
  probe,
} = require('../helpers/media-probe');

module.exports = {
  name: 'Tier 4: Real-World Application Scenarios',
  tests: [
    {
      name: 'Scenario 1: 4K UHD Video Download & Adobe Premiere Pro Import Verification',
      run: async () => {
        const mock = new MockMediaServer();
        await mock.start();
        const server = new TestServer({ port: 3351 });
        await server.start();

        try {
          // 1. Fetch info for 4K video
          const infoRes = await server.post('/api/info', { url: mock.getUrl('/media/4k.webm') });
          assertEquals(infoRes.status, 200);

          // 2. Queue 4K download
          const addRes = await server.post('/api/queue/add', {
            url: mock.getUrl('/media/4k.webm'),
            format_id: 'bestvideo[height<=2160]+bestaudio/best[height<=2160]',
            title: '4K Drone Footage'
          });
          assertEquals(addRes.status, 200);

          // 3. Wait for download and transcode to finish
          const job = await server.waitForJob(addRes.body.id, 60000);
          assertEquals(job.status, 'done', `Download failed: ${job.error}`);

          // 4. Assert strict Premiere Pro compatibility & 4K dimensions
          assertPremiereProCompatible(job.filename);
          assert4KResolution(job.filename);
        } finally {
          await server.stop();
          await mock.stop();
        }
      }
    },
    {
      name: 'Scenario 2: Standalone MP3 Podcast Extraction for Apple Music & QuickTime',
      run: async () => {
        const mock = new MockMediaServer();
        await mock.start();
        const server = new TestServer({ port: 3352 });
        await server.start();

        try {
          // 1. Queue audio extraction
          const addRes = await server.post('/api/queue/add', {
            url: mock.getUrl('/media/audio.webm'),
            audio_only: true,
            title: 'Tech Podcast Episode 101'
          });
          assertEquals(addRes.status, 200);

          // 2. Wait for audio extraction
          const job = await server.waitForJob(addRes.body.id, 45000);
          assertEquals(job.status, 'done', `Audio extraction failed: ${job.error}`);

          // 3. Assert universal MP3 playback compatibility
          assertStandaloneMp3Compatible(job.filename);
        } finally {
          await server.stop();
          await mock.stop();
        }
      }
    },
    {
      name: 'Scenario 3: Video Highlight Clip Trimming with Custom Start/End Timestamps',
      run: async () => {
        const mock = new MockMediaServer();
        await mock.start();
        const server = new TestServer({ port: 3353 });
        await server.start();

        try {
          // 1. Download only a 1-second segment (00:00:00 to 00:00:01)
          const addRes = await server.post('/api/queue/add', {
            url: mock.getUrl('/media/1080p.mp4'),
            trim_start: '00:00:00',
            trim_end: '00:00:01',
            title: 'Goal Highlight Clip'
          });

          const job = await server.waitForJob(addRes.body.id, 45000);
          assertEquals(job.status, 'done');

          // 2. Assert bounded duration
          const info = probe(job.filename);
          const dur = parseFloat(info.format?.duration || '0');
          assertTrue(dur > 0 && dur <= 1.5, `Trimmed clip duration should be ~1s, got ${dur}`);
        } finally {
          await server.stop();
          await mock.stop();
        }
      }
    },
    {
      name: 'Scenario 4: Educational Lecture 2x Playback Speed Acceleration',
      run: async () => {
        const mock = new MockMediaServer();
        await mock.start();
        const server = new TestServer({ port: 3354 });
        await server.start();

        try {
          // 1. Queue video with 2x playback speed
          const addRes = await server.post('/api/queue/add', {
            url: mock.getUrl('/media/1080p.mp4'),
            playback_speed: 2,
            title: 'Computer Science Lecture'
          });

          const job = await server.waitForJob(addRes.body.id, 45000);
          assertEquals(job.status, 'done');
          assertTrue(fs.existsSync(job.filename));

          // 2. Assert file is playable
          const { verifyDecoding } = require('../helpers/media-probe');
          assertTrue(verifyDecoding(job.filename));
        } finally {
          await server.stop();
          await mock.stop();
        }
      }
    },
    {
      name: 'Scenario 5: Batch Queueing & Multi-Item Sequential Processing',
      run: async () => {
        const mock = new MockMediaServer();
        await mock.start();
        const server = new TestServer({ port: 3355, env: { MAX_CONCURRENT: '2' } });
        await server.start();

        try {
          // Add 4 mixed items
          const ids = [];
          for (let i = 1; i <= 4; i++) {
            const isAudio = i % 2 === 0;
            const res = await server.post('/api/queue/add', {
              url: mock.getUrl(isAudio ? '/media/audio.webm' : '/media/1080p.mp4'),
              audio_only: isAudio,
              title: `Batch Item ${i}`
            });
            assertEquals(res.status, 200);
            ids.push(res.body.id);
          }

          // Wait for all 4 jobs to complete
          for (const id of ids) {
            const job = await server.waitForJob(id, 60000);
            assertEquals(job.status, 'done');
          }

          // Purge completed jobs
          const purgeRes = await server.delete('/api/queue/done');
          assertEquals(purgeRes.status, 200);

          const queueRes = await server.get('/api/queue');
          assertEquals(queueRes.body.length, 0, 'Queue should be empty after purge');
        } finally {
          await server.stop();
          await mock.stop();
        }
      }
    },
    {
      name: 'Scenario 6: Mid-Stream Download Cancellation, Cleanup, and Immediate Job Retry',
      run: async () => {
        const mock = new MockMediaServer();
        await mock.start();
        const server = new TestServer({ port: 3356 });
        await server.start();

        try {
          // 1. Start slow download
          const addRes1 = await server.post('/api/queue/add', {
            url: mock.getUrl('/media/slow'),
            title: 'Slow Download to Cancel'
          });

          await new Promise(r => setTimeout(r, 600));

          // 2. Cancel running job
          const delRes = await server.delete(`/api/queue/${addRes1.body.id}`);
          assertEquals(delRes.status, 200);

          // 3. Immediately start a new download to verify system cleanly recovered
          const addRes2 = await server.post('/api/queue/add', {
            url: mock.getUrl('/media/1080p.mp4'),
            title: 'Retry Download'
          });

          const job2 = await server.waitForJob(addRes2.body.id, 45000);
          assertEquals(job2.status, 'done');
          assertTrue(fs.existsSync(job2.filename));
        } finally {
          await server.stop();
          await mock.stop();
        }
      }
    },
    {
      name: 'Scenario 7: Custom Media Archiving, Thumbnail Fetch, and File Download Stream',
      run: async () => {
        const mock = new MockMediaServer();
        await mock.start();
        const server = new TestServer({ port: 3357 });
        await server.start();

        try {
          // 1. Download video with custom name
          const addRes = await server.post('/api/queue/add', {
            url: mock.getUrl('/media/1080p.mp4'),
            custom_name: 'Documentary_B-Roll_Scene_1',
            title: 'Documentary Scene'
          });

          const job = await server.waitForJob(addRes.body.id, 45000);
          assertEquals(job.status, 'done');
          assertTrue(path.basename(job.filename).startsWith('Documentary_B-Roll_Scene_1'));

          // 2. Access downloaded file via GET /api/download/:id
          const dlRes = await server.get(`/api/download/${job.id}`);
          assertEquals(dlRes.status, 200);
          assertTrue(dlRes.raw.length > 1000, 'File download stream should return file content');
        } finally {
          await server.stop();
          await mock.stop();
        }
      }
    }
  ]
};
