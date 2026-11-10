/**
 * Adversarial Test Suite 2: Shell & Command Injection Hardening
 * Tests aggressive command injection payloads against open, osascript,
 * show-file, open-dir, and notify routines.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { assertTrue, assertFalse, assertEquals } = require('../e2e/helpers/assertions');
const { TestServer } = require('../e2e/helpers/test-server');

module.exports = {
  name: 'Adversarial 2: Shell & Command Injection Hardening',
  tests: [
    {
      name: 'Adv2.1: POST /api/open-dir with shell injection metacharacters does NOT execute commands',
      run: async () => {
        const markerFile = path.join(os.tmpdir(), `adv_pwn_open_dir_${Date.now()}`);
        if (fs.existsSync(markerFile)) fs.unlinkSync(markerFile);

        const server = new TestServer({ port: 3311 });
        await server.start();

        const injectionPayloads = [
          `; touch ${markerFile} ;`,
          `| touch ${markerFile}`,
          `& touch ${markerFile}`,
          `$(touch ${markerFile})`,
          `\`touch ${markerFile}\``,
          `\ntouch ${markerFile}\n`,
          `&& touch ${markerFile} &&`,
          `|| touch ${markerFile} ||`,
          `${server.downloadDir}; touch ${markerFile}`,
          `' ; touch ${markerFile} ; '`,
          `" ; touch ${markerFile} ; "`
        ];

        try {
          for (const payload of injectionPayloads) {
            const res = await server.post('/api/open-dir', { path: payload });
            assertFalse(fs.existsSync(markerFile), `Payload "${payload}" must not execute shell commands`);
          }
        } finally {
          await server.stop();
          try { if (fs.existsSync(markerFile)) fs.unlinkSync(markerFile); } catch {}
        }
      }
    },
    {
      name: 'Adv2.2: POST /api/show-file with non-existent injection path does NOT execute commands',
      run: async () => {
        const markerFile = path.join(os.tmpdir(), `adv_pwn_show_file_${Date.now()}`);
        if (fs.existsSync(markerFile)) fs.unlinkSync(markerFile);

        const server = new TestServer({ port: 3312 });
        await server.start();

        const injectionPayloads = [
          `/tmp/fake; touch ${markerFile}`,
          `/tmp/fake" && touch ${markerFile} && "`,
          `/tmp/fake' | touch ${markerFile} | '`,
          `/tmp/$(touch ${markerFile})`,
          `/tmp/\`touch ${markerFile}\``
        ];

        try {
          for (const payload of injectionPayloads) {
            const res = await server.post('/api/show-file', { path: payload });
            // Should return 404 since path does not exist
            assertEquals(res.status, 404, `Non-existent injection path should 404, got ${res.status}`);
            assertFalse(fs.existsSync(markerFile), `Payload "${payload}" must not trigger code execution`);
          }
        } finally {
          await server.stop();
          try { if (fs.existsSync(markerFile)) fs.unlinkSync(markerFile); } catch {}
        }
      }
    },
    {
      name: 'Adv2.3: POST /api/show-file on existing file with metacharacters in filename does NOT execute shell',
      run: async () => {
        const markerName = `adv_pwn_file_${Date.now()}`;
        const markerFile = path.join(process.cwd(), markerName);
        if (fs.existsSync(markerFile)) fs.unlinkSync(markerFile);

        const server = new TestServer({ port: 3313 });
        await server.start();

        // Create an actual file whose name contains shell injection syntax without path separators
        const dangerousFileName = `test$(touch ${markerName})_${Date.now()}.mp4`;
        const dangerousFilePath = path.join(server.downloadDir, dangerousFileName);
        fs.writeFileSync(dangerousFilePath, 'dummy video payload');

        try {
          const res = await server.post('/api/show-file', { path: dangerousFilePath });
          assertEquals(res.status, 200, `Existing file should return 200 OK, got ${res.status}`);
          assertFalse(fs.existsSync(markerFile), 'Showing file with shell metacharacters must NOT execute subshell');
        } finally {
          await server.stop();
          try { if (fs.existsSync(dangerousFilePath)) fs.unlinkSync(dangerousFilePath); } catch {}
          try { if (fs.existsSync(markerFile)) fs.unlinkSync(markerFile); } catch {}
        }
      }
    },
    {
      name: 'Adv2.4: AppleScript injection against notify routine does NOT execute arbitrary shell script',
      run: async () => {
        const markerFile = path.join(os.tmpdir(), `adv_pwn_osascript_${Date.now()}`);
        if (fs.existsSync(markerFile)) fs.unlinkSync(markerFile);

        const server = new TestServer({ port: 3314 });
        await server.start();

        // Craft jobs with hostile titles attempting AppleScript escape and subshell execution
        const hostileTitles = [
          `" with title "injected" -- do shell script "touch ${markerFile}"`,
          `\\" with title "injected" & (do shell script "touch ${markerFile}") & "`,
          `test\n" & do shell script "touch ${markerFile}" & "\n`,
          `\'; do shell script "touch ${markerFile}"; --`,
          `$(touch ${markerFile})`,
          `\`touch ${markerFile}\``
        ];

        try {
          for (const title of hostileTitles) {
            // Queue a job with this title that immediately fails to trigger notify()
            const addRes = await server.post('/api/queue/add', {
              url: 'http://127.0.0.1:59999/fail-trigger.mp4',
              title: title
            });
            assertEquals(addRes.status, 200);
          }

          // Allow background job to attempt download, fail, and trigger notify()
          await new Promise(r => setTimeout(r, 2000));

          assertFalse(fs.existsSync(markerFile), 'AppleScript injection via notification must NOT execute shell command');
        } finally {
          await server.stop();
          try { if (fs.existsSync(markerFile)) fs.unlinkSync(markerFile); } catch {}
        }
      }
    },
    {
      name: 'Adv2.5: Non-string and malformed inputs to open-dir and show-file do not crash server',
      run: async () => {
        const server = new TestServer({ port: 3315 });
        await server.start();

        try {
          const malformedInputs = [
            null,
            undefined,
            12345,
            true,
            false,
            {},
            [],
            { path: 123 },
            { path: true },
            { path: {} }
          ];

          for (const input of malformedInputs) {
            const resDir = await server.post('/api/open-dir', input);
            assertTrue(resDir.status === 400 || resDir.status === 200 || resDir.status === 404,
              `open-dir should handle malformed input gracefully, got status ${resDir.status}`);

            const resFile = await server.post('/api/show-file', input);
            assertTrue(resFile.status === 400 || resFile.status === 404,
              `show-file should handle malformed input gracefully, got status ${resFile.status}`);
          }
        } finally {
          await server.stop();
        }
      }
    }
  ]
};
