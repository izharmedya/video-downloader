/**
 * Tier 1 - Feature 12: Intermediate File Cleanup
 * Verifies that orphaned fragments (.f*.mp4, .f*.m4a, .part) are purged
 * upon failure or cancellation, and deleted jobs clean up disk files.
 */

const fs = require('fs');
const path = require('path');
const { assertTrue, assertFalse, assertEquals } = require('../helpers/assertions');
const { TestServer } = require('../helpers/test-server');
const { MockMediaServer } = require('../helpers/mock-media-server');

module.exports = {
  name: 'Feature 12: Intermediate File Cleanup',
  tests: [
    {
      name: 'F12.1: Cancelling an active download cleans up intermediate fragments',
      run: async () => {
        const mock = new MockMediaServer();
        await mock.start();
        const server = new TestServer({ port: 3247 });
        await server.start();

        try {
          const addRes = await server.post('/api/queue/add', {
            url: mock.getUrl('/media/slow'),
            title: 'Cancel Cleanup Test'
          });

          // Wait briefly for download to start
          await new Promise(r => setTimeout(r, 600));

          // Cancel the job
          const delRes = await server.delete(`/api/queue/${addRes.body.id}`);
          assertEquals(delRes.status, 200);

          // Give server a moment to reap processes and clean disk
          await new Promise(r => setTimeout(r, 1000));

          const files = fs.readdirSync(server.downloadDir);
          const hasFragments = files.some(f => f.endsWith('.part') || /\.f\d+\./.test(f));
          assertFalse(hasFragments, `Downloads dir should not contain leftover .part or .f* files: ${files.join(', ')}`);
        } finally {
          await server.stop();
          await mock.stop();
        }
      }
    },
    {
      name: 'F12.2: Download failure cleans up orphaned intermediate fragments',
      run: async () => {
        const mock = new MockMediaServer();
        await mock.start();
        const server = new TestServer({ port: 3248 });
        await server.start();

        try {
          const addRes = await server.post('/api/queue/add', {
            url: mock.getUrl('/media/corrupt'),
            title: 'Corrupt Cleanup Test'
          });

          await server.waitForJob(addRes.body.id, 25000);

          const files = fs.readdirSync(server.downloadDir);
          const hasPartFiles = files.some(f => f.endsWith('.part'));
          assertFalse(hasPartFiles, `No .part files should remain after failure: ${files.join(', ')}`);
        } finally {
          await server.stop();
          await mock.stop();
        }
      }
    },
    {
      name: 'F12.3: Completed download retains only final file (no fragments)',
      run: async () => {
        const mock = new MockMediaServer();
        await mock.start();
        const server = new TestServer({ port: 3249 });
        await server.start();

        try {
          const addRes = await server.post('/api/queue/add', {
            url: mock.getUrl('/media/1080p.mp4'),
            title: 'Clean Final Target'
          });

          const job = await server.waitForJob(addRes.body.id, 30000);
          assertEquals(job.status, 'done');

          const files = fs.readdirSync(server.downloadDir);
          const hasFragments = files.some(f => f.endsWith('.part') || /\.f\d+\./.test(f));
          assertFalse(hasFragments, `Only final file should remain: ${files.join(', ')}`);
        } finally {
          await server.stop();
          await mock.stop();
        }
      }
    },
    {
      name: 'F12.4: DELETE /api/download/:id deletes target file from disk',
      run: async () => {
        const mock = new MockMediaServer();
        await mock.start();
        const server = new TestServer({ port: 3250 });
        await server.start();

        try {
          const addRes = await server.post('/api/queue/add', {
            url: mock.getUrl('/media/1080p.mp4'),
            title: 'Disk Delete Test'
          });

          const job = await server.waitForJob(addRes.body.id, 30000);
          assertEquals(job.status, 'done');
          assertTrue(fs.existsSync(job.filename), 'File must exist prior to deletion');

          const delRes = await server.delete(`/api/download/${job.id}`);
          assertEquals(delRes.status, 200);
          assertFalse(fs.existsSync(job.filename), 'File must be unlinked from disk');
        } finally {
          await server.stop();
          await mock.stop();
        }
      }
    },
    {
      name: 'F12.5: DELETE /api/download/:id deletes accompanying thumbnail file',
      run: async () => {
        const server = new TestServer({ port: 3251 });
        await server.start();

        try {
          // Create dummy media and thumbnail in downloads dir
          const mediaPath = path.join(server.downloadDir, 'dummy_test.mp4');
          const thumbPath = path.join(server.downloadDir, 'dummy_test.jpg');
          fs.writeFileSync(mediaPath, 'dummy media content');
          fs.writeFileSync(thumbPath, 'dummy thumb content');

          // Add to queue mock
          const addRes = await server.post('/api/queue/add', {
            url: 'https://example.com/test',
            title: 'dummy_test'
          });
          const queueRes = await server.get('/api/queue');
          const job = queueRes.body.find(j => j.id === addRes.body.id);
          job.filename = mediaPath;

          const delRes = await server.delete(`/api/download/${job.id}`);
          assertEquals(delRes.status, 200);
          assertFalse(fs.existsSync(mediaPath), 'Media file should be deleted');
          assertFalse(fs.existsSync(thumbPath), 'Thumbnail file should be deleted');
        } finally {
          await server.stop();
        }
      }
    }
  ]
};
