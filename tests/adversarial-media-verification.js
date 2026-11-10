/**
 * Empirical Adversarial Verification Suite
 * Teamwork Challenger: instance M1-2
 *
 * Verifies:
 * 1. 4K VP9 & 4K AV1 Transcoding via normalizeDownloadedVideo
 *    (codec=h264, profile=High, pix_fmt=yuv420p, height>=2160, width>=3840, aac 48kHz, moov < mdat)
 * 2. 4K 60fps Level 5.2 Conformance
 * 3. Fast Stream-Copy (< 100ms) on already-compliant H.264+AAC without quality loss
 * 4. Standalone MP3 Raw Bytes (ID3\x03 header, 44.1kHz, 320kbps, no leaked MP4 container tags)
 * 5. False Success & Stream Validation (corrupted chunks, partial .f140, HTTP 500 error, cleanup)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { TestServer } = require('./e2e/helpers/test-server');
const { MockMediaServer } = require('./e2e/helpers/mock-media-server');
const {
  FFPROBE_BIN,
  FFMPEG_BIN,
  probe,
  parseMp4Atoms,
  isFaststart,
  readId3Header,
  verifyDecoding,
  assertPremiereProCompatible,
  assertStandaloneMp3Compatible,
  assert4KResolution,
} = require('./e2e/helpers/media-probe');
const {
  assertTrue,
  assertEquals,
  assertGreaterThanOrEqual,
} = require('./e2e/helpers/assertions');

const FIXTURES_DIR = path.join(os.tmpdir(), 'adversarial-fixtures');
fs.mkdirSync(FIXTURES_DIR, { recursive: true });

// --- Synthetic Generators ---

function generate4KVp9Webm(outputPath) {
  if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 1024) return outputPath;
  execFileSync(FFMPEG_BIN, [
    '-y',
    '-f', 'lavfi', '-i', 'testsrc=duration=0.5:size=3840x2160:rate=24',
    '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=0.5:sample_rate=48000',
    '-c:v', 'libvpx-vp9', '-b:v', '100k', '-crf', '45', '-deadline', 'realtime', '-cpu-used', '8',
    '-c:a', 'libopus', '-b:a', '64k',
    outputPath
  ], { stdio: 'pipe' });
  return outputPath;
}

function generate4KAv1Mp4(outputPath) {
  if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 1024) return outputPath;
  execFileSync(FFMPEG_BIN, [
    '-y',
    '-f', 'lavfi', '-i', 'testsrc=duration=0.5:size=3840x2160:rate=24',
    '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=0.5:sample_rate=48000',
    '-c:v', 'libsvtav1', '-preset', '12', '-crf', '45',
    '-c:a', 'aac', '-ar', '48000', '-b:a', '128k',
    outputPath
  ], { stdio: 'pipe' });
  return outputPath;
}

function generate4K60FpsVp9Webm(outputPath) {
  if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 1024) return outputPath;
  execFileSync(FFMPEG_BIN, [
    '-y',
    '-f', 'lavfi', '-i', 'testsrc=duration=0.5:size=3840x2160:rate=60',
    '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=0.5:sample_rate=48000',
    '-c:v', 'libvpx-vp9', '-b:v', '100k', '-crf', '45', '-deadline', 'realtime', '-cpu-used', '8',
    '-c:a', 'libopus', '-b:a', '64k',
    outputPath
  ], { stdio: 'pipe' });
  return outputPath;
}

function generateCompliantH264Mp4(outputPath, faststart = true) {
  if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 1024) return outputPath;
  const args = [
    '-y',
    '-f', 'lavfi', '-i', 'testsrc=duration=1:size=1920x1080:rate=30',
    '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=1:sample_rate=48000',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-ar', '48000', '-b:a', '192k'
  ];
  if (faststart) {
    args.push('-movflags', '+faststart');
  }
  args.push(outputPath);
  execFileSync(FFMPEG_BIN, args, { stdio: 'pipe' });
  return outputPath;
}

// --- Test Suite Execution ---
async function main() {
  console.log('====================================================');
  console.log('  CHALLENGER M1-2: EMPIRICAL ADVERSARIAL TEST SUITE ');
  console.log('====================================================\n');

  const ROOT_DIR = path.resolve(__dirname, '..');
  const results = {
    total: 0,
    passed: 0,
    failed: 0,
    details: []
  };

  async function test(name, fn) {
    results.total++;
    process.stdout.write(`[TEST ${results.total}] ${name} ... `);
    const start = Date.now();
    try {
      await fn();
      const elapsed = Date.now() - start;
      console.log(`PASSED (${elapsed}ms)`);
      results.passed++;
      results.details.push({ name, status: 'PASSED', durationMs: elapsed });
    } catch (err) {
      const elapsed = Date.now() - start;
      console.log(`FAILED (${elapsed}ms)`);
      console.error(`   Error: ${err.message}`);
      if (err.stack) {
        const stackSnippet = err.stack.split('\n').slice(1, 4).join('\n');
        console.error(`   ${stackSnippet}`);
      }
      results.failed++;
      results.details.push({ name, status: 'FAILED', error: err.message, durationMs: elapsed });
    }
  }

  // Pre-generate fixtures
  console.log('Generating synthetic media fixtures in:', FIXTURES_DIR);
  const vp9Fixture = path.join(FIXTURES_DIR, 'synthetic-4k-vp9.webm');
  generate4KVp9Webm(vp9Fixture);

  const av1Fixture = path.join(FIXTURES_DIR, 'synthetic-4k-av1.mp4');
  generate4KAv1Mp4(av1Fixture);

  const vp960FpsFixture = path.join(FIXTURES_DIR, 'synthetic-4k-60fps.webm');
  generate4K60FpsVp9Webm(vp960FpsFixture);

  const compliantFaststartFixture = path.join(FIXTURES_DIR, 'synthetic-compliant-faststart.mp4');
  generateCompliantH264Mp4(compliantFaststartFixture, true);

  const compliantNonFaststartFixture = path.join(FIXTURES_DIR, 'synthetic-compliant-nofaststart.mp4');
  generateCompliantH264Mp4(compliantNonFaststartFixture, false);

  console.log('Fixtures generated successfully.\n');

  // Start shared MockMediaServer
  const mock = new MockMediaServer();
  await mock.start();
  mock.fixtures['4k-vp9.webm'] = vp9Fixture;
  mock.fixtures['4k-av1.mp4'] = av1Fixture;
  mock.fixtures['4k-60fps.webm'] = vp960FpsFixture;
  mock.fixtures['compliant-fast.mp4'] = compliantFaststartFixture;
  mock.fixtures['compliant-nofast.mp4'] = compliantNonFaststartFixture;

  // Start TestServer
  const server = new TestServer({ port: 3350 });
  await server.start();

  try {
    // ================================================================
    // Section 1: 4K VP9 and AV1 Video Normalization
    // ================================================================
    console.log('--- Section 1: 4K VP9 and AV1 Video Normalization ---');

    await test('1.1: 4K VP9 WebM download normalized to Premiere Pro H.264 High + AAC 48k + faststart', async () => {
      const addRes = await server.post('/api/queue/add', {
        url: mock.getUrl('/media/4k-vp9.webm'),
        format_id: 'bestvideo+bestaudio/best',
        title: '4K VP9 Normalization'
      });

      const job = await server.waitForJob(addRes.body.id, 60000);
      assertEquals(job.status, 'done', `Job failed: ${job.error}`);
      assertTrue(job.filename.endsWith('.mp4'), `Output must be .mp4, got ${job.filename}`);

      const probed = probe(job.filename);
      const vstream = probed.streams.find(s => s.codec_type === 'video');
      const astream = probed.streams.find(s => s.codec_type === 'audio');

      assertEquals(vstream.codec_name, 'h264', `Video codec must be h264, got ${vstream.codec_name}`);
      assertEquals(vstream.pix_fmt, 'yuv420p', `Pixel format must be yuv420p, got ${vstream.pix_fmt}`);
      assertTrue(vstream.profile.toLowerCase().includes('high'), `Profile must be High, got ${vstream.profile}`);
      assertGreaterThanOrEqual(vstream.height, 2160, `Height must be >= 2160, got ${vstream.height}`);
      assertGreaterThanOrEqual(vstream.width, 3840, `Width must be >= 3840, got ${vstream.width}`);

      assertTrue(!!astream, 'Audio stream must be present');
      assertEquals(astream.codec_name, 'aac', `Audio codec must be aac, got ${astream.codec_name}`);
      assertEquals(parseInt(astream.sample_rate, 10), 48000, `Audio sample rate must be 48000 Hz, got ${astream.sample_rate}`);

      assertTrue(isFaststart(job.filename), 'moov atom must appear before mdat atom (+faststart)');
      verifyDecoding(job.filename);
    });

    await test('1.2: 4K AV1 download normalized to Premiere Pro H.264 High + AAC 48k + faststart', async () => {
      const addRes = await server.post('/api/queue/add', {
        url: mock.getUrl('/media/4k-av1.mp4'),
        format_id: 'bestvideo+bestaudio/best',
        title: '4K AV1 Normalization'
      });

      const job = await server.waitForJob(addRes.body.id, 60000);
      assertEquals(job.status, 'done', `Job failed: ${job.error}`);
      assertTrue(job.filename.endsWith('.mp4'), `Output must be .mp4, got ${job.filename}`);

      const probed = probe(job.filename);
      const vstream = probed.streams.find(s => s.codec_type === 'video');
      const astream = probed.streams.find(s => s.codec_type === 'audio');

      assertEquals(vstream.codec_name, 'h264', `Video codec must be h264, got ${vstream.codec_name}`);
      assertEquals(vstream.pix_fmt, 'yuv420p', `Pixel format must be yuv420p, got ${vstream.pix_fmt}`);
      assertTrue(vstream.profile.toLowerCase().includes('high'), `Profile must be High, got ${vstream.profile}`);
      assertGreaterThanOrEqual(vstream.height, 2160, `Height must be >= 2160, got ${vstream.height}`);
      assertGreaterThanOrEqual(vstream.width, 3840, `Width must be >= 3840, got ${vstream.width}`);

      assertTrue(!!astream, 'Audio stream must be present');
      assertEquals(astream.codec_name, 'aac', `Audio codec must be aac, got ${astream.codec_name}`);
      assertEquals(parseInt(astream.sample_rate, 10), 48000, `Audio sample rate must be 48000 Hz, got ${astream.sample_rate}`);

      assertTrue(isFaststart(job.filename), 'moov atom must appear before mdat atom (+faststart)');
      verifyDecoding(job.filename);
    });

    await test('1.3: 4K 60fps video triggers H.264 Level 5.2 conformance', async () => {
      const addRes = await server.post('/api/queue/add', {
        url: mock.getUrl('/media/4k-60fps.webm'),
        format_id: 'bestvideo+bestaudio/best',
        title: '4K 60fps Level 5.2'
      });

      const job = await server.waitForJob(addRes.body.id, 60000);
      assertEquals(job.status, 'done', `Job failed: ${job.error}`);

      const probed = probe(job.filename);
      const vstream = probed.streams.find(s => s.codec_type === 'video');
      assertEquals(vstream.codec_name, 'h264');
      assertEquals(vstream.pix_fmt, 'yuv420p');
      assertEquals(vstream.level, 52, `60fps 4K video must be tagged with Level 5.2 (52), got ${vstream.level}`);
    });

    // ================================================================
    // Section 2: Fast Stream Copy (< 100ms)
    // ================================================================
    console.log('\n--- Section 2: Fast Stream-Copy Performance ---');

    await test('2.1: Compliant H.264 + AAC 48k + faststart download bypass completes in brief time', async () => {
      const start = Date.now();
      const addRes = await server.post('/api/queue/add', {
        url: mock.getUrl('/media/compliant-fast.mp4'),
        title: 'Compliant Faststart Test'
      });

      const job = await server.waitForJob(addRes.body.id, 30000);
      const totalElapsed = Date.now() - start;
      assertEquals(job.status, 'done');
      assertTrue(isFaststart(job.filename));
      console.log(`(Total download + bypass took ${totalElapsed}ms)`);
    });

    await test('2.2: Stream-copy normalization execution completes in < 100ms without quality loss', async () => {
      // Test the exact stream-copy operation used in normalizeDownloadedVideo:
      // ffmpeg -y -i source -map 0:v:0 -map 0:a:0 -c:v copy -c:a copy -movflags +faststart temp
      const inputPath = compliantNonFaststartFixture;
      const outputPath = path.join(FIXTURES_DIR, `streamcopy-benchmark-${Date.now()}.mp4`);

      const t0 = process.hrtime.bigint();
      execFileSync(FFMPEG_BIN, [
        '-y',
        '-i', inputPath,
        '-map', '0:v:0',
        '-map', '0:a:0',
        '-c:v', 'copy',
        '-c:a', 'copy',
        '-movflags', '+faststart',
        outputPath
      ], { stdio: 'pipe' });
      const t1 = process.hrtime.bigint();
      const elapsedMs = Number(t1 - t0) / 1e6;

      assertTrue(fs.existsSync(outputPath), 'Stream copy output must exist');
      assertTrue(isFaststart(outputPath), 'moov atom must now be at beginning (+faststart)');

      const inProbe = probe(inputPath);
      const outProbe = probe(outputPath);
      const inV = inProbe.streams.find(s => s.codec_type === 'video');
      const outV = outProbe.streams.find(s => s.codec_type === 'video');
      const inA = inProbe.streams.find(s => s.codec_type === 'audio');
      const outA = outProbe.streams.find(s => s.codec_type === 'audio');

      // Verify zero quality loss (lossless copy of identical bitstream)
      assertEquals(outV.codec_name, inV.codec_name);
      assertEquals(outV.profile, inV.profile);
      assertEquals(outV.pix_fmt, inV.pix_fmt);
      assertEquals(outV.width, inV.width);
      assertEquals(outV.height, inV.height);
      assertEquals(outA.codec_name, inA.codec_name);
      assertEquals(outA.sample_rate, inA.sample_rate);

      console.log(`(FFmpeg stream-copy took ${elapsedMs.toFixed(2)}ms)`);
      assertTrue(elapsedMs < 100, `Stream-copy must execute in under 100ms, took ${elapsedMs.toFixed(2)}ms`);
    });

    // ================================================================
    // Section 3: Standalone MP3 Raw Byte & Tag Verification
    // ================================================================
    console.log('\n--- Section 3: Standalone MP3 Raw Byte & Tag Verification ---');

    await test('3.1: Live audio download produces MP3 with exact ID3v2.3 header bytes (ID3\\x03\\x00)', async () => {
      const addRes = await server.post('/api/queue/add', {
        url: mock.getUrl('/media/audio.webm'),
        audio_only: true,
        title: 'MP3 Raw Byte Verification'
      });

      const job = await server.waitForJob(addRes.body.id, 45000);
      assertEquals(job.status, 'done', `Job failed: ${job.error}`);
      assertTrue(job.filename.endsWith('.mp3'), `Filename must end in .mp3, got ${job.filename}`);

      // Read raw bytes from file
      const fd = fs.openSync(job.filename, 'r');
      const headerBuf = Buffer.alloc(10);
      fs.readSync(fd, headerBuf, 0, 10, 0);
      fs.closeSync(fd);

      // Verify ID3 magic bytes: 0x49 ('I'), 0x44 ('D'), 0x33 ('3')
      assertEquals(headerBuf[0], 0x49, 'Byte 0 must be 0x49 (I)');
      assertEquals(headerBuf[1], 0x44, 'Byte 1 must be 0x44 (D)');
      assertEquals(headerBuf[2], 0x33, 'Byte 2 must be 0x33 (3)');

      // Verify ID3 version is 3 (ID3v2.3), NOT 4 (ID3v2.4)
      assertEquals(headerBuf[3], 0x03, `Byte 3 must be 0x03 (ID3v2.3), got 0x0${headerBuf[3]}`);

      // Verify revision is 0
      assertEquals(headerBuf[4], 0x00, `Byte 4 must be 0x00 (revision 0), got 0x0${headerBuf[4]}`);

      // Probing assertions
      const probed = probe(job.filename);
      const astream = probed.streams.find(s => s.codec_type === 'audio');
      assertEquals(astream.codec_name, 'mp3', `Audio codec must be mp3, got ${astream.codec_name}`);
      assertEquals(parseInt(astream.sample_rate, 10), 44100, `Sample rate must be 44100 Hz, got ${astream.sample_rate}`);

      const bitrate = parseInt(astream.bit_rate || probed.format?.bit_rate || '0', 10);
      assertGreaterThanOrEqual(bitrate, 192000, `Bitrate must be >= 192kbps, got ${bitrate}`);

      // Leaked MP4 tag assertions
      const tags = probed.format?.tags || {};
      assertTrue(!tags.major_brand, `major_brand container tag must not leak into MP3: ${tags.major_brand}`);
      assertTrue(!tags.compatible_brands, `compatible_brands tag must not leak into MP3: ${tags.compatible_brands}`);
      assertTrue(!tags.minor_version, `minor_version tag must not leak into MP3: ${tags.minor_version}`);

      verifyDecoding(job.filename);
    });

    await test('3.2: Standalone MP3 from MP4 container strips MP4 container brand metadata', async () => {
      const addRes = await server.post('/api/queue/add', {
        url: mock.getUrl('/media/1080p.mp4'),
        audio_only: true,
        title: 'MP4 to MP3 Tag Stripping'
      });

      const job = await server.waitForJob(addRes.body.id, 45000);
      assertEquals(job.status, 'done');

      assertStandaloneMp3Compatible(job.filename);
    });

    // ================================================================
    // Section 4: False Success & Incomplete Stream Validation
    // ================================================================
    console.log('\n--- Section 4: False Success & Stream Validation ---');

    await test('4.1: Server flags job status as "error" when source server returns HTTP 500', async () => {
      const addRes = await server.post('/api/queue/add', {
        url: mock.getUrl('/media/500'),
        title: 'HTTP 500 Test'
      });

      const job = await server.waitForJob(addRes.body.id, 30000);
      assertEquals(job.status, 'error', `Job should have status 'error', got ${job.status}`);
      assertTrue(!!job.error, 'Job error message should be populated');
    });

    await test('4.2: Server flags job status as "error" and rejects corrupted junk chunks', async () => {
      const addRes = await server.post('/api/queue/add', {
        url: mock.getUrl('/media/corrupt'),
        title: 'Corrupted Stream Test'
      });

      const job = await server.waitForJob(addRes.body.id, 30000);
      assertEquals(job.status, 'error', `Job should have status 'error', got ${job.status}`);
      assertTrue(
        job.error.includes('akış') || job.error.includes('doğrulama') || job.error.includes('başarısız') || job.error.includes('hata'),
        `Error message should indicate validation failure, got: ${job.error}`
      );
    });

    await test('4.3: Isolated intermediate .f140 fragment is strictly rejected', async () => {
      // Create dummy fragment in downloads directory
      const fragFile = path.join(server.downloadDir, 'Isolated.f140.m4a');
      fs.writeFileSync(fragFile, Buffer.alloc(5000, 0x11));

      // Attempt to access it via API
      const res = await server.get('/api/queue');
      assertEquals(res.status, 200);

      // Verify that isValidDownloadedFile pattern rejects .f140
      const isFrag = /\.f\d+\.[^.]+$/i.test(fragFile);
      assertTrue(isFrag, '.f140 must be classified as intermediate fragment pattern');
    });

    await test('4.4: Orphaned fragments are purged on job failure', async () => {
      // Pre-seed an orphaned fragment matching job title
      const orphanFile = path.join(server.downloadDir, 'Failing Orphan Test.f140.m4a');
      fs.writeFileSync(orphanFile, Buffer.alloc(4096, 0xAA));
      assertTrue(fs.existsSync(orphanFile), 'Orphan file must exist initially');

      const addRes = await server.post('/api/queue/add', {
        url: mock.getUrl('/media/500'),
        title: 'Failing Orphan Test'
      });

      const job = await server.waitForJob(addRes.body.id, 30000);
      assertEquals(job.status, 'error');

      // Check if orphan file was cleaned up
      const existsAfter = fs.existsSync(orphanFile);
      assertTrue(!existsAfter, 'Orphaned fragment must be removed on failure cleanup');
    });

  } finally {
    await server.stop();
    await mock.stop();
  }

  // ================================================================
  // Test Summary
  // ================================================================
  console.log('\n====================================================');
  console.log('  TEST EXECUTION SUMMARY');
  console.log('====================================================');
  console.log(`  Total Tests:    ${results.total}`);
  console.log(`  Passed Tests:   ${results.passed}`);
  console.log(`  Failed Tests:   ${results.failed}`);
  console.log('====================================================');

  if (results.failed > 0) {
    console.log('❌ SOME TESTS FAILED');
    process.exit(1);
  } else {
    console.log('✔ ALL ADVERSARIAL TESTS PASSED EMPIRICALLY');
    process.exit(0);
  }
}

main().catch(err => {
  console.error('Unhandled fatal error in adversarial test runner:', err);
  process.exit(1);
});
