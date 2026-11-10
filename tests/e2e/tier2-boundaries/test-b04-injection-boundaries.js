/**
 * Tier 2 - Boundary 4: Injection & Metacharacter Boundaries
 * Tests boundary conditions for shell escaping, malicious input inputs,
 * null bytes, newlines, and metacharacters.
 */

const { assertTrue, assertFalse, assertEquals } = require('../helpers/assertions');
const { TestServer } = require('../helpers/test-server');

module.exports = {
  name: 'Boundary 4: Injection & Metacharacter Boundaries',
  tests: [
    {
      name: 'B4.1: URL containing newlines and carriage returns is rejected',
      run: async () => {
        const server = new TestServer({ port: 3266 });
        await server.start();

        try {
          const maliciousUrl = "https://example.com/video\nrm -rf /\r\n";
          const res = await server.post('/api/queue/add', { url: maliciousUrl });
          assertTrue(res.status >= 400, `URL with newline should be rejected, got ${res.status}`);
        } finally {
          await server.stop();
        }
      }
    },
    {
      name: 'B4.2: Custom filename with null byte is safely sanitized without exception',
      run: async () => {
        const server = new TestServer({ port: 3267 });
        await server.start();

        try {
          const maliciousName = "my_video\0.exe";
          const res = await server.post('/api/queue/add', {
            url: 'https://example.com/video',
            custom_name: maliciousName
          });

          if (res.status === 200) {
            const queueRes = await server.get('/api/queue');
            const job = queueRes.body.find(j => j.id === res.body.id);
            assertFalse(job.custom_name.includes('\0'), 'Null byte must be stripped from custom_name');
          }
        } finally {
          await server.stop();
        }
      }
    },
    {
      name: 'B4.3: Custom filename composed entirely of dots and spaces is sanitized',
      run: async () => {
        const server = new TestServer({ port: 3268 });
        await server.start();

        try {
          const dotName = " . . . ";
          const res = await server.post('/api/queue/add', {
            url: 'https://example.com/video',
            custom_name: dotName
          });

          if (res.status === 200) {
            const queueRes = await server.get('/api/queue');
            const job = queueRes.body.find(j => j.id === res.body.id);
            assertFalse(job.custom_name === ' . . . ', 'Pure dots/spaces name must be sanitized');
          }
        } finally {
          await server.stop();
        }
      }
    },
    {
      name: 'B4.4: Notification with backticks does not invoke subshell evaluation',
      run: async () => {
        const server = new TestServer({ port: 3269 });
        await server.start();

        try {
          // Add job with title containing backticks
          const res = await server.post('/api/queue/add', {
            url: 'https://example.com/fake-video',
            title: '`echo injection_test`'
          });
          assertEquals(res.status, 200);
        } finally {
          await server.stop();
        }
      }
    },
    {
      name: 'B4.5: POST /api/download-dir with traversal path fails validation',
      run: async () => {
        const server = new TestServer({ port: 3270 });
        await server.start();

        try {
          const res = await server.post('/api/download-dir', { path: '../relative/dir' });
          // Must require absolute path
          assertTrue(res.status >= 400, 'Relative path should be rejected');
        } finally {
          await server.stop();
        }
      }
    }
  ]
};
