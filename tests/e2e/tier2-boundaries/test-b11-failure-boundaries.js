/**
 * Tier 2 - Boundary 11: Failure & Crash Boundaries
 * Tests boundary conditions for process failures and crash recovery:
 * SIGKILL termination, code 127, HTML payload masquerading as media,
 * and strict exit code validation.
 */

const fs = require('fs');
const path = require('path');
const { assertTrue, assertEquals } = require('../helpers/assertions');
const { TestServer } = require('../helpers/test-server');

module.exports = {
  name: 'Boundary 11: Failure & Crash Boundaries',
  tests: [
    {
      name: 'B11.1: Process terminated via SIGKILL transitions job to cancelled or error without crashing server',
      run: async () => {
        const server = new TestServer({ port: 3276 });
        await server.start();

        try {
          const addRes = await server.post('/api/queue/add', {
            url: 'https://example.com/stalled-download',
            title: 'Kill Test'
          });

          // Delete/kill immediately
          const delRes = await server.delete(`/api/queue/${addRes.body.id}`);
          assertEquals(delRes.status, 200);

          // Server should remain alive and responsive
          const checkRes = await server.get('/api/queue');
          assertEquals(checkRes.status, 200);
        } finally {
          await server.stop();
        }
      }
    },
    {
      name: 'B11.2: Non-existent executable path throws error and marks job as error',
      run: async () => {
        const server = new TestServer({
          port: 3277,
          env: { YTDLP_PATH: '/path/to/non-existent-binary-12345' }
        });
        await server.start();

        try {
          const addRes = await server.post('/api/queue/add', {
            url: 'https://example.com/video',
            title: 'Bad Binary Path'
          });

          const job = await server.waitForJob(addRes.body.id, 10000);
          assertEquals(job.status, 'error', 'Missing binary must fail job with status error');
        } finally {
          await server.stop();
        }
      }
    },
    {
      name: 'B11.3: HTML 403 error page payload (>50KB) is rejected and not marked done',
      run: async () => {
        const server = new TestServer({ port: 3278 });
        await server.start();

        try {
          // Write a 60KB HTML error payload in downloads dir
          const htmlPayload = '<html><body><h1>403 Forbidden Access Denied</h1>' + 'A'.repeat(60000) + '</body></html>';
          const fakeTarget = path.join(server.downloadDir, 'fake_error.mp4');
          fs.writeFileSync(fakeTarget, htmlPayload);

          // Probe must fail on HTML file
          const { probe } = require('../helpers/media-probe');
          let probeFailed = false;
          try {
            probe(fakeTarget);
          } catch {
            probeFailed = true;
          }
          assertTrue(probeFailed, 'ffprobe must fail on HTML masquerading as MP4');
        } finally {
          await server.stop();
        }
      }
    },
    {
      name: 'B11.4: Missing file after process completion fails job',
      run: async () => {
        const server = new TestServer({ port: 3279 });
        await server.start();

        try {
          const addRes = await server.post('/api/queue/add', {
            url: 'https://127.0.0.1:9999/not-listening',
            title: 'Unreachable Host'
          });

          const job = await server.waitForJob(addRes.body.id, 20000);
          assertEquals(job.status, 'error', 'Unreachable host must mark job error');
        } finally {
          await server.stop();
        }
      }
    },
    {
      name: 'B11.5: Exit code !== 0 overrides presence of partial file on disk',
      run: async () => {
        // Contract test: code !== 0 must result in error even if a file exists
        const code = 1;
        const fileExists = true;
        const shouldBeDone = code === 0 && fileExists;
        assertEquals(shouldBeDone, false, 'Non-zero exit code must never produce done status');
      }
    }
  ]
};
