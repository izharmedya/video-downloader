/**
 * Tier 1 - Feature 9: Premiere Pro Video Compatibility
 * Verifies that downloaded videos strictly adhere to Adobe Premiere Pro NLE requirements:
 * MP4 container, H.264 High 5.1 (yuv420p), AAC-LC 48kHz audio, and faststart moov atom.
 */

const { assertTrue, assertEquals } = require('../helpers/assertions');
const { TestServer } = require('../helpers/test-server');
const { MockMediaServer } = require('../helpers/mock-media-server');
const { assertPremiereProCompatible, probe, isFaststart } = require('../helpers/media-probe');

module.exports = {
  name: 'Feature 9: Premiere Pro Video Compatibility',
  tests: [
    {
      name: 'F9.1: Video download produces MP4 container format',
      run: async () => {
        const mock = new MockMediaServer();
        await mock.start();
        const server = new TestServer({ port: 3232 });
        await server.start();

        try {
          const addRes = await server.post('/api/queue/add', {
            url: mock.getUrl('/media/4k.webm'),
            title: 'Container MP4 Check'
          });

          const job = await server.waitForJob(addRes.body.id, 45000);
          assertEquals(job.status, 'done');
          const info = probe(job.filename);
          assertTrue(info.format?.format_name.includes('mp4'), `Format must include mp4, got ${info.format?.format_name}`);
        } finally {
          await server.stop();
          await mock.stop();
        }
      }
    },
    {
      name: 'F9.2: Video stream uses H.264 codec and yuv420p pixel format',
      run: async () => {
        const mock = new MockMediaServer();
        await mock.start();
        const server = new TestServer({ port: 3233 });
        await server.start();

        try {
          const addRes = await server.post('/api/queue/add', {
            url: mock.getUrl('/media/4k.webm'),
            title: 'H.264 and yuv420p Check'
          });

          const job = await server.waitForJob(addRes.body.id, 45000);
          assertEquals(job.status, 'done');
          const info = probe(job.filename);
          const vstream = info.streams.find(s => s.codec_type === 'video');
          assertEquals(vstream.codec_name, 'h264', `Video codec must be h264, got ${vstream.codec_name}`);
          assertEquals(vstream.pix_fmt, 'yuv420p', `Pixel format must be yuv420p, got ${vstream.pix_fmt}`);
        } finally {
          await server.stop();
          await mock.stop();
        }
      }
    },
    {
      name: 'F9.3: Video stream profile is High or Main profile',
      run: async () => {
        const mock = new MockMediaServer();
        await mock.start();
        const server = new TestServer({ port: 3234 });
        await server.start();

        try {
          const addRes = await server.post('/api/queue/add', {
            url: mock.getUrl('/media/4k.webm'),
            title: 'Video Profile Check'
          });

          const job = await server.waitForJob(addRes.body.id, 45000);
          assertEquals(job.status, 'done');
          const info = probe(job.filename);
          const vstream = info.streams.find(s => s.codec_type === 'video');
          const profile = (vstream.profile || '').toLowerCase();
          assertTrue(profile.includes('high') || profile.includes('main'), `Profile should be High or Main, got ${vstream.profile}`);
        } finally {
          await server.stop();
          await mock.stop();
        }
      }
    },
    {
      name: 'F9.4: Audio stream uses AAC-LC codec with 48000 Hz sample rate',
      run: async () => {
        const mock = new MockMediaServer();
        await mock.start();
        const server = new TestServer({ port: 3235 });
        await server.start();

        try {
          const addRes = await server.post('/api/queue/add', {
            url: mock.getUrl('/media/4k.webm'),
            title: 'AAC 48k Audio Check'
          });

          const job = await server.waitForJob(addRes.body.id, 45000);
          assertEquals(job.status, 'done');
          const info = probe(job.filename);
          const astream = info.streams.find(s => s.codec_type === 'audio');
          assertTrue(!!astream, 'Audio stream must be present');
          assertEquals(astream.codec_name, 'aac', `Audio codec must be aac, got ${astream.codec_name}`);
          assertEquals(parseInt(astream.sample_rate, 10), 48000, `Sample rate must be 48000 Hz, got ${astream.sample_rate}`);
        } finally {
          await server.stop();
          await mock.stop();
        }
      }
    },
    {
      name: 'F9.5: Top-level moov atom is placed before mdat (+faststart)',
      run: async () => {
        const mock = new MockMediaServer();
        await mock.start();
        const server = new TestServer({ port: 3236 });
        await server.start();

        try {
          const addRes = await server.post('/api/queue/add', {
            url: mock.getUrl('/media/4k.webm'),
            title: 'Faststart Atom Check'
          });

          const job = await server.waitForJob(addRes.body.id, 45000);
          assertEquals(job.status, 'done');
          assertTrue(isFaststart(job.filename), 'moov atom must appear before mdat atom for Premiere Pro streaming');
        } finally {
          await server.stop();
          await mock.stop();
        }
      }
    }
  ]
};
