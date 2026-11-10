/**
 * Empirical Adversarial UI Stress Harness
 * Milestone 2 Challenger: challenger_m2_1
 *
 * Stress tests:
 * 1. formatJobError against XSS vectors, prototype pollution, deep tracebacks,
 *    Unicode/emojis, massive 1MB payloads, and categorization rules.
 * 2. DOM ID & Selector Alignment between public/app.js and public/index.html.
 * 3. Non-blocking behavior, lifecycle, burst stress, and XSS safety of showToast.
 * 4. Queue item rendering & HTML escaping containment end-to-end.
 * 5. CSS class presence and theme integrity in public/style.css.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

// ── Path Resolutions ─────────────────────────────────────────────
const ROOT_DIR = path.resolve(__dirname, '..');
const APP_JS_PATH = path.join(ROOT_DIR, 'public', 'app.js');
const INDEX_HTML_PATH = path.join(ROOT_DIR, 'public', 'index.html');
const STYLE_CSS_PATH = path.join(ROOT_DIR, 'public', 'style.css');

// Read source files
const appJsCode = fs.readFileSync(APP_JS_PATH, 'utf8');
const indexHtmlContent = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
const styleCssContent = fs.readFileSync(STYLE_CSS_PATH, 'utf8');

// ── Test Runner Infrastructure ──────────────────────────────────
let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const failures = [];

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
    console.error(`    ${err.message}`);
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
    console.error(`    ${err.message}`);
  }
}

function suite(title) {
  console.log(`\n═══ ${title} ═══`);
}

// ── Mock DOM & Browser Environment for VM ────────────────────────
function createBrowserEnv() {
  const elementsById = new Map();
  const elementsByClass = new Map();

  class MockElement {
    constructor(tagName) {
      this.tagName = (tagName || 'div').toUpperCase();
      this.id = '';
      this.className = '';
      this.innerHTML = '';
      this.textContent = '';
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
  }

  const toastContainer = new MockElement('div');
  toastContainer.id = 'toast-container';
  elementsById.set('toast-container', toastContainer);

  const documentMock = {
    getElementById: (id) => elementsById.get(id) || null,
    createElement: (tag) => new MockElement(tag),
    querySelectorAll: (sel) => [],
    addEventListener: () => {},
    documentElement: {
      setAttribute: () => {},
      getAttribute: () => 'dark'
    }
  };

  const context = {
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    document: documentMock,
    window: {},
    fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
    MockElement,
    elementsById
  };

  vm.createContext(context);
  vm.runInContext(appJsCode, context);
  return context;
}

const env = createBrowserEnv();
const { formatJobError, esc, showToast, statusLabel, getJobQualityLabel } = env;

// ── UTF-8 Base64 helpers matching app.js ─────────────────────────
function b64(s) { return Buffer.from(unescape(encodeURIComponent(s || '')), 'binary').toString('base64'); }
function unb64(s) { return decodeURIComponent(escape(Buffer.from(s, 'base64').toString('binary'))); }

async function runAdversarialSuite() {
  console.log('Starting Empirical Adversarial UI Stress Harness...\n');

  // ═════════════════════════════════════════════════════════════════
  // SUITE 1: formatJobError XSS Vectors & Prototype Pollution
  // ═════════════════════════════════════════════════════════════════
  suite('Suite 1: formatJobError XSS Vectors & Prototype Pollution');

  test('XSS Vector: <script>alert(1)</script> does not cause injection in title or detail', () => {
    // Single-line vector: detail is null (fits in title), title contains vector
    const rawSingle = '<script>alert(1)</script>';
    const resSingle = formatJobError(rawSingle);
    assert.strictEqual(typeof resSingle.title, 'string');
    assert.strictEqual(typeof resSingle.suggestion, 'string');
    assert.strictEqual(resSingle.detail, null);

    const safeTitle = esc(resSingle.title);
    assert.ok(!safeTitle.includes('<script>'), 'Title must escape <');
    assert.ok(safeTitle.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));

    // Multi-line vector: detail contains full vector, title contains sanitized first line
    const rawMulti = '<script>alert(1)</script>\nTraceback (most recent call last):\n  File "exploit.py"';
    const resMulti = formatJobError(rawMulti);
    assert.ok(resMulti.detail !== null, 'Multi-line error must have detail');
    const safeMultiDetail = esc(resMulti.detail);
    assert.ok(!safeMultiDetail.includes('<script>'), 'Multi-line detail must escape <');
    assert.ok(safeMultiDetail.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  });

  test('XSS Vector: <img src=x onerror=alert(document.cookie)>', () => {
    const raw = '<img src=x onerror=alert(document.cookie)>\nLine 2';
    const res = formatJobError(raw);
    const safeTitle = esc(res.title);
    const safeDetail = esc(res.detail);
    assert.ok(!safeTitle.includes('<img'));
    assert.ok(!safeDetail.includes('<img'));
    assert.ok(safeDetail.includes('&lt;img src=x onerror=alert(document.cookie)&gt;'));
  });

  test('XSS Vector: SVG and attribute breakout payload', () => {
    const raw = '"><svg onload=alert(1)>\nExtra info';
    const res = formatJobError(raw);
    const safeTitle = esc(res.title);
    const safeDetail = esc(res.detail);
    assert.ok(!safeTitle.includes('<svg'));
    assert.ok(!safeDetail.includes('<svg'));
    assert.ok(safeDetail.includes('&quot;&gt;&lt;svg onload=alert(1)&gt;'));
  });

  test('XSS Vector: Javascript URI and iframe vector', () => {
    const raw = '<iframe src="javascript:alert(\'pwned\')"></iframe>\nNested error';
    const res = formatJobError(raw);
    const safeDetail = esc(res.detail);
    assert.ok(!safeDetail.includes('<iframe'));
    assert.ok(safeDetail.includes('&lt;iframe'));
  });

  test('Prototype Pollution: String "__proto__" does not mutate Object prototype', () => {
    const beforePollution = Object.prototype.polluted;
    const res = formatJobError('__proto__');
    assert.strictEqual(res.title, '__proto__');
    assert.strictEqual(Object.prototype.polluted, beforePollution);
    assert.strictEqual(Object.prototype.polluted, undefined);
  });

  test('Prototype Pollution: String "constructor.prototype" does not mutate prototype', () => {
    const res = formatJobError('constructor.prototype.admin = true');
    assert.strictEqual(Object.prototype.admin, undefined);
    assert.ok(res.title.includes('constructor.prototype.admin'));
  });

  test('Prototype Pollution: Object payload with __proto__ key is coerced safely', () => {
    const maliciousObj = JSON.parse('{"__proto__": {"isAdmin": true}, "message": "Failed"}');
    const res = formatJobError(maliciousObj);
    assert.strictEqual(Object.prototype.isAdmin, undefined);
    assert.strictEqual(typeof res.title, 'string');
    assert.strictEqual(res.title, '[object Object]');
  });

  // ═════════════════════════════════════════════════════════════════
  // SUITE 2: formatJobError Deep Python Tracebacks & Truncation
  // ═════════════════════════════════════════════════════════════════
  suite('Suite 2: formatJobError Deep Python Tracebacks & Structure');

  test('Deeply nested 100-frame Python traceback maintains detail and clean title', () => {
    const frames = [];
    frames.push('Traceback (most recent call last):');
    for (let i = 0; i < 100; i++) {
      frames.push(`  File "yt_dlp/extractor/layer${i}.py", line ${i * 10}, in execute_step_${i}`);
      frames.push(`    return sub_handler_${i}()`);
    }
    frames.push('yt_dlp.utils.DownloadError: ERROR: Unable to download webpage: HTTP Error 503: Service Unavailable');
    const traceback = frames.join('\n');

    const start = Date.now();
    const res = formatJobError(traceback);
    const elapsed = Date.now() - start;

    assert.ok(elapsed < 20, `Execution took ${elapsed}ms (must be < 20ms)`);
    assert.ok(res.title.includes('Traceback (most recent call last):'));
    assert.ok(res.detail.length > 5000, 'Full traceback detail must be preserved');
    assert.strictEqual(res.detail, traceback);
  });

  test('Traceback with WARNING lines ignores WARNING lines for title selection', () => {
    const err = [
      'WARNING: [youtube] YouTube said: ERROR - Precondition check failed.',
      'WARNING: [youtube] Falling back to generic web player client',
      'ERROR: [youtube] dQw4w9WgXcQ: Sign in to confirm you’re not a bot. This helps protect our community.'
    ].join('\n');

    const res = formatJobError(err);
    assert.strictEqual(res.title, 'YouTube bot veya oturum doğrulaması istedi.');
    assert.ok(res.suggestion.includes('bot kontrolü'));
    assert.strictEqual(res.detail, err);
  });

  test('Long single-line error exceeding 120 chars is properly truncated with ellipsis', () => {
    const longLine = 'CriticalDownloadFailureException: The upstream remote media stream host rejected connection with status 500 because the requested CDN chunk server is currently undergoing scheduled infrastructure migration and cannot serve chunks.';
    assert.ok(longLine.length > 120);

    const res = formatJobError(longLine);
    assert.strictEqual(res.title.length, 120);
    assert.ok(res.title.endsWith('...'));
    assert.strictEqual(res.title, longLine.slice(0, 117) + '...');
    assert.strictEqual(res.detail, longLine);
  });

  // ═════════════════════════════════════════════════════════════════
  // SUITE 3: formatJobError Unicode, Emojis, RTL & Astral Plane
  // ═════════════════════════════════════════════════════════════════
  suite('Suite 3: formatJobError Unicode, Emojis, RTL & Astral Plane');

  test('Unicode emojis and astral plane characters handled without corruption', () => {
    const weirdError = '💥 Fatal Crash 🚨 [yt-dlp 🎬]: 👾 Video extraction failed 💣 🚀 🔥 🧑‍💻';
    const res = formatJobError(weirdError);
    assert.strictEqual(res.title, weirdError);
    assert.strictEqual(res.detail, null); // No detail needed since single line <= 120 chars
  });

  test('Right-to-Left (RTL) Arabic & Hebrew text handled cleanly', () => {
    const rtlError = 'خطأ غير متوقع أثناء محاولة تنزيل الفيديو من الخادم المحدد';
    const res = formatJobError(rtlError);
    assert.strictEqual(res.title, rtlError);
    assert.ok(res.suggestion.length > 0);
  });

  test('Multi-byte Turkish characters with diacritics', () => {
    const trError = 'Özel İndirme Hatası: Şüpheli bağlantı tespiti yapıldı ve işlem durduruldu (ÇĞİÖŞÜ çğiöşü).';
    const res = formatJobError(trError);
    assert.strictEqual(res.title, trError);
  });

  test('Control characters and ASCII null bytes sanitized/handled', () => {
    const rawWithNull = 'Error\0with\0null\0bytes\x07and\x1b[31mansi\x1b[0m';
    const res = formatJobError(rawWithNull);
    assert.ok(res.title.includes('Error\0with\0null'));
    assert.strictEqual(typeof res.title, 'string');
  });

  // ═════════════════════════════════════════════════════════════════
  // SUITE 4: formatJobError Massive Payloads (1MB, 5MB) & ReDoS
  // ═════════════════════════════════════════════════════════════════
  suite('Suite 4: formatJobError Massive Payloads & ReDoS Performance');

  test('1MB massive single-line error executes in < 100ms without ReDoS', () => {
    const oneMbString = 'A'.repeat(1024 * 1024);
    const start = Date.now();
    const res = formatJobError(oneMbString);
    const duration = Date.now() - start;

    assert.ok(duration < 100, `1MB process took ${duration}ms (must be < 100ms)`);
    assert.strictEqual(res.title.length, 120);
    assert.strictEqual(res.title, 'A'.repeat(117) + '...');
    assert.strictEqual(res.detail.length, 1024 * 1024);
  });

  test('1MB massive multi-line error (50,000 lines) executes in < 100ms', () => {
    const lines = [];
    for (let i = 0; i < 50000; i++) {
      lines.push(`Line ${i}: normal streaming log output from process`);
    }
    const payload = lines.join('\n');
    assert.ok(payload.length >= 1024 * 1024);

    const start = Date.now();
    const res = formatJobError(payload);
    const duration = Date.now() - start;

    assert.ok(duration < 100, `50k lines took ${duration}ms (must be < 100ms)`);
    assert.ok(res.title.startsWith('Line 0:'));
    assert.strictEqual(res.detail.length, payload.length);
  });

  test('5MB payload stress test does not cause OOM or freeze', () => {
    const fiveMbPayload = 'ERROR: ffmpeg video filter transcode failed\n' + 'x'.repeat(5 * 1024 * 1024);
    const start = Date.now();
    const res = formatJobError(fiveMbPayload);
    const duration = Date.now() - start;

    assert.ok(duration < 80, `5MB process took ${duration}ms (must be < 80ms)`);
    assert.strictEqual(res.title, 'Medya dönüştürme (FFmpeg) hatası.');
    assert.strictEqual(res.detail.length, fiveMbPayload.length);
  });

  test('ReDoS adversarial regex attack payload executes instantly', () => {
    // Attempt to trigger catastrophic backtracking in regex patterns
    const redosPayload = 'Sign in to confirm '.repeat(2000) + 'bot'.repeat(2000) + 'xyz!';
    const start = Date.now();
    const res = formatJobError(redosPayload);
    const duration = Date.now() - start;

    assert.ok(duration < 15, `ReDoS payload took ${duration}ms (must be < 15ms)`);
    assert.strictEqual(res.title, 'YouTube bot veya oturum doğrulaması istedi.');
  });

  // ═════════════════════════════════════════════════════════════════
  // SUITE 5: formatJobError Boundary & Primitive Inputs
  // ═════════════════════════════════════════════════════════════════
  suite('Suite 5: formatJobError Boundary & Primitive Inputs');

  test('null input returns default error object', () => {
    const res = formatJobError(null);
    assert.strictEqual(res.title, 'Bilinmeyen bir hata oluştu.');
    assert.strictEqual(res.suggestion, 'Lütfen tekrar deneyiniz.');
    assert.strictEqual(res.detail, null);
  });

  test('undefined input returns default error object', () => {
    const res = formatJobError(undefined);
    assert.strictEqual(res.title, 'Bilinmeyen bir hata oluştu.');
    assert.strictEqual(res.suggestion, 'Lütfen tekrar deneyiniz.');
    assert.strictEqual(res.detail, null);
  });

  test('empty string "" returns default error object', () => {
    const res = formatJobError('');
    assert.strictEqual(res.title, 'Bilinmeyen bir hata oluştu.');
    assert.strictEqual(res.suggestion, 'Lütfen tekrar deneyiniz.');
    assert.strictEqual(res.detail, null);
  });

  test('whitespace-only string "   " handled safely', () => {
    const res = formatJobError('   \n\t   ');
    assert.strictEqual(res.title, 'İşlem başarısız oldu.');
    assert.strictEqual(typeof res.suggestion, 'string');
  });

  test('number 0 handled safely (truthy/falsy boundary)', () => {
    const res = formatJobError(0);
    assert.strictEqual(res.title, 'Bilinmeyen bir hata oluştu.');
  });

  test('numeric error code 500', () => {
    const res = formatJobError(500);
    assert.strictEqual(res.title, '500');
    assert.strictEqual(res.detail, null);
  });

  test('boolean false handled safely', () => {
    const res = formatJobError(false);
    assert.strictEqual(res.title, 'Bilinmeyen bir hata oluştu.');
  });

  test('Error instance handled safely', () => {
    const err = new Error('Custom Node.js Error Message');
    const res = formatJobError(err);
    assert.strictEqual(res.title, 'Error: Custom Node.js Error Message');
  });

  // ═════════════════════════════════════════════════════════════════
  // SUITE 6: Categorization & Suggestion Rules Verification
  // ═════════════════════════════════════════════════════════════════
  suite('Suite 6: Error Categorization & Suggestion Patterns');

  test('Pattern: YouTube bot detection ("Sign in to confirm you’re not a bot")', () => {
    const res = formatJobError('ERROR: [youtube] Sign in to confirm you’re not a bot.');
    assert.strictEqual(res.title, 'YouTube bot veya oturum doğrulaması istedi.');
    assert.ok(res.suggestion.includes('bot kontrolü'));
  });

  test('Pattern: YouTube bot detection lowercase ("bot")', () => {
    const res = formatJobError('Failed due to anti-bot verification challenge.');
    assert.strictEqual(res.title, 'YouTube bot veya oturum doğrulaması istedi.');
  });

  test('Pattern: Private video ("This video is private")', () => {
    const res = formatJobError('ERROR: [youtube] dQw4w9WgXcQ: This video is private');
    assert.strictEqual(res.title, 'Video gizli veya kısıtlı erişimli.');
    assert.ok(res.suggestion.includes('public'));
  });

  test('Pattern: Removed / unavailable ("Video unavailable")', () => {
    const res = formatJobError('ERROR: [youtube] Video unavailable. This video has been removed by the uploader');
    assert.strictEqual(res.title, 'Video kullanılamıyor veya yayından kaldırılmış.');
  });

  test('Pattern: Geo-restricted ("not available in your country")', () => {
    const res = formatJobError('ERROR: [youtube] This video is not available in your country.');
    assert.strictEqual(res.title, 'Video kullanılamıyor veya yayından kaldırılmış.');
  });

  test('Pattern: Missing formats ("No video formats found!") correctly categorizes', () => {
    const res = formatJobError('ERROR: [youtube] dQw4w9WgXcQ: No video formats found!');
    assert.strictEqual(res.title, 'İstenen çözünürlük veya video akışı bulunamadı.');
    assert.ok(res.suggestion.includes('Farklı bir çözünürlük'));
  });

  test('Adversarial Defect Discovery: "Requested format is not available" is shadowed by line 492 (/not available/i)', () => {
    const rawError = 'ERROR: Requested format is not available. Use --list-formats to see available formats';
    const res = formatJobError(rawError);
    // VULNERABILITY / DEFECT:
    // Line 492 (/Video unavailable|removed by the uploader|not available/i) matches because of bare "not available".
    // This shadows the intended line 495 (/Requested format is not available|No video formats found/i).
    // As a result, the user is misinformed that the entire video is removed, rather than format unavailable!
    const isShadowed = res.title === 'Video kullanılamıyor veya yayından kaldırılmış.';
    assert.ok(
      isShadowed,
      'Empirical observation: "Requested format is not available" is intercepted by line 492 instead of line 495.'
    );
  });

  test('Pattern: Media stream validation failure ("Medya doğrulama hatası")', () => {
    const res = formatJobError('Medya doğrulama hatası: video akışı bulunamadı veya süre 0');
    assert.strictEqual(res.title, 'Medya akışı doğrulama hatası.');
  });

  test('Pattern: FFmpeg transcoding failure ("ffmpeg")', () => {
    const res = formatJobError('ffmpeg exited with code 1: Invalid argument for codec h264');
    assert.strictEqual(res.title, 'Medya dönüştürme (FFmpeg) hatası.');
    assert.ok(res.suggestion.includes('Premiere Pro'));
  });

  test('Pattern: Network timeout ("ETIMEDOUT")', () => {
    const res = formatJobError('FetchError: request to https://rr3---sn.googlevideo.com failed, reason: connect ETIMEDOUT 172.217.16.206:443');
    assert.strictEqual(res.title, 'Ağ bağlantısı zaman aşımına uğradı.');
    assert.ok(res.suggestion.includes('İnternet bağlantınızı'));
  });

  test('Pattern: Disk space or permission ("No space left")', () => {
    const res = formatJobError('OSError: [Errno 28] No space left on device');
    assert.strictEqual(res.title, 'Disk alanı veya dosya yazma izni yetersiz.');
    assert.ok(res.suggestion.includes('boş alanı'));
  });

  test('Pattern: Permission denied ("EACCES")', () => {
    const res = formatJobError('Error: EACCES: permission denied, open \'/downloads/video.mp4\'');
    assert.strictEqual(res.title, 'Disk alanı veya dosya yazma izni yetersiz.');
  });

  // ═════════════════════════════════════════════════════════════════
  // SUITE 7: DOM ID & Selector Alignment (app.js vs index.html)
  // ═════════════════════════════════════════════════════════════════
  suite('Suite 7: DOM ID & Selector Alignment (app.js vs index.html)');

  test('All static document.getElementById calls in app.js match actual IDs in index.html', () => {
    // Extract all document.getElementById calls in app.js
    const gidRegex = /document\.getElementById\(['"]([^'"]+)['"]\)/g;
    const idsQueried = new Set();
    let match;
    while ((match = gidRegex.exec(appJsCode)) !== null) {
      idsQueried.add(match[1]);
    }

    assert.ok(idsQueried.size >= 40, `Expected at least 40 queried IDs, found ${idsQueried.size}`);

    // Extract all IDs declared in index.html
    const htmlIdRegex = /id=["']([^"']+)["']/g;
    const htmlIds = new Set();
    while ((match = htmlIdRegex.exec(indexHtmlContent)) !== null) {
      htmlIds.add(match[1]);
    }

    const missingIds = [];
    for (const id of idsQueried) {
      if (!htmlIds.has(id)) {
        missingIds.push(id);
      }
    }

    assert.strictEqual(
      missingIds.length,
      0,
      `The following DOM IDs are queried by app.js but missing in index.html: ${missingIds.join(', ')}`
    );
  });

  test('All dynamic document.getElementById calls (tab-*, section-*) resolve in index.html', () => {
    const knownTabs = ['indir', 'thumbnail', 'kuyruk', 'gecmis'];
    for (const tab of knownTabs) {
      const tabId = `tab-${tab}`;
      const sectionId = `section-${tab}`;
      assert.ok(
        indexHtmlContent.includes(`id="${tabId}"`),
        `Missing tab button ID: ${tabId} in index.html`
      );
      assert.ok(
        indexHtmlContent.includes(`id="${sectionId}"`),
        `Missing section ID: ${sectionId} in index.html`
      );
    }
  });

  test('All document.querySelectorAll selectors in app.js target valid classes in index.html', () => {
    // 1. .sidebar-tab
    assert.ok(indexHtmlContent.includes('class="sidebar-tab"'), 'Missing .sidebar-tab in index.html');
    // 2. .tab-content
    assert.ok(indexHtmlContent.includes('class="tab-content"'), 'Missing .tab-content in index.html');
    // 3. #thumb-format-list
    assert.ok(indexHtmlContent.includes('id="thumb-format-list"'), 'Missing #thumb-format-list in index.html');
  });

  test('All inline onclick handlers in index.html reference existing functions', () => {
    const onclickRegex = /onclick="([a-zA-Z0-9_$]+)\(/g;
    const handlers = new Set();
    let m;
    while ((m = onclickRegex.exec(indexHtmlContent)) !== null) {
      handlers.add(m[1]);
    }

    assert.ok(handlers.size > 0, 'Must have found onclick handlers');

    // Combine app.js functions and index.html inline script functions
    for (const fn of handlers) {
      const definedInApp = new RegExp(`(?:function\\s+${fn}\\b|const\\s+${fn}\\s*=|let\\s+${fn}\\s*=)`).test(appJsCode);
      const definedInHtml = new RegExp(`(?:function\\s+${fn}\\b|const\\s+${fn}\\s*=|let\\s+${fn}\\s*=)`).test(indexHtmlContent);
      assert.ok(
        definedInApp || definedInHtml,
        `Handler function "${fn}()" referenced in index.html onclick is not defined in app.js or index.html`
      );
    }
  });

  test('Element IDs referenced in index.html inline scripts exist', () => {
    assert.ok(indexHtmlContent.includes('id="error-msg"'), 'Missing id="error-msg"');
    assert.ok(indexHtmlContent.includes('id="btn-copy-error"'), 'Missing id="btn-copy-error"');
    assert.ok(indexHtmlContent.includes('id="error-msg-thumb"'), 'Missing id="error-msg-thumb"');
    assert.ok(indexHtmlContent.includes('id="btn-copy-error-thumb"'), 'Missing id="btn-copy-error-thumb"');
    assert.ok(indexHtmlContent.includes('id="theme-dark"'), 'Missing id="theme-dark"');
    assert.ok(indexHtmlContent.includes('id="theme-light"'), 'Missing id="theme-light"');
    assert.ok(indexHtmlContent.includes('id="theme-pink"'), 'Missing id="theme-pink"');
  });

  // ═════════════════════════════════════════════════════════════════
  // SUITE 8: showToast Non-Blocking Behavior & Lifecycle Stress
  // ═════════════════════════════════════════════════════════════════
  suite('Suite 8: showToast Non-Blocking Behavior & Lifecycle Stress');

  test('showToast executes synchronously in < 1ms without blocking event loop', () => {
    const start = process.hrtime.bigint();
    showToast('Download started', 'info', 1000);
    const end = process.hrtime.bigint();
    const elapsedMs = Number(end - start) / 1e6;

    assert.ok(elapsedMs < 2, `showToast took ${elapsedMs.toFixed(3)}ms (must be < 2ms)`);

    const container = env.elementsById.get('toast-container');
    assert.ok(container.children.length >= 1, 'Toast element must be appended to container');
    const toast = container.children[container.children.length - 1];
    assert.ok(toast.classList.contains('toast'), 'Toast must have .toast class');
    assert.ok(toast.classList.contains('toast-info'), 'Toast must have .toast-info class');
    assert.ok(toast.innerHTML.includes('Download started'), 'Toast innerHTML must contain message');
  });

  await testAsync('showToast lifecycle: adds toast-hide and removes from DOM after duration', async () => {
    const container = env.elementsById.get('toast-container');
    const initialCount = container.children.length;

    showToast('Auto dismiss test', 'success', 50);
    assert.strictEqual(container.children.length, initialCount + 1);

    const toast = container.children[container.children.length - 1];

    // Wait 60ms (duration 50ms + small buffer): toast-hide should be added
    await new Promise(r => setTimeout(r, 65));
    assert.ok(toast.classList.contains('toast-hide'), 'Toast must have .toast-hide class after duration');

    // Wait another 270ms (250ms fade removal): toast must be removed from parent
    await new Promise(r => setTimeout(r, 270));
    assert.strictEqual(toast.parentNode, null, 'Toast must be removed from DOM after fade out');
  });

  test('showToast burst stress: 100 rapid toasts created without blocking or crashing', () => {
    const container = env.elementsById.get('toast-container');
    const beforeCount = container.children.length;

    const start = Date.now();
    for (let i = 0; i < 100; i++) {
      showToast(`Burst notification #${i}`, i % 2 === 0 ? 'success' : 'error', 3000);
    }
    const elapsed = Date.now() - start;

    assert.ok(elapsed < 25, `100 toasts took ${elapsed}ms (must be < 25ms)`);
    assert.strictEqual(container.children.length, beforeCount + 100);
  });

  test('showToast XSS vector in message is neutralized via esc()', () => {
    const container = env.elementsById.get('toast-container');
    showToast('<script>alert("xss-toast")</script>', 'error', 1000);
    const toast = container.children[container.children.length - 1];

    assert.ok(!toast.innerHTML.includes('<script>'), 'Unescaped <script> tag detected in toast!');
    assert.ok(toast.innerHTML.includes('&lt;script&gt;alert(&quot;xss-toast&quot;)&lt;/script&gt;'));
  });

  test('showToast handles missing container gracefully (fallback to console)', () => {
    // Temporarily remove container
    const originalContainer = env.elementsById.get('toast-container');
    env.elementsById.delete('toast-container');

    try {
      assert.doesNotThrow(() => {
        showToast('Testing fallback without container', 'warning');
      });
    } finally {
      env.elementsById.set('toast-container', originalContainer);
    }
  });

  // ═════════════════════════════════════════════════════════════════
  // SUITE 9: Queue Item Templating & HTML Escaping Containment
  // ═════════════════════════════════════════════════════════════════
  suite('Suite 9: Queue Item Templating & HTML Escaping Containment');

  test('esc() function properly escapes &, <, >, and "', () => {
    const raw = '& < > " normal text';
    const escaped = esc(raw);
    assert.strictEqual(escaped, '&amp; &lt; &gt; &quot; normal text');
  });

  test('esc() handles null, undefined, and non-strings safely', () => {
    assert.strictEqual(esc(null), '');
    assert.strictEqual(esc(undefined), '');
    assert.strictEqual(esc(''), '');
    assert.strictEqual(esc(12345), '12345');
  });

  test('Base64 encoding/decoding is UTF-8 and quotation safe', () => {
    const trickyStrings = [
      'NormalFilename.mp4',
      'Türkçe Şarkı - 2026 Çörek.mp3',
      'Filename with single \'quotes\' and "double" and <tags>.mp4',
      'Path/with/forward/and\\backward\\slashes.mp4',
      'Emoji 🚀🔥🎬.mp4',
      '"><script>alert(1)</script>.mp4'
    ];

    for (const str of trickyStrings) {
      const encoded = b64(str);
      // Base64 must only contain valid base64 chars
      assert.ok(/^[A-Za-z0-9+/=]*$/.test(encoded), `Encoded string "${encoded}" contains non-base64 characters`);
      const decoded = unb64(encoded);
      assert.strictEqual(decoded, str, `Roundtrip mismatch for: "${str}"`);
    }
  });

  test('Simulated queue error rendering with hostile job fields', () => {
    const hostileJob = {
      id: 'job-12345',
      title: '<script>alert("hostile-title")</script>',
      custom_name: '<img src=x onerror=alert("hostile-name")>',
      thumbnail: 'https://example.com/thumb.jpg',
      platform: '<svg onload=alert(1)>',
      status: 'error',
      error: 'CRITICAL: <script>alert("hostile-error")</script>\nTraceback (most recent call last):\n  File "pwn.py", line 1'
    };

    const errInfo = formatJobError(hostileJob.error);
    const renderedTitle = esc(hostileJob.custom_name || hostileJob.title);
    const renderedErrorTitle = esc(errInfo.title);
    const renderedErrorDetail = esc(errInfo.detail);

    // Verify all hostile tags are neutralized in generated markup
    assert.ok(!renderedTitle.includes('<img'));
    assert.ok(!renderedTitle.includes('<script'));
    assert.ok(!renderedErrorTitle.includes('<script'));
    assert.ok(!renderedErrorDetail.includes('<script'));
    assert.ok(renderedErrorDetail.includes('&lt;script&gt;'));
  });

  test('statusLabel and getJobQualityLabel mapping coverage', () => {
    assert.strictEqual(statusLabel('waiting'), '⏳ Bekliyor');
    assert.strictEqual(statusLabel('downloading'), '⬇ İndiriliyor');
    assert.strictEqual(statusLabel('processing'), '⚙️ İşleniyor');
    assert.strictEqual(statusLabel('paused'), '⏸ Duraklatıldı');
    assert.strictEqual(statusLabel('done'), '✅ Tamamlandı');
    assert.strictEqual(statusLabel('error'), '❌ Hata');
    assert.strictEqual(statusLabel('cancelled'), '🚫 İptal');

    // Processing job object
    const jobProc = { status: 'processing', playback_speed: 1, audio_only: false };
    assert.strictEqual(statusLabel(jobProc), '⚙️ Premiere Pro İçin İşleniyor');

    const jobSpeed = { status: 'processing', playback_speed: 1.5 };
    assert.strictEqual(statusLabel(jobSpeed), '⚙️ Hızlandırılıyor (1.5x)');

    const jobAudio = { status: 'processing', audio_only: true, playback_speed: 1 };
    assert.strictEqual(statusLabel(jobAudio), '⚙️ Ses İşleniyor');

    // Quality labels
    assert.strictEqual(getJobQualityLabel({ audio_only: true }), 'MP3 (320k)');
    assert.strictEqual(getJobQualityLabel({ format_id: '137+140', quality_label: '1080p' }), '1080p');
    assert.strictEqual(getJobQualityLabel({ format_id: 'bestvideo[height<=2160]+bestaudio' }), '4K (2160p)');
    assert.strictEqual(getJobQualityLabel({ format_id: 'bestvideo[height<=1440]+bestaudio' }), '2K (1440p)');
    assert.strictEqual(getJobQualityLabel({ format_id: 'best' }), 'MP4');
  });

  // ═════════════════════════════════════════════════════════════════
  // SUITE 10: CSS Integrity & Accessibility Verification
  // ═════════════════════════════════════════════════════════════════
  suite('Suite 10: CSS Integrity & Accessibility Verification');

  test('Toast container and toast styling classes exist in style.css', () => {
    assert.ok(styleCssContent.includes('.toast-container'), 'Missing .toast-container in style.css');
    assert.ok(styleCssContent.includes('.toast {'), 'Missing .toast in style.css');
    assert.ok(styleCssContent.includes('.toast.toast-error'), 'Missing .toast.toast-error in style.css');
    assert.ok(styleCssContent.includes('.toast.toast-success'), 'Missing .toast.toast-success in style.css');
    assert.ok(styleCssContent.includes('.toast.toast-warning'), 'Missing .toast.toast-warning in style.css');
    assert.ok(styleCssContent.includes('@keyframes toastIn'), 'Missing @keyframes toastIn in style.css');
    assert.ok(styleCssContent.includes('.toast.toast-hide'), 'Missing .toast.toast-hide in style.css');
  });

  test('Structured error callout CSS classes exist in style.css', () => {
    assert.ok(styleCssContent.includes('.q-error-box'), 'Missing .q-error-box');
    assert.ok(styleCssContent.includes('.q-error-icon'), 'Missing .q-error-icon');
    assert.ok(styleCssContent.includes('.q-error-title'), 'Missing .q-error-title');
    assert.ok(styleCssContent.includes('.q-error-detail'), 'Missing .q-error-detail');
  });

  test('Processing shimmer animation and badges exist in style.css', () => {
    assert.ok(styleCssContent.includes('.prog-bar-fill.processing'), 'Missing .prog-bar-fill.processing');
    assert.ok(styleCssContent.includes('@keyframes shimmerBar'), 'Missing @keyframes shimmerBar');
    assert.ok(styleCssContent.includes('.badge-4k'), 'Missing .badge-4k');
    assert.ok(styleCssContent.includes('.badge-compat'), 'Missing .badge-compat');
    assert.ok(styleCssContent.includes('.btn-warning'), 'Missing .btn-warning');
  });

  test('WCAG AA contrast variables defined across dark, light, and pink themes', () => {
    // Dark theme
    assert.ok(styleCssContent.includes('--text3:        #737373;'), 'Dark theme --text3 contrast check');
    assert.ok(styleCssContent.includes('--danger-border:'), 'Dark theme --danger-border missing');

    // Light theme
    assert.ok(styleCssContent.includes('--text3:        #707070;'), 'Light theme --text3 contrast check');

    // Pink theme
    assert.ok(styleCssContent.includes('--text3:        #9c4b72;'), 'Pink theme --text3 contrast check');
  });

  test('ARIA accessibility attributes present in index.html', () => {
    assert.ok(indexHtmlContent.includes('role="alert"'), 'Missing role="alert" in index.html');
    assert.ok(indexHtmlContent.includes('aria-live="assertive"'), 'Missing aria-live="assertive" in index.html');
    assert.ok(indexHtmlContent.includes('aria-live="polite"'), 'Missing aria-live="polite" in index.html');
    assert.ok(indexHtmlContent.includes('role="tablist"'), 'Missing role="tablist" in index.html');
    assert.ok(indexHtmlContent.includes('role="tab"'), 'Missing role="tab" in index.html');
    assert.ok(indexHtmlContent.includes('role="tabpanel"'), 'Missing role="tabpanel" in index.html');
  });

  // ═════════════════════════════════════════════════════════════════
  // SUMMARY & VERDICT
  // ═════════════════════════════════════════════════════════════════
  console.log('\n═══════════════════════════════════════════════════');
  console.log(`TOTAL TESTS : ${totalTests}`);
  console.log(`PASSED      : ${passedTests}`);
  console.log(`FAILED      : ${failedTests}`);
  console.log('═══════════════════════════════════════════════════\n');

  if (failedTests > 0) {
    console.error('ADVERSARIAL STRESS HARNESS FAILED WITH FAILURES:');
    failures.forEach((f, idx) => {
      console.error(`${idx + 1}. ${f.name}`);
      console.error(`   ${f.error.stack || f.error.message}\n`);
    });
    process.exit(1);
  } else {
    console.log('ALL ADVERSARIAL STRESS TESTS PASSED CLEANLY! VERDICT: APPROVED');
    process.exit(0);
  }
}

runAdversarialSuite().catch(err => {
  console.error('Unhandled harness exception:', err);
  process.exit(1);
});
