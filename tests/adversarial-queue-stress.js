/**
 * Empirical Adversarial Queue Stress & Benchmark Harness
 * Milestone 2 Challenger: challenger_m2_2
 *
 * Objectives:
 * 1. Test rapid queue operations: multiple retries in flight, dismissing errors while retry is pending, clearing queue while jobs are running.
 * 2. Test getJobQualityLabel: verify output across all resolution combinations (4K UHD, 2K QHD, 1080p, 720p, audio formats).
 * 3. Test server startup benchmark: verify server.js startup under simulated cold-start conditions does not exceed 1000ms.
 * 4. Test queue polling auth boundary: verify polling stops on simulated HTTP 401.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const os = require('os');
const http = require('http');
const assert = require('assert');
const { spawn, execFileSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const APP_JS_PATH = path.join(ROOT_DIR, 'public', 'app.js');
const INDEX_HTML_PATH = path.join(ROOT_DIR, 'public', 'index.html');
const SERVER_JS_PATH = path.join(ROOT_DIR, 'server.js');

const appJsCode = fs.readFileSync(APP_JS_PATH, 'utf8');
const indexHtmlContent = fs.readFileSync(INDEX_HTML_PATH, 'utf8');

// ── Test Infrastructure ──────────────────────────────────────────
let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const failures = [];
const benchmarkData = {};

function suite(title) {
  console.log(`\n═════════════════════════════════════════════════════════════════`);
  console.log(`  ${title}`);
  console.log(`═════════════════════════════════════════════════════════════════`);
}

function test(name, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failedTests++;
    failures.push({ name, error: err });
    console.error(`  ✗ ${name}`);
    console.error(`    Error: ${err.message}`);
  }
}

async function testAsync(name, fn) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failedTests++;
    failures.push({ name, error: err });
    console.error(`  ✗ ${name}`);
    console.error(`    Error: ${err.message}`);
  }
}

// ── Mock DOM & Browser Environment for public/app.js ─────────────
function createBrowserEnv(initialFetchHandler) {
  const elementsById = new Map();

  class MockElement {
    constructor(tagName) {
      this.tagName = (tagName || 'div').toUpperCase();
      this.id = '';
      this.className = '';
      this.innerHTML = '';
      this.textContent = '';
      this.value = '';
      this.checked = false;
      this.disabled = false;
      this.style = {};
      this.attributes = new Map();
      this.children = [];
      this.parentNode = null;
      this.classList = {
        add: (...cls) => {
          const current = (this.className || '').split(/\s+/).filter(Boolean);
          for (const c of cls) if (!current.includes(c)) current.push(c);
          this.className = current.join(' ');
        },
        remove: (...cls) => {
          const current = (this.className || '').split(/\s+/).filter(Boolean);
          this.className = current.filter(c => !cls.includes(c)).join(' ');
        },
        contains: (c) => (this.className || '').split(/\s+/).includes(c)
      };
    }

    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
      return child;
    }

    removeChild(child) {
      const idx = this.children.indexOf(child);
      if (idx !== -1) {
        this.children.splice(idx, 1);
        child.parentNode = null;
      }
      return child;
    }

    setAttribute(key, val) {
      this.attributes.set(key, String(val));
    }

    getAttribute(key) {
      return this.attributes.get(key) || null;
    }

    addEventListener(event, handler) {
      // event mock
    }
  }

  // Pre-populate DOM IDs expected by app.js
  const domIds = [
    'toast-container', 'login-overlay', 'login-error', 'btn-logout', 'login-password',
    'btn-login', 'section-kuyruk', 'queue-list', 'queue-badge', 'nav-badge',
    'url-input', 'thumb-url-input', 'card-error', 'card-error-thumb', 'format-hint',
    'fetch-status-text', 'fetch-status-text-thumb', 'fetch-pct-text', 'fetch-pct-text-thumb',
    'btn-retry-failed'
  ];

  for (const id of domIds) {
    const el = new MockElement('div');
    el.id = id;
    elementsById.set(id, el);
  }

  const documentMock = {
    getElementById: (id) => elementsById.get(id) || null,
    createElement: (tag) => new MockElement(tag),
    querySelectorAll: (sel) => [],
    addEventListener: () => {},
    body: new MockElement('body'),
    documentElement: {
      setAttribute: () => {},
      getAttribute: () => 'dark'
    }
  };

  let activeFetchHandler = initialFetchHandler || (async () => ({
    ok: true,
    status: 200,
    json: async () => ({})
  }));

  const timers = new Set();
  const intervals = new Set();

  const context = {
    console,
    setTimeout: (fn, ms) => {
      const t = setTimeout(fn, ms);
      timers.add(t);
      return t;
    },
    clearTimeout: (t) => {
      timers.delete(t);
      clearTimeout(t);
    },
    setInterval: (fn, ms) => {
      const i = setInterval(fn, ms);
      intervals.add(i);
      return i;
    },
    clearInterval: (i) => {
      intervals.delete(i);
      clearInterval(i);
    },
    document: documentMock,
    window: {},
    fetch: (...args) => activeFetchHandler(...args),
    prompt: () => 'test',
    confirm: () => true,
    MockElement,
    elementsById,
    setFetchHandler: (fn) => { activeFetchHandler = fn; },
    cleanupTimers: () => {
      for (const t of timers) clearTimeout(t);
      for (const i of intervals) clearInterval(i);
      timers.clear();
      intervals.clear();
    }
  };

  context.getPollTimer = () => vm.runInContext('pollTimer', context);
  context.getLastQueue = () => vm.runInContext('lastQueue', context);
  context.setLastQueue = (items) => {
    context._tmpItems = items;
    vm.runInContext('lastQueue = _tmpItems', context);
  };

  vm.createContext(context);
  vm.runInContext(appJsCode, context);
  return context;
}

// ── Test Server Runner Helper ────────────────────────────────────
class IsolatedServer {
  constructor(port, envOverrides = {}) {
    this.port = port;
    this.host = '127.0.0.1';
    this.downloadDir = path.join(os.tmpdir(), `vdl-stress-${this.port}-${Date.now()}`);
    this.proc = null;
    this.baseUrl = `http://${this.host}:${this.port}`;
    this.envOverrides = envOverrides;
  }

  async start() {
    fs.mkdirSync(this.downloadDir, { recursive: true });
    return new Promise((resolve, reject) => {
      const env = {
        ...process.env,
        PORT: String(this.port),
        HOST: this.host,
        DOWNLOADS_DIR: this.downloadDir,
        ...this.envOverrides
      };

      this.proc = spawn(process.execPath, [SERVER_JS_PATH], {
        env,
        cwd: ROOT_DIR,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        this.stop();
        reject(new Error(`IsolatedServer on port ${this.port} timed out during start. Stdout: ${stdout}, Stderr: ${stderr}`));
      }, 15000);

      this.proc.stdout.on('data', d => {
        stdout += d.toString();
        if (stdout.includes(`http://localhost:${this.port}`)) {
          clearTimeout(timer);
          resolve();
        }
      });

      this.proc.stderr.on('data', d => { stderr += d.toString(); });
      this.proc.on('error', err => { clearTimeout(timer); reject(err); });
    });
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
      const url = new URL(endpoint, this.baseUrl);
      const reqHeaders = { 'Accept': 'application/json', ...headers };
      let payload = null;
      if (body) {
        payload = typeof body === 'string' ? body : JSON.stringify(body);
        reqHeaders['Content-Type'] = 'application/json';
        reqHeaders['Content-Length'] = Buffer.byteLength(payload);
      }

      const req = http.request(url, { method, headers: reqHeaders, timeout: 5000 }, res => {
        let raw = '';
        res.on('data', c => { raw += c; });
        res.on('end', () => {
          let data = raw;
          try { data = JSON.parse(raw); } catch {}
          resolve({ status: res.statusCode, headers: res.headers, body: data, raw });
        });
      });

      req.on('error', reject);
      req.on('timeout', () => { req.destroy(new Error('Request timed out')); });
      if (payload) req.write(payload);
      req.end();
    });
  }
}

// ── Master Test Suite ────────────────────────────────────────────
async function runAllTests() {
  console.log('Starting Milestone 2 Empirical Adversarial Queue Stress Suite...\n');

  // ═════════════════════════════════════════════════════════════════
  // OBJECTIVE 2: getJobQualityLabel Resolution Matrix & Edge Cases
  // ═════════════════════════════════════════════════════════════════
  suite('Objective 2: getJobQualityLabel Resolution Matrix & Badge Output');

  const env = createBrowserEnv();
  const { getJobQualityLabel, esc } = env;

  // 1. Audio Formats
  test('Audio Only: audio_only=true returns "MP3 (320k)"', () => {
    assert.strictEqual(getJobQualityLabel({ audio_only: true }), 'MP3 (320k)');
  });

  test('Audio Only Precedence: audio_only=true overrides quality_label and format_id', () => {
    assert.strictEqual(getJobQualityLabel({ audio_only: true, quality_label: '4K (2160p)', format_id: '2160' }), 'MP3 (320k)');
    assert.strictEqual(getJobQualityLabel({ audio_only: true, format_id: '1080p' }), 'MP3 (320k)');
  });

  // 2. Explicit Quality Labels
  test('Explicit 4K UHD: quality_label="4K (2160p)"', () => {
    assert.strictEqual(getJobQualityLabel({ quality_label: '4K (2160p)' }), '4K (2160p)');
  });

  test('Explicit 2K QHD: quality_label="2K (1440p)"', () => {
    assert.strictEqual(getJobQualityLabel({ quality_label: '2K (1440p)' }), '2K (1440p)');
  });

  test('Explicit 1080p: quality_label="1080p" and "1080p60"', () => {
    assert.strictEqual(getJobQualityLabel({ quality_label: '1080p' }), '1080p');
    assert.strictEqual(getJobQualityLabel({ quality_label: '1080p60' }), '1080p60');
  });

  test('Explicit 720p: quality_label="720p"', () => {
    assert.strictEqual(getJobQualityLabel({ quality_label: '720p' }), '720p');
  });

  // 3. Fallback format_id Parsing
  test('Fallback format_id: 2160 returns "4K (2160p)"', () => {
    assert.strictEqual(getJobQualityLabel({ format_id: 'bestvideo[height<=2160]+bestaudio/best' }), '4K (2160p)');
    assert.strictEqual(getJobQualityLabel({ format_id: '2160p' }), '4K (2160p)');
    assert.strictEqual(getJobQualityLabel({ format_id: 2160 }), '4K (2160p)');
  });

  test('Fallback format_id: 1440 returns "2K (1440p)"', () => {
    assert.strictEqual(getJobQualityLabel({ format_id: 'bestvideo[height<=1440]+bestaudio/best' }), '2K (1440p)');
    assert.strictEqual(getJobQualityLabel({ format_id: '1440p' }), '2K (1440p)');
  });

  test('Fallback format_id: 1080 returns "1080p"', () => {
    assert.strictEqual(getJobQualityLabel({ format_id: 'bestvideo[height<=1080]+bestaudio/best' }), '1080p');
    assert.strictEqual(getJobQualityLabel({ format_id: '1080p' }), '1080p');
  });

  test('Fallback format_id: 720 returns "720p"', () => {
    assert.strictEqual(getJobQualityLabel({ format_id: 'bestvideo[height<=720]+bestaudio/best' }), '720p');
    assert.strictEqual(getJobQualityLabel({ format_id: '720p' }), '720p');
  });

  test('Fallback format_id: 480 and 360', () => {
    assert.strictEqual(getJobQualityLabel({ format_id: 'bestvideo[height<=480]+bestaudio/best' }), '480p');
    assert.strictEqual(getJobQualityLabel({ format_id: 'bestvideo[height<=360]+bestaudio/best' }), '360p');
  });

  test('Fallback Default: no matching pattern returns "MP4"', () => {
    assert.strictEqual(getJobQualityLabel({ format_id: 'best' }), 'MP4');
    assert.strictEqual(getJobQualityLabel({}), 'MP4');
    assert.strictEqual(getJobQualityLabel({ format_id: null }), 'MP4');
    assert.strictEqual(getJobQualityLabel({ format_id: undefined }), 'MP4');
  });

  // 4. UI Badge Logic Alignment
  function renderBadgeForJob(job) {
    const qualityTag = getJobQualityLabel(job);
    const is4K = qualityTag.includes('4K') || (job.format_id && String(job.format_id).includes('2160'));
    return is4K
      ? `<span class="badge-quality badge-4k">4K UHD</span>`
      : `<span class="badge-quality badge-compat">${esc(qualityTag)}</span>`;
  }

  test('UI Badge Rendering: 4K items produce badge-4k with "4K UHD"', () => {
    const b1 = renderBadgeForJob({ quality_label: '4K (2160p)' });
    assert.ok(b1.includes('badge-4k'));
    assert.ok(b1.includes('4K UHD'));

    const b2 = renderBadgeForJob({ format_id: 'bestvideo[height<=2160]+bestaudio' });
    assert.ok(b2.includes('badge-4k'));
    assert.ok(b2.includes('4K UHD'));
  });

  test('UI Badge Rendering: Non-4K items produce badge-compat with exact label', () => {
    const b2k = renderBadgeForJob({ quality_label: '2K (1440p)' });
    assert.ok(b2k.includes('badge-compat'));
    assert.ok(b2k.includes('2K (1440p)'));

    const b1080 = renderBadgeForJob({ format_id: '1080p' });
    assert.ok(b1080.includes('badge-compat'));
    assert.ok(b1080.includes('1080p'));

    const bMp3 = renderBadgeForJob({ audio_only: true });
    assert.ok(bMp3.includes('badge-compat'));
    assert.ok(bMp3.includes('MP3 (320k)'));
  });

  // 5. Adversarial Input Stress
  test('Adversarial: Substring false-positive check (heuristic documentation)', () => {
    // Documenting how string substring matching behaves on non-standard format strings
    // e.g. a format_id containing "3600" or "7200"
    const j1 = { format_id: 'fps3600' };
    const label1 = getJobQualityLabel(j1);
    assert.strictEqual(label1, '360p', 'Heuristic includes("360") captures "fps3600"');

    const j2 = { format_id: 'bitrate7200' };
    const label2 = getJobQualityLabel(j2);
    assert.strictEqual(label2, '720p', 'Heuristic includes("720") captures "bitrate7200"');
  });

  test('Adversarial: getJobQualityLabel(null) vulnerability check', () => {
    // If j is null, j.audio_only throws TypeError (no null safety guard)
    assert.throws(() => {
      getJobQualityLabel(null);
    }, err => err.name === 'TypeError' || String(err).includes('Cannot read properties of null'));
  });

  env.cleanupTimers();

  // ═════════════════════════════════════════════════════════════════
  // OBJECTIVE 4: Queue Polling Auth Boundary (Stop on HTTP 401)
  // ═════════════════════════════════════════════════════════════════
  suite('Objective 4: Queue Polling Auth Boundary');

  await testAsync('Auth Boundary: Polling halts immediately on simulated HTTP 401', async () => {
    let fetchCount = 0;
    let pollContext = null;

    pollContext = createBrowserEnv(async (url) => {
      fetchCount++;
      if (url === '/api/queue') {
        if (fetchCount === 1) {
          // First poll succeeds
          return { ok: true, status: 200, json: async () => [{ id: '1', status: 'waiting' }] };
        } else {
          // Second poll returns 401 Unauthorized (session expired)
          return { ok: false, status: 401, json: async () => ({ error: 'Oturum gerekli' }) };
        }
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });

    // Start polling
    pollContext.startPolling();
    assert.ok(pollContext.getPollTimer() !== null, 'pollTimer must be active initially');

    // Wait 1.1s for the first poll to fire (200 OK)
    await new Promise(r => setTimeout(r, 1100));
    assert.strictEqual(fetchCount, 1, 'First poll executed');
    assert.ok(pollContext.getPollTimer() !== null, 'pollTimer remains active after 200 OK');

    // Wait 1.1s for the second poll to fire (401 Unauthorized)
    await new Promise(r => setTimeout(r, 1100));
    assert.strictEqual(fetchCount, 2, 'Second poll executed');

    // Verify polling halted immediately
    assert.strictEqual(pollContext.getPollTimer(), null, 'pollTimer MUST be cleared (null) after 401');

    // Verify login overlay is displayed
    const overlay = pollContext.elementsById.get('login-overlay');
    assert.ok(overlay, 'login-overlay element exists');
    assert.ok(!overlay.classList.contains('hidden'), 'login overlay must NOT have hidden class after 401');

    // Wait another 1.5s to ensure no further polling requests occur
    const countBefore = fetchCount;
    await new Promise(r => setTimeout(r, 1500));
    assert.strictEqual(fetchCount, countBefore, 'No additional fetch requests must be sent after 401');

    pollContext.cleanupTimers();
  });

  await testAsync('Auth Boundary: Re-authentication resumes polling via hideLogin()', async () => {
    let fetchCount = 0;
    const pollContext = createBrowserEnv(async () => {
      fetchCount++;
      return { ok: true, status: 200, json: async () => [] };
    });

    // Start in logged-out state
    pollContext.showLogin();
    assert.strictEqual(pollContext.getPollTimer(), null, 'pollTimer is null while logged out');

    // User logs in successfully -> hideLogin() is invoked
    pollContext.hideLogin();
    assert.ok(pollContext.getPollTimer() !== null, 'hideLogin() must restart pollTimer');

    // Wait for a poll cycle
    await new Promise(r => setTimeout(r, 1100));
    assert.ok(fetchCount >= 1, 'Polling resumed and sent requests');

    // Logout stops polling again
    await pollContext.logout();
    assert.strictEqual(pollContext.getPollTimer(), null, 'logout() must stop pollTimer');

    pollContext.cleanupTimers();
  });

  // Live Backend Server Auth Boundary
  await testAsync('Live Backend: GET /api/queue returns 401 without auth token when IZ_LOCAL=0', async () => {
    const authServer = new IsolatedServer(39401, { IZ_LOCAL: '0' });
    try {
      await authServer.start();
      const res = await authServer.request('GET', '/api/queue');
      assert.strictEqual(res.status, 401, 'Backend must return HTTP 401 Unauthorized');
      assert.strictEqual(res.body.error, 'Oturum gerekli', 'Backend error message must be "Oturum gerekli"');
    } finally {
      await authServer.stop();
    }
  });

  // ═════════════════════════════════════════════════════════════════
  // OBJECTIVE 1: Rapid Queue Operations & Concurrency Stress
  // ═════════════════════════════════════════════════════════════════
  suite('Objective 1: Rapid Queue Operations & Concurrency Stress');

  await testAsync('Rapid Operations: Concurrent qRetry calls produce duplicate queue submissions (Race Condition)', async () => {
    const addCalls = [];
    const deleteCalls = [];

    const mockEnv = createBrowserEnv(async (url, opts = {}) => {
      if (url === '/api/queue/add') {
        const body = JSON.parse(opts.body || '{}');
        addCalls.push(body);
        // Simulate network latency of 50ms
        await new Promise(r => setTimeout(r, 50));
        return { ok: true, status: 200, json: async () => ({ id: 'new-' + Math.random().toString(36).slice(2, 6) }) };
      }
      if (url.startsWith('/api/queue/') && opts.method === 'DELETE') {
        deleteCalls.push(url);
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      }
      if (url === '/api/queue') {
        return { ok: true, status: 200, json: async () => [] };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });

    // Setup an errored job in lastQueue
    mockEnv.setLastQueue([{
      id: 'job-err-1',
      status: 'error',
      url: 'https://www.youtube.com/watch?v=adversarial1',
      title: 'Failed Download',
      format_id: '1080p',
      audio_only: false
    }]);

    // Adversarial Trigger: Rapid concurrent double-click / multi-retry
    const retryPromises = [
      mockEnv.qRetry('job-err-1'),
      mockEnv.qRetry('job-err-1'),
      mockEnv.qRetry('job-err-1')
    ];

    await Promise.all(retryPromises);

    console.log(`    [Observation] Concurrent qRetry dispatched ${addCalls.length} POST /api/queue/add calls for a single job`);
    assert.strictEqual(addCalls.length, 3, 'Client-side lacks debounce/lock; 3 concurrent retries produce 3 add requests');

    mockEnv.cleanupTimers();
  });

  await testAsync('Rapid Operations: Dismissing error while retry is pending (Delete vs Retry Race)', async () => {
    let resolveAdd;
    const addPending = new Promise(r => { resolveAdd = r; });
    const events = [];

    const mockEnv = createBrowserEnv(async (url, opts = {}) => {
      if (url === '/api/queue/add') {
        events.push('add_start');
        await addPending;
        events.push('add_end');
        return { ok: true, status: 200, json: async () => ({ id: 'new-job-2' }) };
      }
      if (url === '/api/queue/job-err-2' && opts.method === 'DELETE') {
        events.push('delete_called');
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      }
      if (url === '/api/queue') return { ok: true, status: 200, json: async () => [] };
      return { ok: true, status: 200, json: async () => ({}) };
    });

    mockEnv.setLastQueue([{
      id: 'job-err-2',
      status: 'error',
      url: 'https://www.youtube.com/watch?v=adversarial2',
      title: 'Failed Job 2'
    }]);

    // Step 1: User clicks Retry
    const retryPromise = mockEnv.qRetry('job-err-2');

    // Step 2: While retry is in flight, user clicks Dismiss (qDismissError)
    const dismissPromise = mockEnv.qDismissError('job-err-2');
    await dismissPromise;

    // Step 3: Now the retry network request finishes
    resolveAdd();
    await retryPromise;

    console.log(`    [Observation] Event sequence during dismiss-while-retry: ${events.join(' -> ')}`);
    assert.ok(events.includes('delete_called'), 'Delete was executed');
    assert.ok(events.includes('add_end'), 'Retry add was completed');

    mockEnv.cleanupTimers();
  });

  await testAsync('Live Backend: Clearing queue while jobs are running/waiting terminates cleanly', async () => {
    const stressServer = new IsolatedServer(39402, { IZ_LOCAL: '1', MAX_CONCURRENT: '1' });
    try {
      await stressServer.start();

      // Add 3 dummy jobs to queue (using real reachable URL or dummy URLs)
      const res1 = await stressServer.request('POST', '/api/queue/add', { url: 'https://httpbin.org/delay/5', title: 'Stress Job 1' });
      const res2 = await stressServer.request('POST', '/api/queue/add', { url: 'https://httpbin.org/delay/5', title: 'Stress Job 2' });
      const res3 = await stressServer.request('POST', '/api/queue/add', { url: 'https://httpbin.org/delay/5', title: 'Stress Job 3' });

      assert.strictEqual(res1.status, 200);
      assert.strictEqual(res2.status, 200);
      assert.strictEqual(res3.status, 200);

      // Verify queue has 3 items
      const qResBefore = await stressServer.request('GET', '/api/queue');
      assert.strictEqual(qResBefore.body.length, 3, 'Queue must contain 3 jobs');

      // Adversarial action: Clear queue rapidly via concurrent DELETE requests
      const deletePromises = qResBefore.body.map(job => stressServer.request('DELETE', `/api/queue/${job.id}`));
      const deleteResults = await Promise.all(deletePromises);

      // All delete requests must return 200 OK
      for (const dr of deleteResults) {
        assert.strictEqual(dr.status, 200, 'DELETE must succeed with 200 OK');
        assert.strictEqual(dr.body.ok, true);
      }

      // Verify queue is completely empty
      const qResAfter = await stressServer.request('GET', '/api/queue');
      assert.strictEqual(qResAfter.body.length, 0, 'Queue must be empty after clearing');

      // Verify server remains alive and handles new jobs normally
      const resPost = await stressServer.request('POST', '/api/queue/add', { url: 'https://httpbin.org/delay/1', title: 'Post-Clear Job' });
      assert.strictEqual(resPost.status, 200, 'Server must remain alive and accept jobs after queue clear');

      const qResFinal = await stressServer.request('GET', '/api/queue');
      assert.strictEqual(qResFinal.body.length, 1, 'Post-clear job exists');

      // Clean up final job
      await stressServer.request('DELETE', `/api/queue/${resPost.body.id}`);
    } finally {
      await stressServer.stop();
    }
  });

  await testAsync('Live Backend: Rate limiter enforces max 10 queue adds per 60s window', async () => {
    const rateServer = new IsolatedServer(39403, { IZ_LOCAL: '1' });
    try {
      await rateServer.start();

      let accepted = 0;
      let rejected = 0;

      // Burst 15 add requests
      for (let i = 0; i < 15; i++) {
        const res = await rateServer.request('POST', '/api/queue/add', {
          url: `https://httpbin.org/test-${i}`,
          title: `Rate Test ${i}`
        });
        if (res.status === 200) accepted++;
        if (res.status === 429) rejected++;
      }

      console.log(`    [Observation] 15 rapid adds -> Accepted: ${accepted}, 429 Rate-Limited: ${rejected}`);
      assert.strictEqual(accepted, 10, 'Exactly 10 requests allowed by rate limiter');
      assert.strictEqual(rejected, 5, 'Requests 11-15 rejected with HTTP 429');
    } finally {
      await rateServer.stop();
    }
  });

  // ═════════════════════════════════════════════════════════════════
  // OBJECTIVE 3: Server Startup Benchmark (Cold-Start Conditions)
  // ═════════════════════════════════════════════════════════════════
  suite('Objective 3: Server Startup Benchmark Under Simulated Cold-Start');

  console.log('  Running 5 independent cold-start measurements of server.js...');
  const startupTimes = [];

  for (let trial = 1; trial <= 5; trial++) {
    const testPort = 39500 + trial;
    const t0 = Date.now();

    await new Promise((resolve, reject) => {
      const p = spawn(process.execPath, [SERVER_JS_PATH], {
        env: { ...process.env, PORT: String(testPort), HOST: '127.0.0.1', IZ_LOCAL: '1' },
        cwd: ROOT_DIR,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let stdout = '';
      let timer = setTimeout(() => {
        p.kill('SIGKILL');
        reject(new Error(`Trial ${trial} timed out after 10 seconds`));
      }, 10000);

      p.stdout.on('data', d => {
        stdout += d.toString();
        if (stdout.includes(`http://localhost:${testPort}`)) {
          const elapsed = Date.now() - t0;
          startupTimes.push(elapsed);
          clearTimeout(timer);
          p.kill('SIGKILL');
          resolve();
        }
      });

      p.on('error', err => { clearTimeout(timer); reject(err); });
    });
  }

  const avgStartup = startupTimes.reduce((a, b) => a + b, 0) / startupTimes.length;
  const minStartup = Math.min(...startupTimes);
  const maxStartup = Math.max(...startupTimes);

  benchmarkData.startupTimes = startupTimes;
  benchmarkData.avgStartup = avgStartup;
  benchmarkData.minStartup = minStartup;
  benchmarkData.maxStartup = maxStartup;

  console.log(`  Startup Times (ms): [${startupTimes.join(', ')}]`);
  console.log(`  Min: ${minStartup}ms, Max: ${maxStartup}ms, Average: ${avgStartup.toFixed(1)}ms`);

  // Subprocess Latency Component Breakdown
  console.log('\n  Benchmarking constituent startup subprocess latencies:');
  const tYtdlp0 = Date.now();
  try {
    execFileSync('/opt/homebrew/bin/yt-dlp', ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {}
  const ytdlpDuration = Date.now() - tYtdlp0;

  const tFfmpeg0 = Date.now();
  try {
    execFileSync('/opt/homebrew/bin/ffmpeg', ['-version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {}
  const ffmpegDuration = Date.now() - tFfmpeg0;

  const tFfprobe0 = Date.now();
  try {
    execFileSync('/opt/homebrew/bin/ffprobe', ['-version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {}
  const ffprobeDuration = Date.now() - tFfprobe0;

  console.log(`  - /opt/homebrew/bin/yt-dlp --version: ${ytdlpDuration}ms`);
  console.log(`  - /opt/homebrew/bin/ffmpeg -version:  ${ffmpegDuration}ms`);
  console.log(`  - /opt/homebrew/bin/ffprobe -version: ${ffprobeDuration}ms`);

  benchmarkData.ytdlpDuration = ytdlpDuration;
  benchmarkData.ffmpegDuration = ffmpegDuration;
  benchmarkData.ffprobeDuration = ffprobeDuration;

  test('Server Startup Benchmark: Average cold-start startup must NOT exceed 1000ms', () => {
    assert.ok(
      avgStartup <= 1000,
      `Startup time ${avgStartup.toFixed(1)}ms EXCEEDS the 1000ms limit! (Min: ${minStartup}ms, Max: ${maxStartup}ms). Bottleneck: yt-dlp --version takes ${ytdlpDuration}ms.`
    );
  });

  // ═════════════════════════════════════════════════════════════════
  // SUMMARY REPORT
  // ═════════════════════════════════════════════════════════════════
  suite('Empirical Stress Test Summary');
  console.log(`Total Assertions: ${totalTests}`);
  console.log(`Passed: ${passedTests}`);
  console.log(`Failed: ${failedTests}`);

  if (failures.length > 0) {
    console.log('\nFailed Tests:');
    for (const f of failures) {
      console.log(`  - ${f.name}`);
      console.log(`    ${f.error.message}`);
    }
  }

  return { totalTests, passedTests, failedTests, failures, benchmarkData };
}

runAllTests().catch(err => {
  console.error('Fatal error during test run:', err);
  process.exit(1);
});
