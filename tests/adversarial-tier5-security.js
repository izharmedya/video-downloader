/**
 * Suite ADV-5B & ADV-5E: Tier 5 White-Box Adversarial Security Stress Harness
 * VideoDownloader Project
 *
 * Covers:
 * 1. Deep path traversal in custom_name (../../../../etc/passwd, %2e%2e%2f, null bytes, backslashes).
 * 2. Maximum filename length boundary (>255 bytes, 300-char stems).
 * 3. Malformed cookie headers (Cookie: vd_token=; invalid;; =value; __proto__=evil, prototype pollution).
 * 4. CRLF and control character injections across all query parameters and JSON payloads.
 * 5. Rate limiting enforcement on /api/login (5 req/min) and /api/queue/add (10 req/min).
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');
const assert = require('assert');
const { spawn } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const SERVER_JS_PATH = path.join(ROOT_DIR, 'server.js');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const testResults = [];

function suite(name) {
  console.log(`\n=================================================================`);
  console.log(`  ${name}`);
  console.log(`=================================================================`);
}

async function test(name, fn) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`  ✓ ${name}`);
    testResults.push({ name, pass: true });
  } catch (err) {
    failedTests++;
    console.error(`  ✗ ${name}`);
    console.error(`    Error: ${err.message}`);
    testResults.push({ name, pass: false, error: err.message });
  }
}

// ── Isolated Test Server Helper ──────────────────────────────────
class AdversarialServer {
  constructor(port, envOverrides = {}) {
    this.port = port;
    this.host = '127.0.0.1';
    this.downloadDir = path.join(os.tmpdir(), `vd-adv-tier5-${port}-${Date.now()}`);
    this.proc = null;
    this.envOverrides = envOverrides;
  }

  async start() {
    fs.mkdirSync(this.downloadDir, { recursive: true });

    const serverEnv = {
      ...process.env,
      PORT: String(this.port),
      HOST: this.host,
      DOWNLOADS_DIR: this.downloadDir,
      FFMPEG_PATH: process.env.FFMPEG_PATH || '/opt/homebrew/bin/ffmpeg',
      FFPROBE_PATH: process.env.FFPROBE_PATH || '/opt/homebrew/bin/ffprobe',
      ...this.envOverrides,
    };

    this.proc = spawn(process.execPath, [SERVER_JS_PATH], {
      env: serverEnv,
      cwd: ROOT_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const start = Date.now();
    const timeout = 10000;
    while (Date.now() - start < timeout) {
      try {
        const ok = await new Promise((resolve) => {
          const req = http.get({ hostname: this.host, port: this.port, path: '/' }, (res) => {
            resolve(res.statusCode < 500);
          });
          req.on('error', () => resolve(false));
          req.setTimeout(300, () => { req.destroy(); resolve(false); });
        });
        if (ok) return;
      } catch {}
      await new Promise(r => setTimeout(r, 100));
    }
    throw new Error(`Adversarial test server on port ${this.port} failed to start in ${timeout}ms`);
  }

  async stop() {
    if (this.proc) {
      try { this.proc.kill('SIGKILL'); } catch {}
      this.proc = null;
    }
    try {
      if (fs.existsSync(this.downloadDir)) {
        fs.rmSync(this.downloadDir, { recursive: true, force: true });
      }
    } catch {}
  }

  request(method, endpoint, body = null, headers = {}) {
    return new Promise((resolve, reject) => {
      const postData = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
      const reqHeaders = {
        'Accept': 'application/json',
        ...headers,
      };
      if (postData) {
        reqHeaders['Content-Type'] = reqHeaders['Content-Type'] || 'application/json';
        reqHeaders['Content-Length'] = Buffer.byteLength(postData);
      }

      const req = http.request({
        hostname: this.host,
        port: this.port,
        path: endpoint,
        method,
        headers: reqHeaders,
      }, (res) => {
        let raw = '';
        res.on('data', chunk => raw += chunk);
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(raw); } catch {}
          resolve({ status: res.statusCode, headers: res.headers, raw, json });
        });
      });

      req.on('error', reject);
      if (postData) req.write(postData);
      req.end();
    });
  }
}

// ── Main Execution Harness ───────────────────────────────────────
async function runAll() {
  console.log('Starting Suite ADV-5B & Suite ADV-5E Adversarial Stress Verification...\n');

  // ─────────────────────────────────────────────────────────────────
  // SUITE ADV-5B: Filesystem, Path Traversal & Filename Boundaries
  // ─────────────────────────────────────────────────────────────────
  suite('Suite ADV-5B: Path Traversal & Filename Length Boundaries');

  const srvB = new AdversarialServer(3410, { IZ_LOCAL: '1' });
  await srvB.start();

  try {
    await test('ADV-5B.1a: custom_name directory traversal in /api/queue/add is sanitized to basename', async () => {
      const payloads = [
        { raw: '../../../../etc/passwd', expected: 'passwd' },
        { raw: '../../../../var/log/system.log', expected: 'system.log' },
        { raw: '../../../tmp/evil_payload', expected: 'evil_payload' },
        { raw: '/etc/shadow', expected: 'shadow' },
      ];

      for (const { raw, expected } of payloads) {
        const res = await srvB.request('POST', '/api/queue/add', {
          url: 'https://example.com/video',
          custom_name: raw,
        }, { 'X-Forwarded-For': '127.0.1.1' });
        assert.strictEqual(res.status, 200, `Expected 200 for payload: ${raw}`);

        const queueRes = await srvB.request('GET', '/api/queue');
        const job = queueRes.json.find(j => j.id === res.json.id);
        assert.ok(job, `Job with ID ${res.json.id} must be in queue`);
        assert.strictEqual(job.custom_name, expected, `Stored custom_name must be sanitized to "${expected}", got "${job.custom_name}"`);
        assert.ok(!job.custom_name.includes('/'), `custom_name must not contain directory slashes`);
        assert.ok(!job.custom_name.includes('..'), `custom_name must not contain traversal dots`);
      }
    });

    await test('ADV-5B.1b: URL-encoded traversal (%2e%2e%2f) does NOT escape download directory', async () => {
      const res = await srvB.request('POST', '/api/queue/add', {
        url: 'https://example.com/video',
        custom_name: '%2e%2e%2f%2e%2e%2fetc%2fpasswd',
      }, { 'X-Forwarded-For': '127.0.1.2' });
      assert.strictEqual(res.status, 200);

      const queueRes = await srvB.request('GET', '/api/queue');
      const job = queueRes.json.find(j => j.id === res.json.id);
      assert.ok(job);
      // Literal %2e%2e%2f contains % chars, NOT directory slashes
      assert.ok(!job.custom_name.includes('/'), 'URL-encoded string must not contain raw slashes');
      // When resolved into download directory, relative path must remain strictly inside downloadDir
      const resolvedTarget = path.resolve(srvB.downloadDir, `${job.custom_name}.mp4`);
      const rel = path.relative(srvB.downloadDir, resolvedTarget);
      assert.ok(!rel.startsWith('..') && !path.isAbsolute(rel), `Target "${resolvedTarget}" must remain inside downloadDir "${srvB.downloadDir}"`);
    });

    await test('ADV-5B.1c: Windows-style backslash traversal is sanitized', async () => {
      const res = await srvB.request('POST', '/api/queue/add', {
        url: 'https://example.com/video',
        custom_name: '..\\..\\..\\Windows\\win.ini',
      }, { 'X-Forwarded-For': '127.0.1.3' });
      assert.strictEqual(res.status, 200);

      const queueRes = await srvB.request('GET', '/api/queue');
      const job = queueRes.json.find(j => j.id === res.json.id);
      assert.ok(job);
      assert.ok(!job.custom_name.includes('\\'), `Backslashes must be sanitized out: "${job.custom_name}"`);
      assert.ok(!job.custom_name.includes('/'), `Slashes must not exist: "${job.custom_name}"`);
    });

    await test('ADV-5B.1d: Null-byte injection in custom_name is stripped or replaced', async () => {
      const res = await srvB.request('POST', '/api/queue/add', {
        url: 'https://example.com/video',
        custom_name: 'safe_name\u0000../../../../etc/passwd',
      }, { 'X-Forwarded-For': '127.0.1.4' });
      assert.strictEqual(res.status, 200);

      const queueRes = await srvB.request('GET', '/api/queue');
      const job = queueRes.json.find(j => j.id === res.json.id);
      assert.ok(job);
      assert.ok(!job.custom_name.includes('\u0000'), 'Null byte must not be present');
      assert.ok(!job.custom_name.includes('/'), 'Slash must not be present');
      assert.ok(!job.custom_name.includes('..'), 'Parent directory dots must not be present');
    });

    await test('ADV-5B.1e: Dot-only and slash-only stems fall back safely without path traversal', async () => {
      const edgeCases = ['...', '....//....//....//', '.', '..', '   '];
      let ipSub = 1;
      for (const stem of edgeCases) {
        const res = await srvB.request('POST', '/api/queue/add', {
          url: 'https://example.com/video',
          custom_name: stem,
        }, { 'X-Forwarded-For': `127.0.2.${ipSub++}` });
        assert.strictEqual(res.status, 200);

        const queueRes = await srvB.request('GET', '/api/queue');
        const job = queueRes.json.find(j => j.id === res.json.id);
        assert.ok(job);
        // Stored custom_name must be empty or null (falling back to %(title)s in startJob)
        assert.strictEqual(job.custom_name, '', `Expected empty fallback custom_name for "${stem}", got "${job.custom_name}"`);
      }
    });

    await test('ADV-5B.1f: PATCH /api/download/:id/name strictly confines renamed files inside downloadsDir', async () => {
      // Create a test physical file inside downloadDir and register in history.json
      const testFile = path.join(srvB.downloadDir, 'adv_original.mp4');
      fs.writeFileSync(testFile, 'dummy media content');

      const historyPath = path.join(srvB.downloadDir, 'history.json');
      const dummyJob = {
        id: 'adv-job-rename-test',
        status: 'done',
        filename: testFile,
        title: 'Adv Test Video',
        custom_name: 'adv_original',
        addedAt: new Date().toISOString(),
        doneAt: new Date().toISOString(),
      };
      fs.writeFileSync(historyPath, JSON.stringify([dummyJob]));

      const traversalAttempts = [
        '../../../../etc/passwd',
        '..%2f..%2f..%2fetc%2fpasswd',
        '..\\..\\..\\tmp\\evil_rename',
        '/etc/shadow',
      ];

      for (const attack of traversalAttempts) {
        const res = await srvB.request('PATCH', `/api/download/${dummyJob.id}/name`, { name: attack });
        assert.strictEqual(res.status, 200, `Expected 200 for rename with "${attack}", got ${res.status}`);

        const newTarget = res.json.filename;
        assert.ok(newTarget, 'Expected new filename in response');
        const rel = path.relative(srvB.downloadDir, newTarget);
        assert.ok(!rel.startsWith('..') && !path.isAbsolute(rel), `Renamed file "${newTarget}" must remain inside downloadsDir "${srvB.downloadDir}"`);
        assert.ok(fs.existsSync(newTarget), `Renamed file must physically exist at "${newTarget}"`);
        assert.ok(!fs.existsSync(path.resolve('/etc/passwd.mp4')), 'Must not write to root filesystem');
      }
    });

    await test('ADV-5B.1g: GET /api/download/:id with path traversal ID does NOT serve arbitrary files', async () => {
      const res = await srvB.request('GET', '/api/download/..%2f..%2fetc%2fpasswd');
      assert.strictEqual(res.status, 404, 'Must return 404 for traversal ID');
      assert.ok(!res.raw.includes('root:x:0:0:'), 'Must not leak /etc/passwd contents');
    });

    await test('ADV-5B.2a: Maximum Filename Length: 300-char ASCII stem is clamped to 180 chars without ENAMETOOLONG', async () => {
      const longStem = 'A'.repeat(300);
      const res = await srvB.request('POST', '/api/queue/add', {
        url: 'https://example.com/video',
        custom_name: longStem,
      }, { 'X-Forwarded-For': '127.0.3.1' });
      assert.strictEqual(res.status, 200);

      const queueRes = await srvB.request('GET', '/api/queue');
      const job = queueRes.json.find(j => j.id === res.json.id);
      assert.ok(job);
      assert.strictEqual(job.custom_name.length, 180, `Stem length must be clamped to 180 chars, got ${job.custom_name.length}`);
      assert.strictEqual(job.custom_name, 'A'.repeat(180));

      // Test physical file write with 180-char stem
      const physicalTarget = path.join(srvB.downloadDir, `${job.custom_name}.mp4`);
      fs.writeFileSync(physicalTarget, 'dummy');
      assert.ok(fs.existsSync(physicalTarget), 'Physical file write with 180-char stem must succeed');
      fs.unlinkSync(physicalTarget);
    });

    await test('ADV-5B.2b: PATCH /api/download/:id/name with 300-char stem renames successfully without ENAMETOOLONG', async () => {
      const testFile = path.join(srvB.downloadDir, 'before_long_rename.mp4');
      fs.writeFileSync(testFile, 'dummy content');

      const historyPath = path.join(srvB.downloadDir, 'history.json');
      const dummyJob = {
        id: 'adv-job-long-rename',
        status: 'done',
        filename: testFile,
        title: 'Before Long Rename',
        custom_name: 'before_long_rename',
        addedAt: new Date().toISOString(),
        doneAt: new Date().toISOString(),
      };
      fs.writeFileSync(historyPath, JSON.stringify([dummyJob]));

      const longName = 'C'.repeat(300);
      const res = await srvB.request('PATCH', `/api/download/${dummyJob.id}/name`, { name: longName });
      assert.strictEqual(res.status, 200);
      assert.ok(res.json.filename.includes('C'.repeat(180)));
      assert.ok(fs.existsSync(res.json.filename), 'Renamed long file must exist on filesystem');
    });

    await test('ADV-5B.1h: POST /api/download-dir rejects relative path and traversal attempts with 400', async () => {
      const traversalPaths = [
        '../../../../etc',
        '../downloads',
        'relative/path',
        './relative',
      ];
      for (const p of traversalPaths) {
        const res = await srvB.request('POST', '/api/download-dir', { path: p });
        assert.strictEqual(res.status, 400, `Expected 400 for non-absolute/traversal path "${p}", got ${res.status}`);
        assert.strictEqual(res.json?.error, 'Geçersiz klasör yolu');
      }
    });

    await test('ADV-5B.1i: DELETE /api/download/:id with traversal ID safely returns 404', async () => {
      const res = await srvB.request('DELETE', '/api/download/..%2f..%2fetc%2fpasswd');
      assert.strictEqual(res.status, 404, 'Traversal delete ID must return 404');
    });

    await test('ADV-5B.2c: Multi-byte unicode stem (>255 UTF-8 bytes) is handled safely', async () => {
      // 70 emojis = 140 UTF-16 code units, 280 UTF-8 bytes
      const emojiStem = '🚀'.repeat(70);
      const res = await srvB.request('POST', '/api/queue/add', {
        url: 'https://example.com/video',
        custom_name: emojiStem,
      }, { 'X-Forwarded-For': '127.0.3.2' });
      assert.strictEqual(res.status, 200);

      const queueRes = await srvB.request('GET', '/api/queue');
      const job = queueRes.json.find(j => j.id === res.json.id);
      assert.ok(job);
      assert.ok(job.custom_name.length <= 180, 'Unicode stem must be clamped');
      // Physical write test
      const physicalTarget = path.join(srvB.downloadDir, `${job.custom_name}.mp4`);
      fs.writeFileSync(physicalTarget, 'unicode test');
      assert.ok(fs.existsSync(physicalTarget));
      fs.unlinkSync(physicalTarget);
    });
  } finally {
    await srvB.stop();
  }

  // ─────────────────────────────────────────────────────────────────
  // SUITE ADV-5E: Cookies, Prototype Pollution, CRLF & Rate Limiting
  // ─────────────────────────────────────────────────────────────────
  suite('Suite ADV-5E: Auth, Cookies, Prototype Pollution, CRLF & Rate Limiting');

  const srvE = new AdversarialServer(3411, {
    IZ_LOCAL: '0', // Enforce authentication middleware
    PASSWORD: 'tier5-adversarial-password-xyz',
  });
  await srvE.start();

  try {
    // Obtain valid token for authenticated calls
    const loginRes = await srvE.request('POST', '/api/login', { password: 'tier5-adversarial-password-xyz' }, {
      'X-Forwarded-For': '192.168.1.100'
    });
    assert.strictEqual(loginRes.status, 200, 'Login must succeed with correct password');
    const cookieHeader = loginRes.headers['set-cookie']?.[0] || '';
    const validCookie = cookieHeader.split(';')[0];
    assert.ok(validCookie.startsWith('vd_token='), 'Expected vd_token in Set-Cookie header');

    await test('ADV-5E.1a: Malformed cookie header (Cookie: vd_token=; invalid;; =value; __proto__=evil) rejects with 401', async () => {
      const res = await srvE.request('GET', '/api/me', null, {
        'Cookie': 'vd_token=; invalid;; =value; __proto__=evil'
      });
      assert.strictEqual(res.status, 401, `Expected 401 Unauthorized for malformed cookie, got ${res.status}`);
      assert.strictEqual(res.json?.error, 'Oturum gerekli');

      // Verify no prototype pollution occurred on Node process
      assert.strictEqual(({}).evil, undefined, 'Object.prototype.evil must be undefined');
      assert.strictEqual(Object.prototype.evil, undefined, 'Object.prototype.evil must not be polluted');
    });

    await test('ADV-5E.1b: Prototype pollution attack via cookies is neutralized', async () => {
      const attackCookies = [
        '__proto__[polluted]=true',
        'constructor.prototype.polluted=true',
        '__proto__=polluted',
      ];
      for (const c of attackCookies) {
        const res = await srvE.request('GET', '/api/me', null, { 'Cookie': c });
        assert.strictEqual(res.status, 401);
        assert.strictEqual(({}).polluted, undefined, `Payload "${c}" must not pollute Object.prototype`);
      }
    });

    await test('ADV-5E.1c: Prototype pollution attack via JSON payload in POST /api/queue/add is neutralized', async () => {
      const res = await srvE.request('POST', '/api/queue/add', {
        '__proto__': { 'jsonPolluted': true },
        'constructor': { 'prototype': { 'jsonPolluted': true } },
        'url': 'https://example.com/video'
      }, { 'Cookie': validCookie });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(({}).jsonPolluted, undefined, 'Object.prototype.jsonPolluted must be undefined');
      assert.strictEqual(Object.prototype.jsonPolluted, undefined);
    });

    await test('ADV-5E.1d: Malformed percent-encoded cookie (vd_token=%FF) does NOT crash the server', async () => {
      // Express catches synchronous errors and returns 500, server must remain responsive
      const res = await srvE.request('GET', '/api/me', null, { 'Cookie': 'vd_token=%FF' });
      assert.ok(res.status === 401 || res.status === 500, `Expected 401 or 500, got ${res.status}`);

      // Crucial liveness check: Server MUST still respond cleanly to subsequent valid requests
      const followUp = await srvE.request('GET', '/api/me', null, { 'Cookie': validCookie });
      assert.strictEqual(followUp.status, 200, 'Server must remain live and functional after malformed URI cookie');
    });

    await test('ADV-5E.2a: CRLF & control character injection in POST /api/queue/add url is rejected with 400', async () => {
      const crlfPayloads = [
        'https://example.com/video\r\nrm -rf /',
        'https://example.com/video\nrm -rf /',
        'https://example.com/video\rSet-Cookie: evil=1',
        'https://example.com/video\0injection',
        'https://example.com/video\t\x1b[31minjection',
      ];

      for (const badUrl of crlfPayloads) {
        const res = await srvE.request('POST', '/api/queue/add', { url: badUrl }, { 'Cookie': validCookie });
        assert.strictEqual(res.status, 400, `Expected 400 for CRLF URL "${JSON.stringify(badUrl)}", got ${res.status}`);
        assert.strictEqual(res.json?.error, 'Geçersiz URL');
      }
    });

    await test('ADV-5E.2b: CRLF injection in POST /api/info url is rejected with 400', async () => {
      const badUrls = [
        'https://example.com/watch?v=123\r\nHost: evil.com',
        'https://example.com/watch?v=123\nrm -rf /',
        'https://example.com/watch?v=123\0',
      ];
      for (const badUrl of badUrls) {
        const res = await srvE.request('POST', '/api/info', { url: badUrl }, { 'Cookie': validCookie });
        assert.strictEqual(res.status, 400, `Expected 400 for info CRLF URL, got ${res.status}`);
        assert.strictEqual(res.json?.error, 'Geçersiz URL');
      }
    });

    await test('ADV-5E.2c: CRLF in GET /api/download-thumbnail-file url is rejected with 400', async () => {
      const res = await srvE.request('GET', '/api/download-thumbnail-file?url=https://example.com/img.jpg%0D%0AX-Injected:%20true', null, { 'Cookie': validCookie });
      assert.strictEqual(res.status, 400);
    });

    await test('ADV-5E.2d: CRLF in GET /api/download-thumbnail-file title does NOT perform header splitting', async () => {
      // Even if URL is valid, title with CRLF must not inject HTTP headers
      const res = await srvE.request('GET', '/api/download-thumbnail-file?url=https://httpbin.org/image/jpeg&title=test%0D%0AX-Injected-Header:%20pwned', null, { 'Cookie': validCookie });
      // Headers must NOT contain x-injected-header
      assert.strictEqual(res.headers['x-injected-header'], undefined, 'Must not inject response header');
    });

    await test('ADV-5E.2e: CRLF in JSON auxiliary fields (custom_name, trim_start, playback_speed) is safely sanitized', async () => {
      const res = await srvE.request('POST', '/api/queue/add', {
        url: 'https://example.com/video',
        custom_name: 'test\r\nvideo\tname',
        trim_start: '00:00:10\r\nInjected: true',
        trim_end: '00:00:20\nInjected: true',
        playback_speed: '1.5\r\n',
      }, { 'Cookie': validCookie });

      assert.strictEqual(res.status, 200);
      const queueRes = await srvE.request('GET', '/api/queue', null, { 'Cookie': validCookie });
      const job = queueRes.json.find(j => j.id === res.json.id);
      assert.ok(job);
      assert.ok(!job.custom_name.includes('\r') && !job.custom_name.includes('\n'), 'custom_name must not contain CRLF');
      assert.strictEqual(job.custom_name, 'test__video_name');
      assert.strictEqual(job.playback_speed, 1.5, 'playback_speed must be normalized float');
    });

    await test('ADV-5E.3: Rate limiting on POST /api/login strictly enforces 5 req/min threshold', async () => {
      const loginIp = '10.99.0.1';
      // Send 5 rapid login requests with wrong password (all should be 401)
      for (let i = 1; i <= 5; i++) {
        const res = await srvE.request('POST', '/api/login', { password: `wrong-pass-${i}` }, {
          'X-Forwarded-For': loginIp
        });
        assert.strictEqual(res.status, 401, `Login attempt ${i} must return 401, got ${res.status}`);
      }

      // 6th attempt must be blocked by rate limiter with 429 Too Many Requests
      const burst6 = await srvE.request('POST', '/api/login', { password: 'wrong-pass-6' }, {
        'X-Forwarded-For': loginIp
      });
      assert.strictEqual(burst6.status, 429, `Login attempt 6 must be rate-limited (429), got ${burst6.status}`);
      assert.strictEqual(burst6.json?.error, 'Çok fazla istek. Lütfen biraz bekleyin.');

      // 7th attempt also returns 429
      const burst7 = await srvE.request('POST', '/api/login', { password: 'tier5-adversarial-password-xyz' }, {
        'X-Forwarded-For': loginIp
      });
      assert.strictEqual(burst7.status, 429, `Attempt 7 even with correct password must be rate-limited (429), got ${burst7.status}`);
    });

    await test('ADV-5E.4: Rate limiting on POST /api/queue/add strictly enforces 10 req/min threshold', async () => {
      // Need a clean IP or new server instance to test queue/add rate limit without interfering
      const srvQ = new AdversarialServer(3412, { IZ_LOCAL: '0', PASSWORD: 'test-pass-queue-rl' });
      await srvQ.start();

      try {
        const login = await srvQ.request('POST', '/api/login', { password: 'test-pass-queue-rl' });
        const cookie = login.headers['set-cookie'][0].split(';')[0];

        // Requests 1 through 10 must succeed (200)
        for (let i = 1; i <= 10; i++) {
          const res = await srvQ.request('POST', '/api/queue/add', { url: `https://example.com/video/${i}` }, { 'Cookie': cookie });
          assert.strictEqual(res.status, 200, `Queue add request ${i} must succeed (200), got ${res.status}`);
          assert.ok(res.json?.id, `Request ${i} must have job ID`);
        }

        // Request 11 must be rejected with 429 Too Many Requests
        const burst11 = await srvQ.request('POST', '/api/queue/add', { url: 'https://example.com/video/11' }, { 'Cookie': cookie });
        assert.strictEqual(burst11.status, 429, `Queue add request 11 must be rate-limited (429), got ${burst11.status}`);
        assert.strictEqual(burst11.json?.error, 'Çok fazla istek. Lütfen biraz bekleyin.');

        // Request 12 also 429
        const burst12 = await srvQ.request('POST', '/api/queue/add', { url: 'https://example.com/video/12' }, { 'Cookie': cookie });
        assert.strictEqual(burst12.status, 429, `Queue add request 12 must be rate-limited (429), got ${burst12.status}`);

        // ADV-5E.4b: Test POST /api/info rate limiting (8 req/min)
        for (let i = 1; i <= 8; i++) {
          const res = await srvQ.request('POST', '/api/info', { url: 'invalid-url' }, { 'Cookie': cookie });
          assert.strictEqual(res.status, 400, `Info request ${i} should return 400, got ${res.status}`);
        }
        const burstInfo9 = await srvQ.request('POST', '/api/info', { url: 'invalid-url' }, { 'Cookie': cookie });
        assert.strictEqual(burstInfo9.status, 429, `Info request 9 must be rate-limited (429), got ${burstInfo9.status}`);
        assert.strictEqual(burstInfo9.json?.error, 'Çok fazla istek. Lütfen biraz bekleyin.');
      } finally {
        await srvQ.stop();
      }
    });

    await test('ADV-5E.5: Rate limiting X-Forwarded-For trust proxy boundary observation', async () => {
      // In server.js line 43: app.set('trust proxy', true)
      // Test whether client-controlled X-Forwarded-For isolates rate limit keys
      const srvProxy = new AdversarialServer(3413, { IZ_LOCAL: '0', PASSWORD: 'test-proxy-pass' });
      await srvProxy.start();

      try {
        // Send 5 requests with X-Forwarded-For: 203.0.113.1
        for (let i = 1; i <= 5; i++) {
          const res = await srvProxy.request('POST', '/api/login', { password: 'wrong' }, {
            'X-Forwarded-For': '203.0.113.1'
          });
          assert.strictEqual(res.status, 401);
        }
        // 6th request with same X-Forwarded-For is 429
        const blockedSame = await srvProxy.request('POST', '/api/login', { password: 'wrong' }, {
          'X-Forwarded-For': '203.0.113.1'
        });
        assert.strictEqual(blockedSame.status, 429, 'Same forwarded IP must be rate-limited');

        // Request with different X-Forwarded-For: 203.0.113.2 gets separate bucket
        const separateIp = await srvProxy.request('POST', '/api/login', { password: 'wrong' }, {
          'X-Forwarded-For': '203.0.113.2'
        });
        assert.strictEqual(separateIp.status, 401, 'Different forwarded IP receives independent rate limit bucket');
      } finally {
        await srvProxy.stop();
      }
    });
  } finally {
    await srvE.stop();
  }

  // ─────────────────────────────────────────────────────────────────
  // SUMMARY REPORT
  // ─────────────────────────────────────────────────────────────────
  console.log(`\n=================================================================`);
  console.log(`  Tier 5 Adversarial Stress Test Summary`);
  console.log(`=================================================================`);
  console.log(`  Total Tests Run:  ${totalTests}`);
  console.log(`  Passed Tests:     ${passedTests}`);
  console.log(`  Failed Tests:     ${failedTests}`);
  console.log(`  Success Rate:     ${((passedTests / totalTests) * 100).toFixed(1)}%`);
  console.log(`=================================================================\n`);

  if (failedTests > 0) {
    console.error('Tier 5 Adversarial Verification Failed with errors:');
    testResults.filter(r => !r.pass).forEach(r => console.error(` - ${r.name}: ${r.error}`));
    process.exit(1);
  } else {
    console.log('Tier 5 Adversarial Security Verification PASSED flawlessly (100%).');
    process.exit(0);
  }
}

runAll().catch(err => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
