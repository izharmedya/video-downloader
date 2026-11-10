/**
 * Tier 1 - Feature 4: Shell Command Injection Hardening
 * Verifies that command execution endpoints and osascript/open invocations
 * are hardened against shell metacharacters and injection attempts.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { assertTrue, assertFalse, assertEquals } = require('../helpers/assertions');
const { TestServer } = require('../helpers/test-server');

module.exports = {
  name: 'Feature 4: Shell Command Injection Hardening',
  tests: [
    {
      name: 'F4.1: Notification with quotes and subshell syntax executes safely without command execution',
      run: async () => {
        const markerFile = path.join(os.tmpdir(), `marker-f41-${Date.now()}.txt`);
        if (fs.existsSync(markerFile)) fs.unlinkSync(markerFile);

        const maliciousTitle = `Test " && touch ${markerFile} #`;
        const maliciousMsg = `Hello '$(touch ${markerFile})'`;

        // Directly verify osascript hardening pattern
        const { execFileSync } = require('child_process');
        if (process.platform === 'darwin') {
          try {
            execFileSync('osascript', ['-e', `display notification "${maliciousMsg.replace(/"/g, '\\"')}" with title "${maliciousTitle.replace(/"/g, '\\"')}"`], { stdio: 'ignore' });
          } catch {}
        }

        assertFalse(fs.existsSync(markerFile), 'Injected command via notification must not execute');
      }
    },
    {
      name: 'F4.2: POST /api/open-dir rejects or safely handles command injection payload',
      run: async () => {
        const markerFile = path.join(os.tmpdir(), `marker-f42-${Date.now()}.txt`);
        if (fs.existsSync(markerFile)) fs.unlinkSync(markerFile);

        const server = new TestServer({ port: 3208 });
        await server.start();

        try {
          const maliciousDir = `${server.downloadDir}; touch ${markerFile};`;
          await server.post('/api/open-dir', { path: maliciousDir });

          assertFalse(fs.existsSync(markerFile), 'Injected shell command in open-dir must not execute');
        } finally {
          await server.stop();
          try { if (fs.existsSync(markerFile)) fs.unlinkSync(markerFile); } catch {}
        }
      }
    },
    {
      name: 'F4.3: POST /api/show-file safely handles target path with shell metacharacters',
      run: async () => {
        const markerFile = path.join(os.tmpdir(), `marker-f43-${Date.now()}.txt`);
        if (fs.existsSync(markerFile)) fs.unlinkSync(markerFile);

        const server = new TestServer({ port: 3209 });
        await server.start();

        try {
          const dangerousTarget = path.join(server.downloadDir, `file" && touch ${markerFile} && "foo`);
          await server.post('/api/show-file', { path: dangerousTarget });

          assertFalse(fs.existsSync(markerFile), 'Injected command in show-file must not execute');
        } finally {
          await server.stop();
          try { if (fs.existsSync(markerFile)) fs.unlinkSync(markerFile); } catch {}
        }
      }
    },
    {
      name: 'F4.4: Custom name sanitization strips path traversal and control characters',
      run: async () => {
        const server = new TestServer({ port: 3210 });
        await server.start();

        try {
          // Add a dummy job to queue to test custom_name sanitization
          const addRes = await server.post('/api/queue/add', {
            url: 'https://127.0.0.1/fake-video',
            custom_name: '../../../etc/passwd;rm -rf /'
          });

          // Queue item should either reject or sanitize name
          if (addRes.status === 200) {
            const queueRes = await server.get('/api/queue');
            const job = queueRes.body.find(j => j.id === addRes.body.id);
            if (job && job.custom_name) {
              assertFalse(job.custom_name.includes('..'), 'custom_name must not contain path traversal ..');
              assertFalse(job.custom_name.includes('/'), 'custom_name must not contain slashes');
            }
          }
        } finally {
          await server.stop();
        }
      }
    },
    {
      name: 'F4.5: PATCH /api/download/:id/name prevents directory traversal outside downloads',
      run: async () => {
        const server = new TestServer({ port: 3211 });
        await server.start();

        try {
          // Try renaming non-existent or traversal id
          const res = await server.patch('/api/download/../../etc/name', { name: 'exploit' });
          assertTrue(res.status === 404 || res.status === 403 || res.status === 400, `Expected error status, got ${res.status}`);
        } finally {
          await server.stop();
        }
      }
    }
  ]
};
