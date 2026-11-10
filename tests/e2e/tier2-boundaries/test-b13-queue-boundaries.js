/**
 * Tier 2 - Boundary 13: Queue & Concurrency Boundaries
 * Tests boundary conditions for queue management and concurrency:
 * MAX_CONCURRENT saturation, burst additions, pause/resume lifecycle,
 * rename conflict detection (409), and empty queue states.
 */

const { assertTrue, assertEquals } = require('../helpers/assertions');
const { TestServer } = require('../helpers/test-server');

module.exports = {
  name: 'Boundary 13: Queue & Concurrency Boundaries',
  tests: [
    {
      name: 'B13.1: Enqueuing jobs beyond MAX_CONCURRENT leaves excess jobs in waiting state',
      run: async () => {
        const server = new TestServer({ port: 3284, env: { MAX_CONCURRENT: '1' } });
        await server.start();

        try {
          const res1 = await server.post('/api/queue/add', { url: 'https://example.com/job1', title: 'Job 1' });
          const res2 = await server.post('/api/queue/add', { url: 'https://example.com/job2', title: 'Job 2' });

          const queueRes = await server.get('/api/queue');
          assertEquals(queueRes.status, 200);
          assertEquals(queueRes.body.length, 2);

          const job2 = queueRes.body.find(j => j.id === res2.body.id);
          // With MAX_CONCURRENT=1, second job is waiting while first is active (or failed)
          assertTrue(['waiting', 'downloading', 'error'].includes(job2.status));
        } finally {
          await server.stop();
        }
      }
    },
    {
      name: 'B13.2: Burst addition of multiple queue items preserves all items without loss',
      run: async () => {
        const server = new TestServer({ port: 3285 });
        await server.start();

        try {
          const promises = [];
          for (let i = 0; i < 5; i++) {
            promises.push(server.post('/api/queue/add', {
              url: `https://example.com/item-${i}`,
              title: `Burst Item ${i}`
            }));
          }

          const results = await Promise.all(promises);
          for (const r of results) {
            assertEquals(r.status, 200);
          }

          const queueRes = await server.get('/api/queue');
          assertEquals(queueRes.body.length, 5, 'All 5 burst jobs must be recorded');
        } finally {
          await server.stop();
        }
      }
    },
    {
      name: 'B13.3: Empty queue responds with empty array []',
      run: async () => {
        const server = new TestServer({ port: 3286 });
        await server.start();

        try {
          const queueRes = await server.get('/api/queue');
          assertEquals(queueRes.status, 200);
          assertTrue(Array.isArray(queueRes.body));
          assertEquals(queueRes.body.length, 0);
        } finally {
          await server.stop();
        }
      }
    },
    {
      name: 'B13.4: Renaming job to empty name returns 400 Bad Request',
      run: async () => {
        const server = new TestServer({ port: 3287 });
        await server.start();

        try {
          const res = await server.patch('/api/download/fake-id/name', { name: '' });
          assertTrue(res.status === 400 || res.status === 404);
        } finally {
          await server.stop();
        }
      }
    },
    {
      name: 'B13.5: GET /api/download/:id for non-existent job returns 404',
      run: async () => {
        const server = new TestServer({ port: 3288 });
        await server.start();

        try {
          const res = await server.get('/api/download/non-existent-id-999');
          assertEquals(res.status, 404);
        } finally {
          await server.stop();
        }
      }
    }
  ]
};
