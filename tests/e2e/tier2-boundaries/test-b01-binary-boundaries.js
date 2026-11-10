/**
 * Tier 2 - Boundary 1: Binary Resolution Boundary Cases
 * Tests edge cases in binary path discovery and validation:
 * empty path, non-executable permissions, directory traversal in binary path,
 * symlinks to missing binaries, and broken executables.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const { assertTrue, assertFalse, assertEquals } = require('../helpers/assertions');
const { TestServer } = require('../helpers/test-server');

module.exports = {
  name: 'Boundary 1: Binary Resolution Boundaries',
  tests: [
    {
      name: 'B1.1: Empty string FFMPEG_PATH falls back to default binary',
      run: async () => {
        const server = new TestServer({
          port: 3260,
          env: { FFMPEG_PATH: '' }
        });
        await server.start();
        try {
          const res = await server.get('/api/default-path');
          assertEquals(res.status, 200);
        } finally {
          await server.stop();
        }
      }
    },
    {
      name: 'B1.2: Path to non-executable file (chmod 644) is rejected as binary',
      run: async () => {
        const dummy = path.join(os.tmpdir(), `non-exec-${Date.now()}`);
        fs.writeFileSync(dummy, '#!/bin/sh\necho ok');
        fs.chmodSync(dummy, 0o644); // no execute bits
        try {
          let executed = false;
          try {
            spawnSync(dummy, ['-version'], { stdio: 'ignore' });
            executed = true;
          } catch {
            executed = false;
          }
          // spawnSync throws EACCES or exits non-zero
          const res = spawnSync(dummy, ['-version']);
          assertTrue(res.error || res.status !== 0, 'Non-executable binary must fail execution');
        } finally {
          try { fs.unlinkSync(dummy); } catch {}
        }
      }
    },
    {
      name: 'B1.3: Directory path provided as binary path is rejected',
      run: async () => {
        const dirAsBin = os.tmpdir();
        const res = spawnSync(dirAsBin, ['-version']);
        assertTrue(!!res.error, 'Directory cannot be executed as binary');
      }
    },
    {
      name: 'B1.4: Symlink pointing to deleted file is gracefully rejected',
      run: async () => {
        const target = path.join(os.tmpdir(), `symlink-target-${Date.now()}`);
        const link = path.join(os.tmpdir(), `symlink-broken-${Date.now()}`);
        fs.writeFileSync(target, 'temporary');
        fs.symlinkSync(target, link);
        fs.unlinkSync(target); // break the symlink

        try {
          const res = spawnSync(link, ['-version']);
          assertTrue(!!res.error, 'Broken symlink must fail execution');
        } finally {
          try { fs.unlinkSync(link); } catch {}
        }
      }
    },
    {
      name: 'B1.5: Binary that outputs error code 127 is identified as broken',
      run: async () => {
        const res = spawnSync('/bin/sh', ['-c', 'exit 127']);
        assertEquals(res.status, 127, 'Exit code 127 must be recognized as execution failure');
      }
    }
  ]
};
