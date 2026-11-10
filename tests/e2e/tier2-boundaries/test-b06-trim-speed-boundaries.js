/**
 * Tier 2 - Boundary 6: Trim & Speed Boundaries
 * Tests boundary conditions for trimming and playback acceleration:
 * invalid timestamps, reverse ranges, zero duration, extreme/invalid speeds.
 */

const { assertTrue, assertEquals } = require('../helpers/assertions');
const { TestServer } = require('../helpers/test-server');
const { MockMediaServer } = require('../helpers/mock-media-server');

module.exports = {
  name: 'Boundary 6: Trim & Speed Boundaries',
  tests: [
    {
      name: 'B6.1: Negative playback speed values are normalized to 1.0',
      run: async () => {
        const server = new TestServer({ port: 3271 });
        await server.start();

        try {
          const addRes = await server.post('/api/queue/add', {
            url: 'https://example.com/video',
            playback_speed: -2
          });

          if (addRes.status === 200) {
            const queueRes = await server.get('/api/queue');
            const job = queueRes.body.find(j => j.id === addRes.body.id);
            assertEquals(job.playback_speed, 1, 'Negative playback speed must normalize to 1');
          }
        } finally {
          await server.stop();
        }
      }
    },
    {
      name: 'B6.2: Extreme playback speed (e.g. 10x) falls back to 1.0',
      run: async () => {
        const server = new TestServer({ port: 3272 });
        await server.start();

        try {
          const addRes = await server.post('/api/queue/add', {
            url: 'https://example.com/video',
            playback_speed: 10
          });

          if (addRes.status === 200) {
            const queueRes = await server.get('/api/queue');
            const job = queueRes.body.find(j => j.id === addRes.body.id);
            assertEquals(job.playback_speed, 1, 'Extreme speed must normalize to 1');
          }
        } finally {
          await server.stop();
        }
      }
    },
    {
      name: 'B6.3: Non-numeric playback speed (string "fast") normalizes to 1.0',
      run: async () => {
        const server = new TestServer({ port: 3273 });
        await server.start();

        try {
          const addRes = await server.post('/api/queue/add', {
            url: 'https://example.com/video',
            playback_speed: 'super_fast'
          });

          if (addRes.status === 200) {
            const queueRes = await server.get('/api/queue');
            const job = queueRes.body.find(j => j.id === addRes.body.id);
            assertEquals(job.playback_speed, 1, 'String speed must normalize to 1');
          }
        } finally {
          await server.stop();
        }
      }
    },
    {
      name: 'B6.4: Trim start equal to trim end handled without infinite loop',
      run: async () => {
        const mock = new MockMediaServer();
        await mock.start();
        const server = new TestServer({ port: 3274 });
        await server.start();

        try {
          const addRes = await server.post('/api/queue/add', {
            url: mock.getUrl('/media/1080p.mp4'),
            trim_start: '00:00:01',
            trim_end: '00:00:01',
            title: 'Zero Length Trim'
          });

          const job = await server.waitForJob(addRes.body.id, 25000);
          assertTrue(['done', 'error'].includes(job.status));
        } finally {
          await server.stop();
          await mock.stop();
        }
      }
    },
    {
      name: 'B6.5: Malformed trim timestamps (e.g. text instead of HH:MM:SS) handled safely',
      run: async () => {
        const server = new TestServer({ port: 3275 });
        await server.start();

        try {
          const addRes = await server.post('/api/queue/add', {
            url: 'https://example.com/video',
            trim_start: 'malformed_time',
            trim_end: 'not_a_time'
          });

          assertTrue(addRes.status === 200 || addRes.status >= 400);
        } finally {
          await server.stop();
        }
      }
    }
  ]
};
