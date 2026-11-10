/**
 * Tier 1 - Feature 11: False Success Logic Remediation
 * Verifies that jobs are NEVER marked 'done' if process exits with non-zero code,
 * or if intermediate audio fragments exist without the video stream.
 */

const { assertTrue, assertEquals, assertNotEquals } = require('../helpers/assertions');
const { TestServer } = require('../helpers/test-server');
const { MockMediaServer } = require('../helpers/mock-media-server');

module.exports = {
  name: 'Feature 11: False Success Logic Remediation',
  tests: [
    {
      name: 'F11.1: Non-zero exit code transitions job status to error, not done',
      run: async () => {
        const mock = new MockMediaServer();
        await mock.start();
        const server = new TestServer({ port: 3242 });
        await server.start();

        try {
          // Request non-existent stream to induce failure
          const addRes = await server.post('/api/queue/add', {
            url: mock.getUrl('/media/non-existent-fail.mp4'),
            title: 'Failure Test'
          });

          const job = await server.waitForJob(addRes.body.id, 25000);
          assertEquals(job.status, 'error', `Job status must be error on exit code failure, got: ${job.status}`);
          assertNotEquals(job.status, 'done', 'Job must never be marked done on failure');
        } finally {
          await server.stop();
          await mock.stop();
        }
      }
    },
    {
      name: 'F11.2: Video download that yields only audio stream is marked as error',
      run: async () => {
        const mock = new MockMediaServer();
        await mock.start();
        const server = new TestServer({ port: 3243 });
        await server.start();

        try {
          // Request audio-only file while audio_only is false
          const addRes = await server.post('/api/queue/add', {
            url: mock.getUrl('/media/audio.webm'),
            audio_only: false,
            title: 'Missing Video Stream Test'
          });

          const job = await server.waitForJob(addRes.body.id, 25000);
          // If the server validates stream types before marking done:
          if (job.status === 'done') {
            const { probe } = require('../helpers/media-probe');
            const info = probe(job.filename);
            const hasVideo = info.streams.some(s => s.codec_type === 'video');
            assertTrue(hasVideo, 'A video download marked done MUST contain a video stream');
          } else {
            assertEquals(job.status, 'error');
          }
        } finally {
          await server.stop();
          await mock.stop();
        }
      }
    },
    {
      name: 'F11.3: Download resulting in 0-byte file is marked as error',
      run: async () => {
        const mock = new MockMediaServer();
        await mock.start();
        const server = new TestServer({ port: 3244 });
        await server.start();

        try {
          const addRes = await server.post('/api/queue/add', {
            url: mock.getUrl('/media/empty'),
            title: 'Empty Download Test'
          });

          const job = await server.waitForJob(addRes.body.id, 25000);
          assertEquals(job.status, 'error', 'Zero-byte download must result in job error');
        } finally {
          await server.stop();
          await mock.stop();
        }
      }
    },
    {
      name: 'F11.4: HTTP 500 server error marks job status as error',
      run: async () => {
        const mock = new MockMediaServer();
        await mock.start();
        const server = new TestServer({ port: 3245 });
        await server.start();

        try {
          const addRes = await server.post('/api/queue/add', {
            url: mock.getUrl('/media/500'),
            title: 'Server Error Test'
          });

          const job = await server.waitForJob(addRes.body.id, 25000);
          assertEquals(job.status, 'error', 'HTTP 500 must fail the job');
        } finally {
          await server.stop();
          await mock.stop();
        }
      }
    },
    {
      name: 'F11.5: Error jobs provide descriptive error message in job.error field',
      run: async () => {
        const mock = new MockMediaServer();
        await mock.start();
        const server = new TestServer({ port: 3246 });
        await server.start();

        try {
          const addRes = await server.post('/api/queue/add', {
            url: mock.getUrl('/media/non-existent-endpoint.mp4'),
            title: 'Descriptive Error Test'
          });

          const job = await server.waitForJob(addRes.body.id, 25000);
          assertEquals(job.status, 'error');
          assertTrue(typeof job.error === 'string' && job.error.length > 0, 'job.error must contain descriptive message');
        } finally {
          await server.stop();
          await mock.stop();
        }
      }
    }
  ]
};
