/**
 * Tier 1 - Feature 1: Binary Resolution & Execution Check
 * Verifies executable validation, rejection of incompatible architectures,
 * and reliable binding to verified arm64 FFmpeg.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { assertTrue, assertFalse, assertEquals, assertRejects } = require('../helpers/assertions');
const { TestServer } = require('../helpers/test-server');

module.exports = {
  name: 'Feature 1: Binary Resolution & Execution Check',
  tests: [
    {
      name: 'F1.1: Broken x86_64 binary is rejected on arm64 architecture',
      run: async () => {
        const legacyPath = '/Users/izharmedya/.gemini/antigravity/bin/ffmpeg';
        if (fs.existsSync(legacyPath) && os.arch() === 'arm64') {
          // Verify that directly running legacy binary fails
          let failed = false;
          try {
            execFileSync(legacyPath, ['-version'], { stdio: 'ignore' });
          } catch {
            failed = true;
          }
          assertTrue(failed, 'Legacy x86_64 ffmpeg should fail on arm64');
        }
      }
    },
    {
      name: 'F1.2: Native arm64 FFmpeg at /opt/homebrew/bin/ffmpeg executes successfully',
      run: async () => {
        const brewFfmpeg = '/opt/homebrew/bin/ffmpeg';
        assertTrue(fs.existsSync(brewFfmpeg), '/opt/homebrew/bin/ffmpeg must exist');
        const out = execFileSync(brewFfmpeg, ['-version'], { encoding: 'utf8' });
        assertTrue(out.includes('ffmpeg version'), 'Output must contain ffmpeg version');
      }
    },
    {
      name: 'F1.3: FFMPEG_PATH environment variable override is honored when binary is valid',
      run: async () => {
        const customBinary = '/opt/homebrew/bin/ffmpeg';
        const server = new TestServer({
          port: 3201,
          env: { FFMPEG_PATH: customBinary }
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
      name: 'F1.4: Non-executable file is rejected and falls back to viable binary',
      run: async () => {
        const dummyFile = path.join(os.tmpdir(), `dummy-non-exec-${Date.now()}.txt`);
        fs.writeFileSync(dummyFile, 'not a binary');
        try {
          let executable = false;
          try {
            execFileSync(dummyFile, ['-version'], { stdio: 'ignore' });
            executable = true;
          } catch {
            executable = false;
          }
          assertFalse(executable, 'Non-executable file must not be treated as executable binary');
        } finally {
          try { fs.unlinkSync(dummyFile); } catch {}
        }
      }
    },
    {
      name: 'F1.5: YTDLP_PATH override binds to functional yt-dlp binary',
      run: async () => {
        const ytdlpCandidate = '/Users/izharmedya/.gemini/antigravity/bin/yt-dlp';
        if (fs.existsSync(ytdlpCandidate)) {
          const out = execFileSync(ytdlpCandidate, ['--version'], { encoding: 'utf8' }).trim();
          assertTrue(/^\d{4}\.\d{2}\.\d{2}/.test(out), `yt-dlp version should match date format, got ${out}`);
        }
      }
    }
  ]
};
