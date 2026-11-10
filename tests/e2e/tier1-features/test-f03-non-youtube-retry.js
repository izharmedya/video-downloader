/**
 * Tier 1 - Feature 3: Non-YouTube Retry Optimization
 * Verifies that /api/info does not execute 7 sequential YouTube player client retries
 * on non-YouTube domains, preventing 50+ second latencies.
 */

const { assertTrue, assertEquals, assertLessThanOrEqual } = require('../helpers/assertions');
const { TestServer } = require('../helpers/test-server');
const { MockMediaServer } = require('../helpers/mock-media-server');

module.exports = {
  name: 'Feature 3: Non-YouTube Retry Optimization',
  tests: [
    {
      name: 'F3.1: Non-YouTube media URL in /api/info resolves formats without multiple client retries',
      run: async () => {
        const mock = new MockMediaServer();
        await mock.start();
        const server = new TestServer({ port: 3203 });
        await server.start();

        try {
          const testUrl = mock.getUrl('/media/1080p.mp4');
          const res = await server.post('/api/info', { url: testUrl });
          assertEquals(res.status, 200, `Expected 200 OK from /api/info, got ${res.status}: ${JSON.stringify(res.body)}`);
          assertTrue(Array.isArray(res.body.formats), 'formats must be returned as array');
          assertTrue(res.body.formats.length > 0, 'formats array must not be empty');
        } finally {
          await server.stop();
          await mock.stop();
        }
      }
    },
    {
      name: 'F3.2: Non-YouTube URL response time is under 5000ms',
      run: async () => {
        const mock = new MockMediaServer();
        await mock.start();
        const server = new TestServer({ port: 3204 });
        await server.start();

        try {
          const start = Date.now();
          const testUrl = mock.getUrl('/media/1080p.mp4');
          const res = await server.post('/api/info', { url: testUrl });
          const elapsed = Date.now() - start;

          assertEquals(res.status, 200);
          assertLessThanOrEqual(elapsed, 5000, `Non-YouTube info request should complete in <5000ms, took ${elapsed}ms`);
        } finally {
          await server.stop();
          await mock.stop();
        }
      }
    },
    {
      name: 'F3.3: Direct MP4 HTTP stream metadata includes title and formats',
      run: async () => {
        const mock = new MockMediaServer();
        await mock.start();
        const server = new TestServer({ port: 3205 });
        await server.start();

        try {
          const testUrl = mock.getUrl('/media/1080p.mp4');
          const res = await server.post('/api/info', { url: testUrl });
          assertEquals(res.status, 200);
          assertTrue(!!res.body.title, 'Title should be present');
          assertTrue(Array.isArray(res.body.formats), 'Formats should be present');
        } finally {
          await server.stop();
          await mock.stop();
        }
      }
    },
    {
      name: 'F3.4: Invalid non-YouTube URL fails promptly without prolonged hanging',
      run: async () => {
        const mock = new MockMediaServer();
        await mock.start();
        const server = new TestServer({ port: 3206 });
        await server.start();

        try {
          const start = Date.now();
          const invalidUrl = mock.getUrl('/media/non-existent-404.mp4');
          const res = await server.post('/api/info', { url: invalidUrl });
          const elapsed = Date.now() - start;

          // Should return 400 or error
          assertTrue(res.status >= 400, `Expected error status >= 400, got ${res.status}`);
          assertLessThanOrEqual(elapsed, 10000, `Failed request should abort within 10s, took ${elapsed}ms`);
        } finally {
          await server.stop();
          await mock.stop();
        }
      }
    },
    {
      name: 'F3.5: /api/info rejects empty URL with 400 Bad Request',
      run: async () => {
        const server = new TestServer({ port: 3207 });
        await server.start();

        try {
          const res = await server.post('/api/info', { url: '' });
          assertEquals(res.status, 400);
          assertTrue(!!res.body.error, 'Error message expected in response');
        } finally {
          await server.stop();
        }
      }
    }
  ]
};
