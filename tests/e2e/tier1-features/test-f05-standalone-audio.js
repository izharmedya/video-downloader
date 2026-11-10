/**
 * Tier 1 - Feature 5: Standalone Audio Extraction (MP3)
 * Verifies that standalone audio downloads produce authentic MP3 files
 * with libmp3lame, 44.1 kHz sample rate, high bitrate (>=192k), and ID3v2.3 headers.
 */

const fs = require('fs');
const { assertTrue, assertEquals } = require('../helpers/assertions');
const { TestServer } = require('../helpers/test-server');
const { MockMediaServer } = require('../helpers/mock-media-server');
const { assertStandaloneMp3Compatible, probe, readId3Header } = require('../helpers/media-probe');

module.exports = {
  name: 'Feature 5: Standalone Audio Extraction (MP3)',
  tests: [
    {
      name: 'F5.1: Audio download creates a valid .mp3 file on disk',
      run: async () => {
        const mock = new MockMediaServer();
        await mock.start();
        const server = new TestServer({ port: 3212 });
        await server.start();

        try {
          const addRes = await server.post('/api/queue/add', {
            url: mock.getUrl('/media/audio.webm'),
            audio_only: true,
            format_id: 'bestaudio/best',
            title: 'Test Audio Download'
          });

          assertEquals(addRes.status, 200);
          const job = await server.waitForJob(addRes.body.id, 30000);
          assertEquals(job.status, 'done', `Job should succeed, got ${job.status}: ${job.error}`);
          assertTrue(fs.existsSync(job.filename), `Output file must exist: ${job.filename}`);
          assertTrue(job.filename.endsWith('.mp3'), `Output filename should end with .mp3, got ${job.filename}`);
        } finally {
          await server.stop();
          await mock.stop();
        }
      }
    },
    {
      name: 'F5.2: Extracted audio stream codec is mp3',
      run: async () => {
        const mock = new MockMediaServer();
        await mock.start();
        const server = new TestServer({ port: 3213 });
        await server.start();

        try {
          const addRes = await server.post('/api/queue/add', {
            url: mock.getUrl('/media/audio.webm'),
            audio_only: true,
            title: 'Codec Verification'
          });

          const job = await server.waitForJob(addRes.body.id, 30000);
          assertEquals(job.status, 'done');
          const info = probe(job.filename);
          const astream = (info.streams || []).find(s => s.codec_type === 'audio');
          assertTrue(!!astream, 'Audio stream must be present');
          assertEquals(astream.codec_name, 'mp3', `Expected mp3 codec, got ${astream.codec_name}`);
        } finally {
          await server.stop();
          await mock.stop();
        }
      }
    },
    {
      name: 'F5.3: Extracted audio sample rate is 44100 Hz',
      run: async () => {
        const mock = new MockMediaServer();
        await mock.start();
        const server = new TestServer({ port: 3214 });
        await server.start();

        try {
          const addRes = await server.post('/api/queue/add', {
            url: mock.getUrl('/media/audio.webm'),
            audio_only: true,
            title: 'Sample Rate Verification'
          });

          const job = await server.waitForJob(addRes.body.id, 30000);
          assertEquals(job.status, 'done');
          const info = probe(job.filename);
          const astream = (info.streams || []).find(s => s.codec_type === 'audio');
          assertEquals(parseInt(astream.sample_rate, 10), 44100, `Expected 44100 Hz, got ${astream.sample_rate}`);
        } finally {
          await server.stop();
          await mock.stop();
        }
      }
    },
    {
      name: 'F5.4: Extracted audio bitrate is >= 192 kbps',
      run: async () => {
        const mock = new MockMediaServer();
        await mock.start();
        const server = new TestServer({ port: 3215 });
        await server.start();

        try {
          const addRes = await server.post('/api/queue/add', {
            url: mock.getUrl('/media/audio.webm'),
            audio_only: true,
            title: 'Bitrate Verification'
          });

          const job = await server.waitForJob(addRes.body.id, 30000);
          assertEquals(job.status, 'done');
          const info = probe(job.filename);
          const bitRate = parseInt(info.streams?.[0]?.bit_rate || info.format?.bit_rate || '0', 10);
          assertTrue(bitRate >= 192000, `Expected bitrate >= 192000, got ${bitRate}`);
        } finally {
          await server.stop();
          await mock.stop();
        }
      }
    },
    {
      name: 'F5.5: Extracted MP3 has valid ID3v2.3 header (ID3\\x03)',
      run: async () => {
        const mock = new MockMediaServer();
        await mock.start();
        const server = new TestServer({ port: 3216 });
        await server.start();

        try {
          const addRes = await server.post('/api/queue/add', {
            url: mock.getUrl('/media/audio.webm'),
            audio_only: true,
            title: 'ID3 Header Check'
          });

          const job = await server.waitForJob(addRes.body.id, 30000);
          assertEquals(job.status, 'done');
          const id3 = readId3Header(job.filename);
          assertTrue(!!id3, 'ID3 header must be readable');
          assertEquals(id3.magic, 'ID3');
          assertEquals(id3.version, 3, `Expected ID3v2.3, got version ${id3.version}`);
        } finally {
          await server.stop();
          await mock.stop();
        }
      }
    }
  ]
};
