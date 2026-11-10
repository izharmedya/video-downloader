/**
 * Tier 2 - Boundary 3: Network & Format Extraction Boundaries
 * Tests boundary edge cases on media network endpoints:
 * zero-length responses, HTTP 404, redirects, URL query complexities,
 * and rejection of unsupported URL schemes.
 */

const { assertTrue, assertEquals } = require('../helpers/assertions');
const { TestServer } = require('../helpers/test-server');
const { MockMediaServer } = require('../helpers/mock-media-server');

module.exports = {
  name: 'Boundary 3: Network & Format Extraction Boundaries',
  tests: [
    {
      name: 'B3.1: Zero-byte server response terminates with error',
      run: async () => {
        const mock = new MockMediaServer();
        await mock.start();
        const server = new TestServer({ port: 3261 });
        await server.start();

        try {
          const addRes = await server.post('/api/queue/add', {
            url: mock.getUrl('/media/empty'),
            title: 'Zero Byte Stream'
          });

          const job = await server.waitForJob(addRes.body.id, 25000);
          assertEquals(job.status, 'error', 'Zero byte response must fail job');
        } finally {
          await server.stop();
          await mock.stop();
        }
      }
    },
    {
      name: 'B3.2: HTTP 404 Not Found terminates job with error and does not hang',
      run: async () => {
        const mock = new MockMediaServer();
        await mock.start();
        const server = new TestServer({ port: 3262 });
        await server.start();

        try {
          const addRes = await server.post('/api/queue/add', {
            url: mock.getUrl('/media/not-found-404.mp4'),
            title: '404 Stream'
          });

          const job = await server.waitForJob(addRes.body.id, 25000);
          assertEquals(job.status, 'error', '404 stream must result in job error');
        } finally {
          await server.stop();
          await mock.stop();
        }
      }
    },
    {
      name: 'B3.3: HTTP 302 Redirect is followed and resolves target media',
      run: async () => {
        const mock = new MockMediaServer();
        await mock.start();
        const server = new TestServer({ port: 3263 });
        await server.start();

        try {
          const addRes = await server.post('/api/queue/add', {
            url: mock.getUrl('/media/redirect'),
            title: 'Redirect Test'
          });

          const job = await server.waitForJob(addRes.body.id, 35000);
          assertEquals(job.status, 'done', `Redirected download should succeed, got ${job.status}: ${job.error}`);
        } finally {
          await server.stop();
          await mock.stop();
        }
      }
    },
    {
      name: 'B3.4: URL with complex query parameters and fragment is handled cleanly',
      run: async () => {
        const mock = new MockMediaServer();
        await mock.start();
        const server = new TestServer({ port: 3264 });
        await server.start();

        try {
          const complexUrl = mock.getUrl('/media/1080p.mp4?param1=hello%20world&token=abc_123#t=10,20');
          const addRes = await server.post('/api/queue/add', {
            url: complexUrl,
            title: 'Complex URL Query'
          });

          const job = await server.waitForJob(addRes.body.id, 35000);
          assertEquals(job.status, 'done');
        } finally {
          await server.stop();
          await mock.stop();
        }
      }
    },
    {
      name: 'B3.5: Non-HTTP schemes (file://, ftp://, javascript:) are rejected with 400',
      run: async () => {
        const server = new TestServer({ port: 3265 });
        await server.start();

        try {
          const schemes = [
            'file:///etc/passwd',
            'ftp://ftp.example.com/test.mp4',
            'javascript:alert(1)',
            'data:text/html;base64,PHNjcmlwdD4='
          ];

          for (const s of schemes) {
            const res = await server.post('/api/queue/add', { url: s });
            assertTrue(res.status >= 400, `Scheme ${s} should be rejected with >= 400, got ${res.status}`);
          }
        } finally {
          await server.stop();
        }
      }
    }
  ]
};
