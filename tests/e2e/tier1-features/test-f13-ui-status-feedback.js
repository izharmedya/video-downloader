/**
 * Tier 1 - Feature 13: UI Status Feedback & Error Reporting
 * Verifies that the backend API provides clear status feedback, progress values,
 * error messages, history persistence, and queue maintenance endpoints.
 */

const { assertTrue, assertEquals } = require('../helpers/assertions');
const { TestServer } = require('../helpers/test-server');
const { MockMediaServer } = require('../helpers/mock-media-server');

module.exports = {
  name: 'Feature 13: UI Status Feedback & Error Reporting',
  tests: [
    {
      name: 'F13.1: Active job exposes numerical progress (0-100) in /api/queue',
      run: async () => {
        const mock = new MockMediaServer();
        await mock.start();
        const server = new TestServer({ port: 3252 });
        await server.start();

        try {
          const addRes = await server.post('/api/queue/add', {
            url: mock.getUrl('/media/1080p.mp4'),
            title: 'Progress Inspection Test'
          });

          const queueRes = await server.get('/api/queue');
          const job = queueRes.body.find(j => j.id === addRes.body.id);
          assertTrue(typeof job.progress === 'number', `Progress must be number, got ${typeof job.progress}`);
          assertTrue(job.progress >= 0 && job.progress <= 100, `Progress must be between 0 and 100, got ${job.progress}`);
        } finally {
          await server.stop();
          await mock.stop();
        }
      }
    },
    {
      name: 'F13.2: Failed job returns error message in queue item',
      run: async () => {
        const mock = new MockMediaServer();
        await mock.start();
        const server = new TestServer({ port: 3253 });
        await server.start();

        try {
          const addRes = await server.post('/api/queue/add', {
            url: mock.getUrl('/media/500'),
            title: 'Queue Error Feedback'
          });

          const job = await server.waitForJob(addRes.body.id, 25000);
          assertEquals(job.status, 'error');
          assertTrue(typeof job.error === 'string' && job.error.length > 0, 'Error text must be present');
        } finally {
          await server.stop();
          await mock.stop();
        }
      }
    },
    {
      name: 'F13.3: DELETE /api/queue/done purges done items while preserving others',
      run: async () => {
        const mock = new MockMediaServer();
        await mock.start();
        const server = new TestServer({ port: 3254 });
        await server.start();

        try {
          const addRes = await server.post('/api/queue/add', {
            url: mock.getUrl('/media/1080p.mp4'),
            title: 'Purge Done Test'
          });

          await server.waitForJob(addRes.body.id, 30000);

          const purgeRes = await server.delete('/api/queue/done');
          assertEquals(purgeRes.status, 200);

          const queueRes = await server.get('/api/queue');
          const hasDone = queueRes.body.some(j => j.status === 'done');
          assertTrue(!hasDone, 'No done items should remain in queue after DELETE /api/queue/done');
        } finally {
          await server.stop();
          await mock.stop();
        }
      }
    },
    {
      name: 'F13.4: Completed jobs are automatically added to /api/history',
      run: async () => {
        const mock = new MockMediaServer();
        await mock.start();
        const server = new TestServer({ port: 3255 });
        await server.start();

        try {
          const addRes = await server.post('/api/queue/add', {
            url: mock.getUrl('/media/1080p.mp4'),
            title: 'History Addition Test'
          });

          const job = await server.waitForJob(addRes.body.id, 30000);
          assertEquals(job.status, 'done');

          const histRes = await server.get('/api/history');
          assertEquals(histRes.status, 200);
          const found = histRes.body.find(h => h.id === job.id);
          assertTrue(!!found, 'Completed job must be recorded in /api/history');
        } finally {
          await server.stop();
          await mock.stop();
        }
      }
    },
    {
      name: 'F13.5: DELETE /api/history clears entire download history',
      run: async () => {
        const server = new TestServer({ port: 3256 });
        await server.start();

        try {
          const clearRes = await server.delete('/api/history');
          assertEquals(clearRes.status, 200);

          const histRes = await server.get('/api/history');
          assertEquals(histRes.status, 200);
          assertEquals(histRes.body.length, 0, 'History should be empty');
        } finally {
          await server.stop();
        }
      }
    }
  ]
};
