/**
 * Tier 1 - Feature 8: 4K & High-Res Stream Extraction
 * Verifies that selecting 4K (2160p) extracts the genuine high-resolution stream
 * without falling back to 1080p or audio-only fragments.
 */

const fs = require('fs');
const { assertTrue, assertEquals, assertGreaterThanOrEqual } = require('../helpers/assertions');
const { TestServer } = require('../helpers/test-server');
const { MockMediaServer } = require('../helpers/mock-media-server');
const { probe, assert4KResolution } = require('../helpers/media-probe');

module.exports = {
  name: 'Feature 8: 4K & High-Res Stream Extraction',
  tests: [
    {
      name: 'F8.1: Requesting 4K download yields video with stream height >= 2160',
      run: async () => {
        const mock = new MockMediaServer();
        await mock.start();
        const server = new TestServer({ port: 3227 });
        await server.start();

        try {
          const addRes = await server.post('/api/queue/add', {
            url: mock.getUrl('/media/4k.webm'),
            format_id: 'bestvideo[height<=2160]+bestaudio/best[height<=2160]',
            title: '4K Stream Test'
          });

          const job = await server.waitForJob(addRes.body.id, 45000);
          assertEquals(job.status, 'done', `Job failed: ${job.error}`);
          assert4KResolution(job.filename);
        } finally {
          await server.stop();
          await mock.stop();
        }
      }
    },
    {
      name: 'F8.2: 4K video stream width is at least 3840 for standard UHD 16:9',
      run: async () => {
        const mock = new MockMediaServer();
        await mock.start();
        const server = new TestServer({ port: 3228 });
        await server.start();

        try {
          const addRes = await server.post('/api/queue/add', {
            url: mock.getUrl('/media/4k.webm'),
            format_id: 'bestvideo[height<=2160]+bestaudio/best[height<=2160]',
            title: '4K Width Test'
          });

          const job = await server.waitForJob(addRes.body.id, 45000);
          assertEquals(job.status, 'done');
          const info = probe(job.filename);
          const vstream = info.streams.find(s => s.codec_type === 'video');
          assertGreaterThanOrEqual(vstream.width, 3840, `Width should be >= 3840, got ${vstream.width}`);
        } finally {
          await server.stop();
          await mock.stop();
        }
      }
    },
    {
      name: 'F8.3: 4K download contains both video and audio streams',
      run: async () => {
        const mock = new MockMediaServer();
        await mock.start();
        const server = new TestServer({ port: 3229 });
        await server.start();

        try {
          const addRes = await server.post('/api/queue/add', {
            url: mock.getUrl('/media/4k.webm'),
            title: '4K Multi-Stream Check'
          });

          const job = await server.waitForJob(addRes.body.id, 45000);
          assertEquals(job.status, 'done');
          const info = probe(job.filename);
          const hasVideo = info.streams.some(s => s.codec_type === 'video');
          const hasAudio = info.streams.some(s => s.codec_type === 'audio');
          assertTrue(hasVideo, 'Video stream must be present in 4K output');
          assertTrue(hasAudio, 'Audio stream must be present in 4K output');
        } finally {
          await server.stop();
          await mock.stop();
        }
      }
    },
    {
      name: 'F8.4: 4K download does not lock onto intermediate audio fragment .f140',
      run: async () => {
        const mock = new MockMediaServer();
        await mock.start();
        const server = new TestServer({ port: 3230 });
        await server.start();

        try {
          const addRes = await server.post('/api/queue/add', {
            url: mock.getUrl('/media/4k.webm'),
            title: 'Fragment Lock Prevention'
          });

          const job = await server.waitForJob(addRes.body.id, 45000);
          assertEquals(job.status, 'done');
          assertTrue(!job.filename.includes('.f140.'), `Filename should not end in .f140, got ${job.filename}`);
          assertTrue(job.filename.endsWith('.mp4'), `Output must be .mp4 container, got ${job.filename}`);
        } finally {
          await server.stop();
          await mock.stop();
        }
      }
    },
    {
      name: 'F8.5: Requesting 1080p yields video height of 1080',
      run: async () => {
        const mock = new MockMediaServer();
        await mock.start();
        const server = new TestServer({ port: 3231 });
        await server.start();

        try {
          const addRes = await server.post('/api/queue/add', {
            url: mock.getUrl('/media/1080p.mp4'),
            format_id: 'bestvideo[height<=1080]+bestaudio/best[height<=1080]',
            title: '1080p Stream Test'
          });

          const job = await server.waitForJob(addRes.body.id, 30000);
          assertEquals(job.status, 'done');
          const info = probe(job.filename);
          const vstream = info.streams.find(s => s.codec_type === 'video');
          assertEquals(vstream.height, 1080, `Expected 1080 height, got ${vstream.height}`);
        } finally {
          await server.stop();
          await mock.stop();
        }
      }
    }
  ]
};
