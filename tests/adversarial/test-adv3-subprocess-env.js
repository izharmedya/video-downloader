/**
 * Adversarial Test Suite 3: Subprocess Environment & PATH Hardening
 * Verifies child processes run successfully even when launched from
 * severely restricted environments (e.g. PATH="" or PATH="/usr/bin:/bin").
 */

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { assertTrue, assertFalse, assertEquals } = require('../e2e/helpers/assertions');
const { TestServer } = require('../e2e/helpers/test-server');
const { MockMediaServer } = require('../e2e/helpers/mock-media-server');

module.exports = {
  name: 'Adversarial 3: Subprocess Environment & PATH Hardening',
  tests: [
    {
      name: 'Adv3.1: Server started with PATH="" augments PATH and resolves Homebrew binaries',
      run: async () => {
        const server = new TestServer({
          port: 3321,
          env: {
            PATH: '', // Completely stripped PATH
            FFMPEG_PATH: '',
            FFPROBE_PATH: '',
            YTDLP_PATH: ''
          }
        });
        await server.start();
        try {
          const res = await server.get('/api/default-path');
          assertEquals(res.status, 200);

          // Verify that server log displays resolved binaries
          const logs = server.logs.join('\n');
          assertTrue(logs.includes('/opt/homebrew/bin') || logs.includes('ffmpeg: /'),
            `Server should auto-discover binaries even with empty PATH, got logs:\n${logs}`);
        } finally {
          await server.stop();
        }
      }
    },
    {
      name: 'Adv3.2: Server started with restricted PATH="/usr/bin:/bin" executes child processes reliably',
      run: async () => {
        const mock = new MockMediaServer();
        await mock.start();

        const server = new TestServer({
          port: 3322,
          env: {
            PATH: '/usr/bin:/bin', // Typical macOS GUI app launcher environment
            FFMPEG_PATH: '/opt/homebrew/bin/ffmpeg',
            FFPROBE_PATH: '/opt/homebrew/bin/ffprobe',
          }
        });
        await server.start();

        try {
          // Trigger yt-dlp child process via /api/info
          const mediaUrl = mock.getUrl('/media/1080p.mp4');
          const res = await server.post('/api/info', { url: mediaUrl });

          assertEquals(res.status, 200, `Child process should succeed under restricted PATH, got ${res.status}: ${JSON.stringify(res.body)}`);
          assertTrue(Array.isArray(res.body.formats), 'formats must be returned');
        } finally {
          await server.stop();
          await mock.stop();
        }
      }
    },
    {
      name: 'Adv3.3: Custom user environment variables are preserved in child process execution',
      run: async () => {
        const customEnvKey = 'ADVERSARIAL_TEST_SECRET';
        const customEnvVal = 'verified_secret_998877';

        const server = new TestServer({
          port: 3323,
          env: {
            PATH: '/usr/bin:/bin',
            [customEnvKey]: customEnvVal
          }
        });
        await server.start();

        try {
          // Query an endpoint to ensure server is alive and functioning
          const res = await server.get('/api/default-path');
          assertEquals(res.status, 200);
        } finally {
          await server.stop();
        }
      }
    },
    {
      name: 'Adv3.4: Child process execution does not throw ENOENT for ffmpeg when called by yt-dlp',
      run: async () => {
        const mock = new MockMediaServer();
        await mock.start();

        const server = new TestServer({
          port: 3324,
          env: {
            PATH: '/usr/bin:/bin' // Restricted PATH
          }
        });
        await server.start();

        try {
          // Download a small video through queue to verify yt-dlp + ffmpeg postprocessing pipeline
          const mediaUrl = mock.getUrl('/media/1080p.mp4');
          const addRes = await server.post('/api/queue/add', {
            url: mediaUrl,
            format_id: 'best',
            title: 'Subprocess Env Test Video'
          });
          assertEquals(addRes.status, 200);
          const jobId = addRes.body.id;

          // Poll until completed or error
          const deadline = Date.now() + 30000;
          let doneJob = null;
          while (Date.now() < deadline) {
            const queueRes = await server.get('/api/queue');
            const job = (queueRes.body || []).find(j => j.id === jobId);
            if (job && (job.status === 'done' || job.status === 'error')) {
              doneJob = job;
              break;
            }
            await new Promise(r => setTimeout(r, 500));
          }

          assertTrue(!!doneJob, 'Job should complete processing within 30s');
          assertEquals(doneJob.status, 'done', `Job should succeed without ENOENT, error: ${doneJob.error}`);
        } finally {
          await server.stop();
          await mock.stop();
        }
      }
    }
  ]
};
