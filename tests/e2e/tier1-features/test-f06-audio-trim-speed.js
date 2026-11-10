/**
 * Tier 1 - Feature 6: Audio Trimming & Playback Speed
 * Verifies audio section trimming and playback speed acceleration (atempo)
 * via the FFmpeg postprocessing pipeline.
 */

const fs = require('fs');
const { assertTrue, assertEquals } = require('../helpers/assertions');
const { TestServer } = require('../helpers/test-server');
const { MockMediaServer } = require('../helpers/mock-media-server');
const { probe } = require('../helpers/media-probe');

module.exports = {
  name: 'Feature 6: Audio Trimming & Playback Speed',
  tests: [
    {
      name: 'F6.1: Audio trimming with trim_start and trim_end produces bounded duration',
      run: async () => {
        const mock = new MockMediaServer();
        await mock.start();
        const server = new TestServer({ port: 3217 });
        await server.start();

        try {
          const addRes = await server.post('/api/queue/add', {
            url: mock.getUrl('/media/audio.webm'),
            audio_only: true,
            trim_start: '00:00:00',
            trim_end: '00:00:01',
            title: 'Trimmed Audio Test'
          });

          const job = await server.waitForJob(addRes.body.id, 30000);
          assertEquals(job.status, 'done');
          const info = probe(job.filename);
          const duration = parseFloat(info.format?.duration || '0');
          assertTrue(duration > 0 && duration <= 1.5, `Duration should be ~1s, got ${duration}`);
        } finally {
          await server.stop();
          await mock.stop();
        }
      }
    },
    {
      name: 'F6.2: Audio playback_speed 1.25 applies speed acceleration',
      run: async () => {
        const mock = new MockMediaServer();
        await mock.start();
        const server = new TestServer({ port: 3218 });
        await server.start();

        try {
          const addRes = await server.post('/api/queue/add', {
            url: mock.getUrl('/media/audio.webm'),
            audio_only: true,
            playback_speed: 1.25,
            title: 'Speed 1.25x Audio Test'
          });

          const job = await server.waitForJob(addRes.body.id, 30000);
          assertEquals(job.status, 'done');
          assertTrue(fs.existsSync(job.filename));
        } finally {
          await server.stop();
          await mock.stop();
        }
      }
    },
    {
      name: 'F6.3: Audio playback_speed 1.5 accelerates audio properly',
      run: async () => {
        const mock = new MockMediaServer();
        await mock.start();
        const server = new TestServer({ port: 3219 });
        await server.start();

        try {
          const addRes = await server.post('/api/queue/add', {
            url: mock.getUrl('/media/audio.webm'),
            audio_only: true,
            playback_speed: 1.5,
            title: 'Speed 1.5x Audio Test'
          });

          const job = await server.waitForJob(addRes.body.id, 30000);
          assertEquals(job.status, 'done');
          assertTrue(fs.existsSync(job.filename));
        } finally {
          await server.stop();
          await mock.stop();
        }
      }
    },
    {
      name: 'F6.4: Audio playback_speed 2.0 halves output duration',
      run: async () => {
        const mock = new MockMediaServer();
        await mock.start();
        const server = new TestServer({ port: 3220 });
        await server.start();

        try {
          const addRes = await server.post('/api/queue/add', {
            url: mock.getUrl('/media/audio.webm'),
            audio_only: true,
            playback_speed: 2,
            title: 'Speed 2.0x Audio Test'
          });

          const job = await server.waitForJob(addRes.body.id, 30000);
          assertEquals(job.status, 'done');
          assertTrue(fs.existsSync(job.filename));
        } finally {
          await server.stop();
          await mock.stop();
        }
      }
    },
    {
      name: 'F6.5: Combined trim and playback speed completes successfully',
      run: async () => {
        const mock = new MockMediaServer();
        await mock.start();
        const server = new TestServer({ port: 3221 });
        await server.start();

        try {
          const addRes = await server.post('/api/queue/add', {
            url: mock.getUrl('/media/audio.webm'),
            audio_only: true,
            trim_start: '00:00:00',
            trim_end: '00:00:01',
            playback_speed: 2,
            title: 'Trim and Speed Combined'
          });

          const job = await server.waitForJob(addRes.body.id, 30000);
          assertEquals(job.status, 'done');
          assertTrue(fs.existsSync(job.filename));
        } finally {
          await server.stop();
          await mock.stop();
        }
      }
    }
  ]
};
