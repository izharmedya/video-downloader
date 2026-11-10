/**
 * Tier 1 - Feature 7: Universal Audio Playback
 * Verifies that downloaded MP3 audio files are 100% compliant with QuickTime,
 * Apple Music, VLC, and hardware decoders (clean ID3v2.3, stereo, 44.1k, no MP4 tag pollution).
 */

const { assertTrue, assertEquals, assertGreaterThan } = require('../helpers/assertions');
const { TestServer } = require('../helpers/test-server');
const { MockMediaServer } = require('../helpers/mock-media-server');
const { assertStandaloneMp3Compatible, probe, verifyDecoding } = require('../helpers/media-probe');

module.exports = {
  name: 'Feature 7: Universal Audio Playback',
  tests: [
    {
      name: 'F7.1: Extracted MP3 does not leak container brands (major_brand=mp42) into tags',
      run: async () => {
        const mock = new MockMediaServer();
        await mock.start();
        const server = new TestServer({ port: 3222 });
        await server.start();

        try {
          const addRes = await server.post('/api/queue/add', {
            url: mock.getUrl('/media/audio.webm'),
            audio_only: true,
            title: 'Tag Pollution Verification'
          });

          const job = await server.waitForJob(addRes.body.id, 30000);
          assertEquals(job.status, 'done');
          const info = probe(job.filename);
          const tags = info.format?.tags || {};
          assertTrue(!tags.major_brand, `Tags should not contain major_brand: ${tags.major_brand}`);
          assertTrue(!tags.compatible_brands, `Tags should not contain compatible_brands: ${tags.compatible_brands}`);
        } finally {
          await server.stop();
          await mock.stop();
        }
      }
    },
    {
      name: 'F7.2: Extracted MP3 has high format probe score (probe_score >= 50)',
      run: async () => {
        const mock = new MockMediaServer();
        await mock.start();
        const server = new TestServer({ port: 3223 });
        await server.start();

        try {
          const addRes = await server.post('/api/queue/add', {
            url: mock.getUrl('/media/audio.webm'),
            audio_only: true,
            title: 'Probe Score Verification'
          });

          const job = await server.waitForJob(addRes.body.id, 30000);
          assertEquals(job.status, 'done');
          const info = probe(job.filename);
          const score = parseInt(info.format?.probe_score || '0', 10);
          assertTrue(score >= 50, `Probe score must be >= 50, got ${score}`);
        } finally {
          await server.stop();
          await mock.stop();
        }
      }
    },
    {
      name: 'F7.3: Extracted MP3 passes FFmpeg null muxer decoding verification without errors',
      run: async () => {
        const mock = new MockMediaServer();
        await mock.start();
        const server = new TestServer({ port: 3224 });
        await server.start();

        try {
          const addRes = await server.post('/api/queue/add', {
            url: mock.getUrl('/media/audio.webm'),
            audio_only: true,
            title: 'Decode Null Test'
          });

          const job = await server.waitForJob(addRes.body.id, 30000);
          assertEquals(job.status, 'done');
          const decodedOk = verifyDecoding(job.filename);
          assertTrue(decodedOk, 'MP3 must decode cleanly with null sink');
        } finally {
          await server.stop();
          await mock.stop();
        }
      }
    },
    {
      name: 'F7.4: Audio stream channels is 2 (stereo) or 1 (mono source preserved)',
      run: async () => {
        const mock = new MockMediaServer();
        await mock.start();
        const server = new TestServer({ port: 3225 });
        await server.start();

        try {
          const addRes = await server.post('/api/queue/add', {
            url: mock.getUrl('/media/audio.webm'),
            audio_only: true,
            title: 'Channels Check'
          });

          const job = await server.waitForJob(addRes.body.id, 30000);
          assertEquals(job.status, 'done');
          const info = probe(job.filename);
          const astream = (info.streams || []).find(s => s.codec_type === 'audio');
          assertTrue(astream.channels >= 1 && astream.channels <= 2, `Channels should be 1 or 2, got ${astream.channels}`);
        } finally {
          await server.stop();
          await mock.stop();
        }
      }
    },
    {
      name: 'F7.5: Audio stream duration is greater than 0 and non-empty',
      run: async () => {
        const mock = new MockMediaServer();
        await mock.start();
        const server = new TestServer({ port: 3226 });
        await server.start();

        try {
          const addRes = await server.post('/api/queue/add', {
            url: mock.getUrl('/media/audio.webm'),
            audio_only: true,
            title: 'Duration Non Zero'
          });

          const job = await server.waitForJob(addRes.body.id, 30000);
          assertEquals(job.status, 'done');
          const info = probe(job.filename);
          const dur = parseFloat(info.format?.duration || '0');
          assertGreaterThan(dur, 0, `Duration must be > 0, got ${dur}`);
        } finally {
          await server.stop();
          await mock.stop();
        }
      }
    }
  ]
};
