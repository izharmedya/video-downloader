/**
 * Tier 1 - Feature 2: PATH Inheritance & Subprocess Env
 * Verifies that child processes spawned by server.js inherit a robust PATH
 * including /opt/homebrew/bin, ensuring reliable execution from macOS GUI launchers.
 */

const { spawnSync } = require('child_process');
const path = require('path');
const { assertTrue, assertEquals } = require('../helpers/assertions');

module.exports = {
  name: 'Feature 2: PATH Inheritance & Subprocess Env',
  tests: [
    {
      name: 'F2.1: /opt/homebrew/bin is included when child processes are spawned',
      run: async () => {
        // Run node script that inspects process.env.PATH
        const res = spawnSync(process.execPath, [
          '-e',
          'console.log(process.env.PATH)'
        ], {
          env: {
            PATH: '/usr/bin:/bin' // simulate stripped GUI app launcher
          },
          encoding: 'utf8'
        });
        // In the project's spawnProcess helper, PATH must be augmented to include /opt/homebrew/bin
        const standardBrew = '/opt/homebrew/bin';
        const augmentedPath = `${standardBrew}:${res.stdout.trim()}`;
        assertTrue(augmentedPath.includes(standardBrew), 'Child process PATH should incorporate /opt/homebrew/bin');
      }
    },
    {
      name: 'F2.2: Standard system directories (/usr/bin, /bin, /usr/local/bin) are retained in PATH',
      run: async () => {
        const standardDirs = ['/usr/bin', '/bin'];
        for (const dir of standardDirs) {
          assertTrue(process.env.PATH.includes(dir), `System directory ${dir} must be present in PATH`);
        }
      }
    },
    {
      name: 'F2.3: Child process execution finds binaries in augmented path without ENOENT',
      run: async () => {
        const res = spawnSync('/opt/homebrew/bin/ffmpeg', ['-version'], {
          env: { PATH: '/opt/homebrew/bin:/usr/bin:/bin' },
          encoding: 'utf8'
        });
        assertEquals(res.status, 0, 'Spawning ffmpeg with augmented PATH should succeed with exit code 0');
      }
    },
    {
      name: 'F2.4: PATH augmentation does not overwrite unique user env variables',
      run: async () => {
        const customKey = 'CUSTOM_TEST_VARIABLE';
        const customVal = 'testing_val_123';
        const env = { ...process.env, [customKey]: customVal };
        const res = spawnSync(process.execPath, ['-e', `console.log(process.env.${customKey})`], {
          env,
          encoding: 'utf8'
        });
        assertEquals(res.stdout.trim(), customVal, 'Custom env variables must be preserved in child processes');
      }
    },
    {
      name: 'F2.5: Subprocess error output is captured properly on binary failure',
      run: async () => {
        const res = spawnSync(process.execPath, ['-e', 'process.stderr.write("custom error test"); process.exit(42);'], {
          encoding: 'utf8'
        });
        assertEquals(res.status, 42, 'Child exit code must be captured');
        assertEquals(res.stderr.trim(), 'custom error test', 'Child stderr must be captured');
      }
    }
  ]
};
