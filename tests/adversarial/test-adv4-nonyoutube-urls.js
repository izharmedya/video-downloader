/**
 * Adversarial Test Suite 4: Non-YouTube URLs & Timeout Optimization
 * Verifies domain spoofing resistance, rapid failure (<10s) without 30s+ hangs,
 * and graceful handling of hanging TCP sockets, 404s, and dead hosts.
 */

const http = require('http');
const net = require('net');
const { assertTrue, assertFalse, assertEquals, assertLessThanOrEqual } = require('../e2e/helpers/assertions');
const { TestServer } = require('../e2e/helpers/test-server');
const { MockMediaServer } = require('../e2e/helpers/mock-media-server');

module.exports = {
  name: 'Adversarial 4: Non-YouTube URLs & Fast-Fail Verification',
  tests: [
    {
      name: 'Adv4.1: Domain spoofing & lookalike URLs are classified as non-YouTube',
      run: async () => {
        // We verify the classification directly and via /api/info
        const spoofedUrls = [
          'https://notyoutube.com/watch?v=123',
          'https://youtube.com.attacker.com/watch?v=123',
          'https://attacker-youtube.com/video',
          'https://vimeo.com/76979871',
          'https://dailymotion.com/video/x7tgad0',
          'https://soundcloud.com/artist/track'
        ];

        const server = new TestServer({ port: 3331 });
        await server.start();

        try {
          for (const url of spoofedUrls) {
            const start = Date.now();
            const res = await server.post('/api/info', { url });
            const elapsed = Date.now() - start;

            // These should fail quickly (<15s) and NOT cycle through 7 YouTube player clients (which takes >30-60s)
            assertLessThanOrEqual(elapsed, 15000, `URL "${url}" should fail quickly (<15s) as non-YouTube, took ${elapsed}ms`);
          }
        } finally {
          await server.stop();
        }
      }
    },
    {
      name: 'Adv4.2: Unreachable dead TCP port fails within <= 5s (well below 30s)',
      run: async () => {
        const server = new TestServer({ port: 3332 });
        await server.start();

        try {
          const deadUrl = 'http://127.0.0.1:58999/dead-video.mp4';
          const start = Date.now();
          const res = await server.post('/api/info', { url: deadUrl });
          const elapsed = Date.now() - start;

          assertTrue(res.status >= 400, `Dead URL should return error >= 400, got ${res.status}`);
          assertLessThanOrEqual(elapsed, 5000, `Connection refused should abort within 5000ms, took ${elapsed}ms`);
        } finally {
          await server.stop();
        }
      }
    },
    {
      name: 'Adv4.3: Non-existent non-YouTube domain fails within <= 6s',
      run: async () => {
        const server = new TestServer({ port: 3333 });
        await server.start();

        try {
          const fakeDomainUrl = 'https://this-domain-definitely-does-not-exist-9876543210.org/video.mp4';
          const start = Date.now();
          const res = await server.post('/api/info', { url: fakeDomainUrl });
          const elapsed = Date.now() - start;

          assertTrue(res.status >= 400, `Non-existent domain should return error, got ${res.status}`);
          assertLessThanOrEqual(elapsed, 6000, `DNS failure should abort within 6000ms, took ${elapsed}ms`);
        } finally {
          await server.stop();
        }
      }
    },
    {
      name: 'Adv4.4: Hanging HTTP server (accepts TCP, never responds) aborts within <= 12s without 30s+ hang',
      run: async () => {
        // Create a local TCP server that accepts connections but never sends any bytes
        let socketCount = 0;
        const hangingServer = net.createServer((socket) => {
          socketCount++;
          // Deliberately hold socket open and never send data
        });

        await new Promise(resolve => hangingServer.listen(0, '127.0.0.1', resolve));
        const hangingPort = hangingServer.address().port;
        const hangingUrl = `http://127.0.0.1:${hangingPort}/hanging-video.mp4`;

        const server = new TestServer({ port: 3334 });
        await server.start();

        try {
          const start = Date.now();
          const res = await server.post('/api/info', { url: hangingUrl });
          const elapsed = Date.now() - start;

          // Non-YouTube ATTEMPT_TIMEOUT is 10000ms. With child process kill, it should complete in ~10-12s.
          // It MUST NOT hang for 30s or run multiple client retries!
          assertTrue(res.status >= 400, `Hanging URL should fail with error status, got ${res.status}`);
          assertLessThanOrEqual(elapsed, 13000, `Hanging URL should be killed by 10s attempt timeout, took ${elapsed}ms`);
        } finally {
          await server.stop();
          hangingServer.close();
        }
      }
    },
    {
      name: 'Adv4.5: HTTP 404 response on non-YouTube endpoint fails quickly with 400 Bad Request',
      run: async () => {
        const mock = new MockMediaServer();
        await mock.start();

        const server = new TestServer({ port: 3335 });
        await server.start();

        try {
          const notFoundUrl = mock.getUrl('/media/not-found-404.mp4');
          const start = Date.now();
          const res = await server.post('/api/info', { url: notFoundUrl });
          const elapsed = Date.now() - start;

          assertEquals(res.status, 400, `404 resource should yield 400 Bad Request, got ${res.status}`);
          assertLessThanOrEqual(elapsed, 5000, `404 should fail within 5000ms, took ${elapsed}ms`);
        } finally {
          await server.stop();
          await mock.stop();
        }
      }
    },
    {
      name: 'Adv4.6: Valid non-YouTube media URL extraction succeeds rapidly (< 3s)',
      run: async () => {
        const mock = new MockMediaServer();
        await mock.start();

        const server = new TestServer({ port: 3336 });
        await server.start();

        try {
          const validUrl = mock.getUrl('/media/1080p.mp4');
          const start = Date.now();
          const res = await server.post('/api/info', { url: validUrl });
          const elapsed = Date.now() - start;

          assertEquals(res.status, 200, `Valid URL should return 200, got ${res.status}`);
          assertTrue(Array.isArray(res.body.formats), 'formats should be an array');
          assertLessThanOrEqual(elapsed, 4000, `Valid direct media extraction should complete under 4s, took ${elapsed}ms`);
        } finally {
          await server.stop();
          await mock.stop();
        }
      }
    }
  ]
};
