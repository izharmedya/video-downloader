/**
 * Tier 2 - Boundary 2: PATH Inheritance Boundaries
 * Tests edge cases in subprocess PATH environments:
 * empty PATH, redundant colons, spaces/unicode directories, and trailing slashes.
 */

const { spawnSync } = require('child_process');
const { assertTrue, assertEquals } = require('../helpers/assertions');

module.exports = {
  name: 'Boundary 2: PATH Inheritance Boundaries',
  tests: [
    {
      name: 'B2.1: Absolute binary path executes successfully even when PATH is empty',
      run: async () => {
        const res = spawnSync('/opt/homebrew/bin/ffmpeg', ['-version'], {
          env: { PATH: '' },
          encoding: 'utf8'
        });
        assertEquals(res.status, 0, 'Absolute path to ffmpeg must run even with empty PATH');
      }
    },
    {
      name: 'B2.2: Redundant colons in PATH (::) do not cause spawn failure',
      run: async () => {
        const res = spawnSync('/bin/ls', ['/tmp'], {
          env: { PATH: '/opt/homebrew/bin::/usr/bin::/bin' },
          encoding: 'utf8'
        });
        assertEquals(res.status, 0, 'Redundant colons in PATH must not fail process execution');
      }
    },
    {
      name: 'B2.3: PATH containing directory with spaces does not throw error',
      run: async () => {
        const pathWithSpaces = `/opt/homebrew/bin:/usr/bin:/path with spaces/bin`;
        const res = spawnSync('/bin/echo', ['hello'], {
          env: { PATH: pathWithSpaces },
          encoding: 'utf8'
        });
        assertEquals(res.status, 0);
      }
    },
    {
      name: 'B2.4: PATH entry with trailing slash resolves correctly',
      run: async () => {
        const pathWithSlash = `/opt/homebrew/bin/:/usr/bin/`;
        const res = spawnSync('/bin/echo', ['test'], {
          env: { PATH: pathWithSlash },
          encoding: 'utf8'
        });
        assertEquals(res.status, 0);
      }
    },
    {
      name: 'B2.5: Exceptionally long PATH string (>2048 chars) does not crash subprocess spawn',
      run: async () => {
        const hugePath = '/opt/homebrew/bin:/usr/bin:' + new Array(150).fill('/non/existent/dir').join(':');
        const res = spawnSync('/bin/echo', ['huge'], {
          env: { PATH: hugePath },
          encoding: 'utf8'
        });
        assertEquals(res.status, 0);
      }
    }
  ]
};
