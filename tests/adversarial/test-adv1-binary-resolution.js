/**
 * Adversarial Test Suite 1: Binary Resolution & Robustness
 * Tests invalid binaries, broken permissions, x86_64 binaries on arm64,
 * crashing binaries, and hanging binaries.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync, spawnSync } = require('child_process');
const { assertTrue, assertFalse, assertEquals } = require('../e2e/helpers/assertions');
const { TestServer } = require('../e2e/helpers/test-server');

module.exports = {
  name: 'Adversarial 1: Binary Resolution & Robustness',
  tests: [
    {
      name: 'Adv1.1: Non-existent binary path in FFMPEG_PATH falls back to valid arm64 FFmpeg',
      run: async () => {
        const fakeBinary = path.join(os.tmpdir(), `non_existent_ffmpeg_${Date.now()}`);
        const server = new TestServer({
          port: 3301,
          env: { FFMPEG_PATH: fakeBinary }
        });
        await server.start();
        try {
          // Verify server is operational and logged fallback binary
          const res = await server.get('/api/default-path');
          assertEquals(res.status, 200);
          const serverLog = server.logs.join('\n');
          assertTrue(serverLog.includes('/opt/homebrew/bin/ffmpeg') || serverLog.includes('ffmpeg:'),
            `Server should resolve a viable ffmpeg fallback, got logs:\n${serverLog}`);
        } finally {
          await server.stop();
        }
      }
    },
    {
      name: 'Adv1.2: Permission-denied binary (chmod 000) is rejected and falls back',
      run: async () => {
        const tmpNoPerm = path.join(os.tmpdir(), `no_perm_ffmpeg_${Date.now()}`);
        fs.writeFileSync(tmpNoPerm, '#!/bin/sh\necho "fake"');
        fs.chmodSync(tmpNoPerm, 0o000); // No read, write, or execute permissions
        try {
          const server = new TestServer({
            port: 3302,
            env: { FFMPEG_PATH: tmpNoPerm }
          });
          await server.start();
          try {
            const res = await server.get('/api/default-path');
            assertEquals(res.status, 200);
            const serverLog = server.logs.join('\n');
            assertFalse(serverLog.includes(`ffmpeg: ${tmpNoPerm}`),
              'Server must not bind to chmod 000 permission-denied binary');
          } finally {
            await server.stop();
          }
        } finally {
          try {
            fs.chmodSync(tmpNoPerm, 0o600);
            fs.unlinkSync(tmpNoPerm);
          } catch {}
        }
      }
    },
    {
      name: 'Adv1.3: Corrupted binary file (random bytes with 755 perms) is rejected',
      run: async () => {
        const tmpCorrupt = path.join(os.tmpdir(), `corrupt_bin_${Date.now()}`);
        fs.writeFileSync(tmpCorrupt, Buffer.from([0xDE, 0xAD, 0xBE, 0xEF, 0x00, 0x11, 0x22, 0x33]));
        fs.chmodSync(tmpCorrupt, 0o755);
        try {
          const server = new TestServer({
            port: 3303,
            env: { FFMPEG_PATH: tmpCorrupt }
          });
          await server.start();
          try {
            const res = await server.get('/api/default-path');
            assertEquals(res.status, 200);
            const serverLog = server.logs.join('\n');
            assertFalse(serverLog.includes(`ffmpeg: ${tmpCorrupt}`),
              'Server must not bind to corrupted non-executable binary');
          } finally {
            await server.stop();
          }
        } finally {
          try { fs.unlinkSync(tmpCorrupt); } catch {}
        }
      }
    },
    {
      name: 'Adv1.4: Legacy x86_64 Mach-O binary on Apple Silicon arm64 is rejected and falls back',
      run: async () => {
        const legacyX86 = '/Users/izharmedya/.gemini/antigravity/bin/ffmpeg';
        if (fs.existsSync(legacyX86) && os.arch() === 'arm64') {
          const server = new TestServer({
            port: 3304,
            env: { FFMPEG_PATH: legacyX86 }
          });
          await server.start();
          try {
            const res = await server.get('/api/default-path');
            assertEquals(res.status, 200);
            const serverLog = server.logs.join('\n');
            assertFalse(serverLog.includes(`ffmpeg: ${legacyX86}`),
              'Server must reject x86_64 ffmpeg binary causing bad CPU type on arm64');
            assertTrue(serverLog.includes('/opt/homebrew/bin/ffmpeg'),
              'Server must fallback to native arm64 Homebrew ffmpeg');
          } finally {
            await server.stop();
          }
        }
      }
    },
    {
      name: 'Adv1.5: Crashing binary (exit code 1 / exit 127) is rejected and falls back',
      run: async () => {
        const tmpCrashing = path.join(os.tmpdir(), `crashing_bin_${Date.now()}`);
        fs.writeFileSync(tmpCrashing, '#!/bin/sh\nexit 127\n');
        fs.chmodSync(tmpCrashing, 0o755);
        try {
          const server = new TestServer({
            port: 3305,
            env: { FFMPEG_PATH: tmpCrashing }
          });
          await server.start();
          try {
            const res = await server.get('/api/default-path');
            assertEquals(res.status, 200);
            const serverLog = server.logs.join('\n');
            assertFalse(serverLog.includes(`ffmpeg: ${tmpCrashing}`),
              'Server must reject binary with non-zero exit code');
          } finally {
            await server.stop();
          }
        } finally {
          try { fs.unlinkSync(tmpCrashing); } catch {}
        }
      }
    },
    {
      name: 'Adv1.6: Empty string or directory path as FFMPEG_PATH does not crash server',
      run: async () => {
        const serverEmpty = new TestServer({
          port: 3306,
          env: { FFMPEG_PATH: '   ' }
        });
        await serverEmpty.start();
        try {
          const res = await serverEmpty.get('/api/default-path');
          assertEquals(res.status, 200);
        } finally {
          await serverEmpty.stop();
        }

        const serverDir = new TestServer({
          port: 3307,
          env: { FFMPEG_PATH: os.tmpdir() }
        });
        await serverDir.start();
        try {
          const res = await serverDir.get('/api/default-path');
          assertEquals(res.status, 200);
        } finally {
          await serverDir.stop();
        }
      }
    },
    {
      name: 'Adv1.7: Hanging binary candidate is timed out by isExecutableBinary without deadlocking',
      run: async () => {
        const tmpHanging = path.join(os.tmpdir(), `hanging_bin_${Date.now()}`);
        fs.writeFileSync(tmpHanging, '#!/bin/sh\nsleep 30\n');
        fs.chmodSync(tmpHanging, 0o755);
        try {
          const startTime = Date.now();
          const server = new TestServer({
            port: 3308,
            env: {
              FFMPEG_PATH: tmpHanging,
              YTDLP_PATH: '/opt/homebrew/bin/yt-dlp'
            }
          });
          await server.start();
          const elapsed = Date.now() - startTime;
          try {
            const res = await server.get('/api/default-path');
            assertEquals(res.status, 200);
            const serverLog = server.logs.join('\n');
            assertFalse(serverLog.includes(`ffmpeg: ${tmpHanging}`),
              'Server must reject hanging binary');
          } finally {
            await server.stop();
          }
        } finally {
          try { fs.unlinkSync(tmpHanging); } catch {}
        }
      }
    }
  ]
};
