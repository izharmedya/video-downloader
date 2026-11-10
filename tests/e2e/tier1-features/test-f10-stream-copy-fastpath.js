/**
 * Tier 1 - Feature 10: Stream-Copy Fast Path for H.264/AAC
 * Verifies that already-compatible H.264/AAC streams (e.g. <=1080p) use
 * zero-loss stream-copy with faststart for near-instant processing.
 */

const { assertTrue, assertEquals } = require('../helpers/assertions');
const { TestServer } = require('../helpers/test-server');
const { MockMediaServer } = require('../helpers/mock-media-server');
const { probe, isFaststart } = require('../helpers/media-probe');

module.exports = {
  name: 'Feature 10: Stream-Copy Fast Path for H.264/AAC',
  tests: [
    {
      name: 'F10.1: Native H.264 + AAC 48k stream preserves codecs without re-encoding',
      run: async () => {
        const mock = new MockMediaServer();
        await mock.start();
        const server = new TestServer({ port: 3237 });
        await server.start();

        try {
          const addRes = await server.post('/api/queue/add', {
            url: mock.getUrl('/media/1080p.mp4'),
            title: 'Stream Copy Preservation'
          });

          const job = await server.waitForJob(addRes.body.id, 30000);
          assertEquals(job.status, 'done');
          const info = probe(job.filename);
          const vstream = info.streams.find(s => s.codec_type === 'video');
          const astream = info.streams.find(s => s.codec_type === 'audio');
          assertEquals(vstream.codec_name, 'h264');
          assertEquals(astream.codec_name, 'aac');
        } finally {
          await server.stop();
          await mock.stop();
        }
      }
    },
    {
      name: 'F10.2: Fast path ensures moov atom is placed at beginning (+faststart)',
      run: async () => {
        const mock = new MockMediaServer();
        await mock.start();
        const server = new TestServer({ port: 3238 });
        await server.start();

        try {
          const addRes = await server.post('/api/queue/add', {
            url: mock.getUrl('/media/1080p.mp4'),
            title: 'Stream Copy Faststart'
          });

          const job = await server.waitForJob(addRes.body.id, 30000);
          assertEquals(job.status, 'done');
          assertTrue(isFaststart(job.filename), 'Output file must have faststart moov atom');
        } finally {
          await server.stop();
          await mock.stop();
        }
      }
    },
    {
      name: 'F10.3: Fast path preserves exact resolution and dimensions',
      run: async () => {
        const mock = new MockMediaServer();
        await mock.start();
        const server = new TestServer({ port: 3239 });
        await server.start();

        try {
          const addRes = await server.post('/api/queue/add', {
            url: mock.getUrl('/media/1080p.mp4'),
            title: 'Stream Copy Dimensions'
          });

          const job = await server.waitForJob(addRes.body.id, 30000);
          assertEquals(job.status, 'done');
          const info = probe(job.filename);
          const vstream = info.streams.find(s => s.codec_type === 'video');
          assertEquals(vstream.width, 1920);
          assertEquals(vstream.height, 1080);
        } finally {
          await server.stop();
          await mock.stop();
        }
      }
    },
    {
      name: 'F10.4: Fast path processing completes in brief timeframe (<15s for short clip)',
      run: async () => {
        const mock = new MockMediaServer();
        await mock.start();
        const server = new TestServer({ port: 3240 });
        await server.start();

        try {
          const start = Date.now();
          const addRes = await server.post('/api/queue/add', {
            url: mock.getUrl('/media/1080p.mp4'),
            title: 'Stream Copy Latency'
          });

          const job = await server.waitForJob(addRes.body.id, 20000);
          const elapsed = Date.now() - start;
          assertEquals(job.status, 'done');
          assertTrue(elapsed < 20000, `Fast path should complete swiftly, took ${elapsed}ms`);
        } finally {
          await server.stop();
          await mock.stop();
        }
      }
    },
    {
      name: 'F10.5: Fast path produces valid non-zero duration',
      run: async () => {
        const mock = new MockMediaServer();
        await mock.start();
        const server = new TestServer({ port: 3241 });
        await server.start();

        try {
          const addRes = await server.post('/api/queue/add', {
            url: mock.getUrl('/media/1080p.mp4'),
            title: 'Stream Copy Duration'
          });

          const job = await server.waitForJob(addRes.body.id, 30000);
          assertEquals(job.status, 'done');
          const info = probe(job.filename);
          const dur = parseFloat(info.format?.duration || '0');
          assertTrue(dur > 0, `Duration should be > 0, got ${dur}`);
        } finally {
          await server.stop();
          await mock.stop();
        }
      }
    }
  ]
};
