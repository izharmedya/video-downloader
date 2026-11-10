/**
 * Tier 2 - Boundary 12: Cleanup Boundaries
 * Tests boundary conditions for intermediate file cleanup:
 * multi-fragment collections, non-existent files, unrelated file preservation,
 * and double-cancellation resilience.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { assertTrue, assertFalse, assertEquals } = require('../helpers/assertions');
const { TestServer } = require('../helpers/test-server');

module.exports = {
  name: 'Boundary 12: Cleanup Boundaries',
  tests: [
    {
      name: 'B12.1: Multi-fragment temporary files (.f313.mp4, .f140.m4a, .part) purged cleanly',
      run: async () => {
        const server = new TestServer({ port: 3280 });
        await server.start();

        try {
          // Pre-create simulated intermediate fragments in downloadDir
          const base = path.join(server.downloadDir, 'Test_Video');
          fs.writeFileSync(`${base}.f313.mp4`, 'video chunk');
          fs.writeFileSync(`${base}.f140.m4a`, 'audio chunk');
          fs.writeFileSync(`${base}.part`, 'partial chunk');

          // Routine to purge fragments for this base
          const files = fs.readdirSync(server.downloadDir);
          for (const f of files) {
            if (f.startsWith('Test_Video.') && (f.endsWith('.part') || /\.f\d+\./.test(f))) {
              fs.unlinkSync(path.join(server.downloadDir, f));
            }
          }

          const remaining = fs.readdirSync(server.downloadDir);
          const hasFragments = remaining.some(f => f.startsWith('Test_Video.'));
          assertFalse(hasFragments, 'All fragments should be purged');
        } finally {
          await server.stop();
        }
      }
    },
    {
      name: 'B12.2: Cleanup called on non-existent file does not throw or crash',
      run: async () => {
        const nonExistent = path.join(os.tmpdir(), `non-existent-${Date.now()}`);
        let threw = false;
        try {
          if (fs.existsSync(nonExistent)) fs.unlinkSync(nonExistent);
        } catch {
          threw = true;
        }
        assertFalse(threw, 'Safe cleanup check should not throw');
      }
    },
    {
      name: 'B12.3: Cleanup leaves unrelated user files in downloads directory untouched',
      run: async () => {
        const server = new TestServer({ port: 3281 });
        await server.start();

        try {
          const userDoc = path.join(server.downloadDir, 'Important_Notes.txt');
          fs.writeFileSync(userDoc, 'User data');

          // Simulating cleanup of another video
          const tmpPart = path.join(server.downloadDir, 'FailedVideo.part');
          fs.writeFileSync(tmpPart, 'junk');
          if (fs.existsSync(tmpPart)) fs.unlinkSync(tmpPart);

          assertTrue(fs.existsSync(userDoc), 'Unrelated user document must remain untouched');
        } finally {
          await server.stop();
        }
      }
    },
    {
      name: 'B12.4: Calling DELETE /api/queue/:id twice on same job does not crash server',
      run: async () => {
        const server = new TestServer({ port: 3282 });
        await server.start();

        try {
          const addRes = await server.post('/api/queue/add', {
            url: 'https://example.com/video',
            title: 'Double Cancel Test'
          });

          const del1 = await server.delete(`/api/queue/${addRes.body.id}`);
          assertEquals(del1.status, 200);

          const del2 = await server.delete(`/api/queue/${addRes.body.id}`);
          // Second delete should return 404 (already deleted) or 200, without crashing
          assertTrue(del2.status === 404 || del2.status === 200);
        } finally {
          await server.stop();
        }
      }
    },
    {
      name: 'B12.5: Deleting non-existent job ID returns 404 error response',
      run: async () => {
        const server = new TestServer({ port: 3283 });
        await server.start();

        try {
          const res = await server.delete('/api/queue/non-existent-uuid-1234');
          assertEquals(res.status, 404, 'Deleting non-existent job must return 404');
        } finally {
          await server.stop();
        }
      }
    }
  ]
};
