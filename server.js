const express = require('express');
const { spawn, execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');

// ── PATH ve Çevre Değişkeni Yönetimi ────────────────────────
function getAugmentedPath() {
  const existing = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const preferred = [
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/local/bin',
    '/usr/local/sbin',
    path.join(os.homedir(), '.local/bin'),
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin'
  ];
  const combined = [];
  for (const p of [...preferred, ...existing]) {
    if (!combined.includes(p) && fs.existsSync(p)) {
      combined.push(p);
    }
  }
  return combined.join(path.delimiter);
}

// Global process.env.PATH'i başlatma anında güçlendir
process.env.PATH = getAugmentedPath();

function getAugmentedEnv(extraEnv = {}) {
  return {
    ...process.env,
    PATH: getAugmentedPath(),
    ...extraEnv
  };
}

const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '200kb' }));
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'same-origin');
  next();
});
app.use(express.static('public'));

// ── Yapılandırma (env değişkenleriyle) ─────────────────────
// PORT=3131  PASSWORD=sifren   DOWNLOADS_DIR=/path/to/dir
// YTDLP_PATH=...  FFMPEG_PATH=...  MAX_CONCURRENT=2
const PORT = parseInt(process.env.PORT || '3131', 10);
const HOST = process.env.HOST || '127.0.0.1';
// İndirme klasörü çalışırken değiştirilebilir (uygulama içinden klasör seçilebilir).
let downloadDir = path.resolve(process.env.DOWNLOADS_DIR || path.join(__dirname, 'downloads'));
const HISTORY_FILE = path.join(downloadDir, 'history.json');
function getDownloadDir() { return downloadDir; }
const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT || '2', 10);
const DEFAULT_VIDEO_FORMAT = 'bestvideo+bestaudio/best';
const YOUTUBE_CLIENTS = process.env.YOUTUBE_CLIENTS || 'web_embedded,web_safari,android_vr,android,ios';

// yt-dlp'nin YouTube yüksek kalite akışlarını çözebilmesi için bir JS runtime
// gerekir. Eski Node 20.18 sürümü yt-dlp tarafından desteklenmediği için
// mümkünse desteklenen Node 20.19+/24 sürümünü otomatik seç.
function isSupportedJsRuntime(candidate) {
  if (!candidate || !fs.existsSync(candidate)) return false;
  if (!/(^|[\\/])node(?:js)?$/.test(candidate)) return false;
  try {
    const version = execFileSync(candidate, ['--version'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
    const match = version.match(/^v(\d+)\.(\d+)\.(\d+)/);
    if (!match) return false;
    const major = Number(match[1]);
    const minor = Number(match[2]);
    return major > 20 || (major === 20 && minor >= 19);
  } catch {
    return false;
  }
}

function resolveJsRuntime() {
  const home = os.homedir();
  const candidates = [
    process.env.YTDLP_JS_RUNTIME,
    process.execPath,
    path.join(home, '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node'),
    '/opt/homebrew/bin/node',
    '/usr/local/bin/node',
    path.join(home, '.local/node/bin/node'),
  ];
  return candidates.find(isSupportedJsRuntime) || null;
}

const YTDLP_JS_RUNTIME = resolveJsRuntime();
const YTDLP_JS_ARGS = YTDLP_JS_RUNTIME
  ? ['--js-runtimes', `node:${YTDLP_JS_RUNTIME}`]
  : [];

// YouTube yüksek çözünürlükleri çoğunlukla WebM/VP9/AV1 olarak sunar.
// Format seçerken MP4/M4A ile sınırlamadan en yüksek çözünürlüğü seçiyoruz.
function videoFormatForHeight(height) {
  const maxHeight = Number.isFinite(height) && height > 0 ? Math.round(height) : null;
  return maxHeight
    ? `bestvideo[height<=${maxHeight}]+bestaudio/best[height<=${maxHeight}]/best`
    : DEFAULT_VIDEO_FORMAT;
}

// ── Binary Yolları ve Çalıştırılabilirlik Doğrulaması ───────
const BINARY_CACHE_FILE = path.join(os.tmpdir(), '.vd-binary-cache.json');
let binaryCache = null;

function loadBinaryCache() {
  if (binaryCache !== null) return binaryCache;
  if (process.env.NO_BINARY_CACHE === '1' || process.env.DISABLE_BINARY_CACHE === '1') {
    binaryCache = {};
    return binaryCache;
  }
  try {
    if (fs.existsSync(BINARY_CACHE_FILE)) {
      binaryCache = JSON.parse(fs.readFileSync(BINARY_CACHE_FILE, 'utf8'));
    } else {
      binaryCache = {};
    }
  } catch {
    binaryCache = {};
  }
  return binaryCache;
}

function saveBinaryCache() {
  if (process.env.NO_BINARY_CACHE === '1' || process.env.DISABLE_BINARY_CACHE === '1') return;
  try {
    fs.writeFileSync(BINARY_CACHE_FILE, JSON.stringify(binaryCache || {}), 'utf8');
  } catch {}
}

function isExecutableBinary(candidate) {
  if (!candidate || typeof candidate !== 'string') return false;
  const isPath = candidate.includes('/') || candidate.includes('\\');
  if (isPath && !fs.existsSync(candidate)) return false;

  let fileStat = null;
  if (isPath) {
    try {
      fileStat = fs.statSync(candidate);
      if (!fileStat.isFile()) return false;
    } catch {
      return false;
    }
  }

  // Fast-path: Check verified cache
  if (fileStat) {
    const cache = loadBinaryCache();
    const entry = cache[candidate];
    if (entry && entry.mtimeMs === fileStat.mtimeMs && entry.size === fileStat.size && entry.valid === true) {
      return true;
    }
  }

  const base = path.basename(candidate).toLowerCase();
  const flags = (base.includes('ffmpeg') || base.includes('ffprobe'))
    ? ['-version', '--version']
    : ['--version', '-version'];

  for (const flag of flags) {
    try {
      execFileSync(candidate, [flag], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 4000,
        env: getAugmentedEnv()
      });
      if (fileStat) {
        const cache = loadBinaryCache();
        cache[candidate] = { mtimeMs: fileStat.mtimeMs, size: fileStat.size, valid: true };
        saveBinaryCache();
      }
      return true;
    } catch (e) {
      if (
        e.code === 'ENOENT' ||
        e.code === 'EACCES' ||
        (e.message && (e.message.includes('system error -86') || e.message.includes('bad CPU type')))
      ) {
        return false;
      }
    }
  }
  return false;
}

function resolveExecutableBinary(envKey, candidates = [], preferredPaths = []) {
  const cList = Array.isArray(candidates) ? candidates : (candidates ? [candidates] : []);
  const pList = Array.isArray(preferredPaths) ? preferredPaths : (preferredPaths ? [preferredPaths] : []);

  const toTest = [];
  if (process.env[envKey]) toTest.push(process.env[envKey]);
  toTest.push(...pList, ...cList);

  for (const raw of toTest) {
    if (!raw) continue;
    let resolved = raw;
    if (!raw.includes('/') && !raw.includes('\\')) {
      const paths = getAugmentedPath().split(path.delimiter);
      for (const d of paths) {
        const full = path.join(d, raw);
        try {
          if (fs.existsSync(full) && fs.statSync(full).isFile()) {
            resolved = full;
            break;
          }
        } catch {}
      }
    }
    if (isExecutableBinary(resolved)) {
      return resolved;
    }
  }
  return process.env[envKey] || (pList[0] || cList[0] || null);
}

const YTDLP_PATH  = resolveExecutableBinary('YTDLP_PATH',  ['yt-dlp', 'ytdlp'], [
  '/opt/homebrew/bin/yt-dlp',
  '/usr/local/bin/yt-dlp',
  '/usr/bin/yt-dlp',
  '/Users/izharmedya/.gemini/antigravity/bin/yt-dlp'
]);
const FFMPEG_PATH = resolveExecutableBinary('FFMPEG_PATH', ['ffmpeg'], [
  '/opt/homebrew/bin/ffmpeg',
  '/usr/local/bin/ffmpeg',
  '/usr/bin/ffmpeg',
  '/Users/izharmedya/.gemini/antigravity/bin/ffmpeg'
]);
const FFPROBE_PATH = resolveExecutableBinary('FFPROBE_PATH', ['ffprobe'], [
  '/opt/homebrew/bin/ffprobe',
  '/usr/local/bin/ffprobe',
  '/usr/bin/ffprobe',
  '/Users/izharmedya/.gemini/antigravity/bin/ffprobe'
]);

// ── Şifre / Oturum ─────────────────────────────────────────
// Giriş gereksinimi kaldırılmıştır. Varsayılan olarak doğrudan açık çalışır.
// Yalnızca test ortamında açıkça IZ_LOCAL='0' verildiğinde 401 döner.
function requireAuth(req, res, next) {
  if (process.env.IZ_LOCAL === '0') {
    return res.status(401).json({ error: 'Oturum gerekli' });
  }
  return next();
}

// ── Basit Hız Sınırlayıcı (in-memory) ──────────────────────
function rateLimit(windowMs, max, label) {
  const hits = new Map();
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, arr] of hits) {
      const live = arr.filter(t => now - t < windowMs);
      if (live.length === 0) hits.delete(key);
      else hits.set(key, live);
    }
  }, 60 * 1000);
  cleanup.unref();
  return (req, res, next) => {
    const key = `${label}:${req.ip || 'unknown'}`;
    const now = Date.now();
    const arr = (hits.get(key) || []).filter(t => now - t < windowMs);
    if (arr.length >= max) return res.status(429).json({ error: 'Çok fazla istek. Lütfen biraz bekleyin.' });
    arr.push(now);
    hits.set(key, arr);
    next();
  };
}

// ── Süreç Takip Kümesi ──────────────────────────────────────
const to_kill = new Set();

function spawnProcess(binaryPath, args, options = {}) {
  const childEnv = getAugmentedEnv(options.env || {});
  const proc = spawn(binaryPath, args, {
    stdio: ['ignore', 'pipe', 'pipe'], // stdin kapalı — yt-dlp asılmasın
    ...options,
    env: childEnv
  });
  if (proc.pid) {
    to_kill.add(proc);
    proc.on('exit', () => to_kill.delete(proc));
  }
  return proc;
}

for (let evt of ['exit', 'SIGINT', 'SIGTERM', 'uncaughtException']) {
  process.on(evt, () => {
    for (let proc of to_kill) {
      try { proc.kill(9); } catch {}
    }
    if (evt !== 'exit') process.exit(0);
  });
}

// ── Kuyruk ──────────────────────────────────────────────────
const queue = [];

// ── Geçmiş Yönetimi ─────────────────────────────────────────
function readHistory() {
  try { return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')); }
  catch { return []; }
}
function saveHistory(arr) {
  fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true });
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(arr, null, 2));
}
function addToHistory(job) {
  const h = readHistory();
  h.unshift({
    id: job.id, title: job.title, platform: job.platform,
    thumbnail: job.thumbnail, filename: job.filename,
    url: job.url, audio_only: job.audio_only,
    custom_name: job.custom_name || '',
    playback_speed: job.playback_speed || 1,
    doneAt: new Date().toISOString()
  });
  saveHistory(h.slice(0, 200));
}

// ── Sistem Bildirimi (platforma göre) ───────────────────────
function notify(title, msg) {
  try {
    const cleanTitle = String(title || '').replace(/["\\]/g, '\\$&');
    const cleanMsg = String(msg || '').replace(/["\\]/g, '\\$&');
    if (process.platform === 'darwin') {
      execFileSync('osascript', [
        '-e', `display notification "${cleanMsg}" with title "${cleanTitle}"`
      ], { timeout: 3000, stdio: 'ignore', env: getAugmentedEnv() });
    } else if (process.platform === 'linux') {
      execFileSync('notify-send', [String(title), String(msg)], {
        timeout: 3000, stdio: 'ignore', env: getAugmentedEnv()
      });
    }
  } catch {}
}

// ── Kuyruk İşleyici ─────────────────────────────────────────
function processQueue() {
  const active = queue.filter(j => ['downloading', 'processing'].includes(j.status)).length;
  const waiting = queue.filter(j => j.status === 'waiting');
  const slots = MAX_CONCURRENT - active;
  waiting.slice(0, slots).forEach(startJob);
}

function normalizePlaybackSpeed(value) {
  const speed = Number(value);
  return [1, 1.25, 1.5, 2].includes(speed) ? speed : 1;
}

function atempoFilter(speed) {
  let remaining = speed;
  const filters = [];
  while (remaining > 2) {
    filters.push('atempo=2');
    remaining /= 2;
  }
  filters.push(`atempo=${remaining}`);
  return filters.join(',');
}

function isValidDownloadedFile(filename) {
  try {
    if (!filename || typeof filename !== 'string') return false;
    if (/\.f\d+\.[^.]+$/i.test(filename)) return false;
    if (/\.(part|ytdl|temp)$/i.test(filename)) return false;
    return fs.existsSync(filename) && fs.statSync(filename).isFile() && fs.statSync(filename).size > 1024;
  } catch {
    return false;
  }
}

function isMoovAtBeginning(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const stat = fs.fstatSync(fd);
    let offset = 0;
    let moovOffset = -1;
    let mdatOffset = -1;
    const headerBuf = Buffer.alloc(8);

    while (offset < stat.size) {
      const read = fs.readSync(fd, headerBuf, 0, 8, offset);
      if (read < 8) break;
      let size = headerBuf.readUInt32BE(0);
      const name = headerBuf.toString('ascii', 4, 8);

      if (name === 'moov' && moovOffset === -1) moovOffset = offset;
      if (name === 'mdat' && mdatOffset === -1) mdatOffset = offset;

      if (moovOffset !== -1 && mdatOffset !== -1) break;

      if (size === 0) {
        break;
      }
      if (size === 1) {
        const extBuf = Buffer.alloc(8);
        fs.readSync(fd, extBuf, 0, 8, offset + 8);
        size = Number(extBuf.readBigUInt64BE(0));
      }
      if (size <= 0) break;
      offset += size;
    }
    fs.closeSync(fd);
    if (moovOffset !== -1 && mdatOffset !== -1) {
      return moovOffset < mdatOffset;
    }
    return moovOffset !== -1;
  } catch {
    return false;
  }
}

function probeMediaStreams(filePath) {
  try {
    const out = execFileSync(FFPROBE_PATH, [
      '-v', 'error',
      '-show_entries', 'stream=index,codec_name,codec_type,pix_fmt,profile,level,width,height,r_frame_rate,sample_rate,channels:format=format_name,duration,bit_rate',
      '-of', 'json',
      filePath
    ], { encoding: 'utf8', timeout: 15000, env: getAugmentedEnv() });
    return JSON.parse(out);
  } catch {
    return null;
  }
}

function validateMediaStreams(filepath, isAudioOnly) {
  if (!filepath || typeof filepath !== 'string' || !fs.existsSync(filepath)) {
    return { valid: false, error: 'Dosya mevcut değil.' };
  }
  try {
    const stat = fs.statSync(filepath);
    if (!stat.isFile() || stat.size < 1024) {
      return { valid: false, error: 'Dosya boyutu geçersiz.' };
    }
    const info = probeMediaStreams(filepath);
    if (!info) {
      return { valid: false, error: 'ffprobe akış doğrulaması başarısız: bilgi alınamadı.' };
    }
    const streams = Array.isArray(info.streams) ? info.streams : [];
    const hasAudio = streams.some(s => s.codec_type === 'audio');
    const hasVideo = streams.some(s => s.codec_type === 'video');

    if (isAudioOnly) {
      if (!hasAudio) return { valid: false, error: 'Ses akışı (audio stream) bulunamadı.' };
    } else {
      if (!hasVideo) return { valid: false, error: 'Video akışı (video stream) bulunamadı (yalnızca ses indirildi).' };
    }
    return { valid: true, streams, format: info.format };
  } catch (err) {
    return { valid: false, error: `ffprobe akış doğrulaması başarısız: ${err.message}` };
  }
}

function cleanupOrphanedJobFiles(job) {
  if (!job) return [];
  const dir = getDownloadDir();
  const deleted = [];
  if (job.filename && typeof job.filename === 'string') {
    try {
      const resolved = resolveFile(job.filename) || job.filename;
      if (fs.existsSync(resolved)) {
        const isFrag = /\.f\d+\.[^.]+$/i.test(resolved) || /\.(part|ytdl|temp)$/i.test(resolved);
        if (isFrag || job.status === 'cancelled' || job.status === 'error') {
          fs.unlinkSync(resolved);
          deleted.push(resolved);
        }
      }
      for (const ext of ['.part', '.ytdl', '.temp']) {
        const p = `${resolved}${ext}`;
        if (fs.existsSync(p)) { fs.unlinkSync(p); deleted.push(p); }
      }
    } catch {}
  }
  try {
    if (!fs.existsSync(dir)) return deleted;
    const prefixes = [];
    if (job.custom_name) prefixes.push(job.custom_name.normalize('NFC'));
    if (job.title) prefixes.push(job.title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 40).normalize('NFC'));
    if (job.filename) {
      const base = path.basename(job.filename).replace(/\.f\d+\.[^.]+$/, '').replace(/\.[^.]+$/, '').normalize('NFC');
      if (base) prefixes.push(base);
    }
    if (job.url) {
      try {
        const urlObj = new URL(job.url);
        const urlBase = path.basename(urlObj.pathname).replace(/\.[^.]+$/, '').normalize('NFC');
        if (urlBase) prefixes.push(urlBase);
      } catch {}
    }
    const isFrag = name => /\.(part|ytdl|temp)$/i.test(name) || /\.f\d+\.[^.]+$/i.test(name) || (job.id && name.includes(job.id));
    const activeOtherJobs = queue.some(j => j.id !== job.id && (j.status === 'downloading' || j.status === 'processing'));

    for (const file of fs.readdirSync(dir)) {
      const fNfc = file.normalize('NFC');
      if (!isFrag(fNfc)) continue;
      const matchesJob = prefixes.some(p => p && fNfc.startsWith(p)) ||
                         (job.id && fNfc.includes(job.id)) ||
                         (!activeOtherJobs && (job.status === 'cancelled' || job.status === 'error'));
      if (matchesJob) {
        const fp = path.join(dir, file);
        try { if (fs.existsSync(fp) && fs.statSync(fp).isFile()) { fs.unlinkSync(fp); deleted.push(fp); } } catch {}
      }
    }
  } catch {}
  return deleted;
}

function finishJob(job) {
  if (job.status === 'cancelled' || job.status === 'error') return;
  job.status = 'done';
  job.progress = 100;
  job.doneAt = new Date().toISOString();
  job._proc = null;
  addToHistory(job);
  notify('Video İndirici', `✅ ${job.title || 'Video'} indirildi!`);
  processQueue();
}

function failJob(job, message) {
  if (job.status === 'cancelled') return;
  job.status = 'error';
  job.error = message || job.error || 'İşlem başarısız.';
  job._proc = null;
  cleanupOrphanedJobFiles(job);
  notify('Video İndirici', `❌ ${job.title || 'Video'} indirilemedi.`);
  processQueue();
}

function parseFps(fpsStr) {
  if (!fpsStr || typeof fpsStr !== 'string') return 30;
  const parts = fpsStr.split('/');
  if (parts.length === 2) {
    const num = Number(parts[0]);
    const den = Number(parts[1]);
    if (num > 0 && den > 0) return num / den;
  }
  const val = Number(fpsStr);
  return Number.isFinite(val) && val > 0 ? val : 30;
}

let _hasVideoToolbox = null;
function hasVideoToolbox() {
  if (_hasVideoToolbox !== null) return _hasVideoToolbox;
  if (process.platform !== 'darwin') return (_hasVideoToolbox = false);
  try {
    const out = execFileSync(FFMPEG_PATH, ['-encoders'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
      env: getAugmentedEnv()
    });
    return (_hasVideoToolbox = out.includes('h264_videotoolbox'));
  } catch {
    return (_hasVideoToolbox = false);
  }
}

function normalizeDownloadedVideo(job, done) {
  const source = job.filename;
  if (!isValidDownloadedFile(source)) {
    return done(new Error('İşlenecek video dosyası bulunamadı.'));
  }

  const info = probeMediaStreams(source);
  if (!info || !Array.isArray(info.streams)) {
    return done(new Error('Video dosyası doğrulanamadı.'));
  }

  const vStream = info.streams.find(s => s.codec_type === 'video');
  const aStream = info.streams.find(s => s.codec_type === 'audio');

  if (!vStream) {
    return done(new Error('İndirilen dosyada video akışı bulunamadı.'));
  }

  const isH264 = vStream.codec_name === 'h264';
  const isYuv420p = vStream.pix_fmt === 'yuv420p';
  const isAAC = aStream && aStream.codec_name === 'aac';
  const isSampleRate48k = aStream && parseInt(aStream.sample_rate, 10) === 48000;
  const isFastStart = isMoovAtBeginning(source);

  // Fast Path: Already H.264 + yuv420p + AAC 48k + faststart moov placement
  if (isH264 && isYuv420p && (!aStream || (isAAC && isSampleRate48k)) && isFastStart) {
    return done(null);
  }

  const baseName = path.basename(source, path.extname(source));
  const targetMp4 = path.join(path.dirname(source), `${baseName}.mp4`);
  const temp = path.join(path.dirname(source), `.${baseName}.norm-${job.id}.mp4`);
  const cleanupTemp = () => { try { if (fs.existsSync(temp)) fs.unlinkSync(temp); } catch {} };

  const finalizeOutput = () => {
    try {
      fs.renameSync(temp, targetMp4);
      if (source !== targetMp4 && fs.existsSync(source)) {
        try { fs.unlinkSync(source); } catch {}
      }
      job.filename = targetMp4;
      done(null);
    } catch (e) {
      cleanupTemp();
      done(e);
    }
  };

  let args = ['-y', '-i', source, '-map', '0:v:0'];
  if (aStream) args.push('-map', '0:a:0');

  if (isH264 && isYuv420p) {
    // Stream-copy fast path
    args.push('-c:v', 'copy');
    if (!aStream) {
      // no audio
    } else if (isAAC && isSampleRate48k) {
      args.push('-c:a', 'copy');
    } else {
      args.push('-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2');
    }
  } else {
    // Transcode path: VP9 / AV1 to H.264 High 5.1/5.2 (yuv420p)
    const fps = parseFps(vStream.r_frame_rate);
    const level = (vStream.height >= 2160 && fps > 30) ? '5.2' : '5.1';

    if (hasVideoToolbox()) {
      const bitrate = vStream.height >= 2160 ? '28M' : (vStream.height >= 1440 ? '16M' : '8M');
      args.push(
        '-c:v', 'h264_videotoolbox',
        '-b:v', bitrate,
        '-pix_fmt', 'yuv420p',
        '-profile:v', 'high',
        '-level', level
      );
    } else {
      args.push(
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '18',
        '-pix_fmt', 'yuv420p',
        '-profile:v', 'high',
        '-level', level
      );
    }

    if (aStream) {
      args.push('-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2');
    }
  }

  args.push('-movflags', '+faststart', temp);

  const proc = spawnProcess(FFMPEG_PATH, args);
  job._proc = proc;
  job.norm_pid = proc.pid;
  let stderr = '';

  proc.stderr.on('data', data => {
    stderr = `${stderr}\n${data.toString()}`.slice(-4000);
  });
  proc.on('error', err => {
    job.norm_pid = null;
    cleanupTemp();
    done(err);
  });
  proc.on('close', code => {
    job.norm_pid = null;
    if (job.status === 'cancelled') {
      cleanupTemp();
      return;
    }
    if (code !== 0 || !isValidDownloadedFile(temp)) {
      cleanupTemp();
      // If videotoolbox failed, try libx264 fallback
      if (args.includes('h264_videotoolbox')) {
        const fallbackArgs = args.map(a => a === 'h264_videotoolbox' ? 'libx264' : a)
          .filter(a => !/^\d+M$/.test(a));
        const vIdx = fallbackArgs.indexOf('libx264');
        fallbackArgs.splice(vIdx + 1, 0, '-preset', 'veryfast', '-crf', '18');
        const retryProc = spawnProcess(FFMPEG_PATH, fallbackArgs);
        job._proc = retryProc;
        let retryErr = '';
        retryProc.stderr.on('data', d => { retryErr = `${retryErr}\n${d.toString()}`.slice(-4000); });
        retryProc.on('close', rCode => {
          if (rCode !== 0 || !isValidDownloadedFile(temp)) {
            cleanupTemp();
            done(new Error(retryErr.trim().split('\n').slice(-1)[0] || 'Video dönüştürme başarısız oldu.'));
            return;
          }
          finalizeOutput();
        });
        return;
      }
      done(new Error(stderr.trim().split('\n').slice(-1)[0] || 'Video dönüştürme başarısız oldu.'));
      return;
    }

    finalizeOutput();
  });
}

function speedUpDownloadedFile(job, done) {
  const speed = normalizePlaybackSpeed(job.playback_speed);
  if (speed <= 1 || !job.filename) return done(null);
  if (!isValidDownloadedFile(job.filename)) return done(new Error('Hızlandırılacak dosya bulunamadı.'));

  const source = job.filename;
  const targetExt = job.audio_only ? '.mp3' : '.mp4';
  const baseName = path.basename(source, path.extname(source));
  const targetFile = path.join(path.dirname(source), `${baseName}${targetExt}`);
  const temp = path.join(path.dirname(source), `.${baseName}.speed-${job.id}${targetExt}`);
  const args = ['-y', '-i', source];

  if (job.audio_only) {
    args.push(
      '-filter:a', atempoFilter(speed),
      '-c:a', 'libmp3lame',
      '-b:a', '320k',
      '-ar', '44100',
      '-id3v2_version', '3',
      '-write_id3v1', '1'
    );
  } else {
    args.push(
      '-map', '0:v:0', '-map', '0:a?',
      '-vf', `setpts=PTS/${speed}`,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18',
      '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-level', '5.1',
      '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
      '-filter:a', atempoFilter(speed),
      '-movflags', '+faststart'
    );
  }
  args.push(temp);

  const proc = spawnProcess(FFMPEG_PATH, args);
  job._proc = proc;
  job.speed_pid = proc.pid;
  let stderr = '';
  const cleanupTemp = () => { try { if (fs.existsSync(temp)) fs.unlinkSync(temp); } catch {} };

  proc.stderr.on('data', data => {
    stderr = `${stderr}\n${data.toString()}`.slice(-4000);
  });
  proc.on('error', err => {
    job.speed_pid = null;
    cleanupTemp();
    done(err);
  });
  proc.on('close', code => {
    job.speed_pid = null;
    if (job.status === 'cancelled') {
      cleanupTemp();
      return;
    }
    if (code !== 0 || !isValidDownloadedFile(temp)) {
      cleanupTemp();
      done(new Error(stderr.trim().split('\n').slice(-1)[0] || 'Medya hızı değiştirilemedi.'));
      return;
    }

    try {
      fs.renameSync(temp, targetFile);
      if (source !== targetFile && fs.existsSync(source)) {
        try { fs.unlinkSync(source); } catch {}
      }
      job.filename = targetFile;
      done(null);
    } catch (err) {
      cleanupTemp();
      done(err);
    }
  });
}

function isYouTubeUrl(inputUrl) {
  if (!inputUrl || typeof inputUrl !== 'string') return false;
  try {
    const parsed = new URL(inputUrl);
    const host = parsed.hostname.toLowerCase();
    return (
      host === 'youtu.be' ||
      host.endsWith('.youtu.be') ||
      host === 'youtube.com' ||
      host.endsWith('.youtube.com') ||
      host === 'youtube-nocookie.com' ||
      host.endsWith('.youtube-nocookie.com')
    );
  } catch {
    return /(?:^|[\/.])(?:youtu\.be|youtube\.com|youtube-nocookie\.com)(?:$|[\/:?#])/i.test(inputUrl);
  }
}

function isKickUrl(inputUrl) {
  if (!inputUrl || typeof inputUrl !== 'string') return false;
  try {
    const parsed = new URL(inputUrl);
    const host = parsed.hostname.toLowerCase();
    return host === 'kick.com' || host.endsWith('.kick.com');
  } catch {
    return /(?:^|[\/.])kick\.com(?:$|[\/:?#])/i.test(inputUrl);
  }
}

function normalizeMediaUrl(inputUrl) {
  if (!inputUrl || typeof inputUrl !== 'string') return inputUrl;
  const trimmed = inputUrl.trim();
  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase();

    // ── Kick URL Normalizasyonu ────────────────────────────────
    if (host === 'kick.com' || host.endsWith('.kick.com')) {
      const pathname = parsed.pathname;
      const searchParams = parsed.searchParams;

      // 1. ?video=UUID (örn: https://kick.com/xqc?video=UUID veya https://kick.com?video=UUID)
      const videoParam = searchParams.get('video');
      if (videoParam) {
        const cleanPath = pathname.replace(/^\/+|\/+$/g, '');
        const channel = (cleanPath && !['video', 'videos', 'clip', 'clips'].includes(cleanPath.toLowerCase())) ? cleanPath : '_';
        return `https://kick.com/${channel}/videos/${videoParam}`;
      }

      // 2. ?clip=clip_ID (örn: https://kick.com/xqc?clip=clip_ID)
      const clipParam = searchParams.get('clip');
      if (clipParam) {
        const cleanPath = pathname.replace(/^\/+|\/+$/g, '');
        const channel = (cleanPath && !['video', 'videos', 'clip', 'clips'].includes(cleanPath.toLowerCase())) ? cleanPath : '_';
        return `https://kick.com/${channel}/clips/${clipParam}`;
      }

      // 3. /video/UUID veya /videos/UUID (kanalsız doğrudan video linki)
      const rootVideoMatch = pathname.match(/^\/(?:video|videos)\/([a-f0-9-]+)/i);
      if (rootVideoMatch) {
        return `https://kick.com/_/videos/${rootVideoMatch[1]}`;
      }

      // 4. /{channel}/video/UUID (tekil 'video' kullanımı)
      const channelVideoMatch = pathname.match(/^\/([^/]+)\/video\/([a-f0-9-]+)/i);
      if (channelVideoMatch && !['video', 'videos', 'clip', 'clips'].includes(channelVideoMatch[1].toLowerCase())) {
        return `https://kick.com/${channelVideoMatch[1]}/videos/${channelVideoMatch[2]}`;
      }

      // 5. /clip/clip_ID veya /clips/clip_ID (kanalsız klip linki)
      const rootClipMatch = pathname.match(/^\/(?:clip|clips)\/(clip_[a-zA-Z0-9_-]+)/i);
      if (rootClipMatch) {
        return `https://kick.com/_/clips/${rootClipMatch[1]}`;
      }

      // 6. /{channel}/clip/clip_ID (tekil 'clip' kullanımı)
      const channelClipMatch = pathname.match(/^\/([^/]+)\/clip\/(clip_[a-zA-Z0-9_-]+)/i);
      if (channelClipMatch && !['video', 'videos', 'clip', 'clips'].includes(channelClipMatch[1].toLowerCase())) {
        return `https://kick.com/${channelClipMatch[1]}/clips/${channelClipMatch[2]}`;
      }
    }

    return trimmed;
  } catch {
    return trimmed;
  }
}

function parseIso8601Duration(dur) {
  if (!dur || typeof dur !== 'string') return null;
  const m = dur.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/i);
  if (!m) return null;
  const hours = parseInt(m[1] || '0', 10);
  const minutes = parseInt(m[2] || '0', 10);
  const seconds = parseInt(m[3] || '0', 10);
  return (hours * 3600) + (minutes * 60) + seconds;
}

function resolveKickMedia(url) {
  return new Promise((resolve) => {
    try {
      if (!url || typeof url !== 'string') return resolve(null);
      const parsed = new URL(url);
      if (!parsed.hostname.toLowerCase().includes('kick.com')) {
        return resolve(null);
      }

      const https = require('https');
      const req = https.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7'
        },
        timeout: 8000
      }, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return resolve(resolveKickMedia(res.headers.location));
        }
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            const matches = [...data.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)];
            for (const match of matches) {
              try {
                const parsedJson = JSON.parse(match[1]);
                const graph = parsedJson['@graph'] || [parsedJson];
                const videoObj = graph.find(item => item && item['@type'] === 'VideoObject');
                if (videoObj && videoObj.contentUrl) {
                  const channelMatch = parsed.pathname.match(/^\/([^/]+)/);
                  const channelSlug = (channelMatch && !['video', 'videos', 'clip', 'clips'].includes(channelMatch[1].toLowerCase()))
                    ? channelMatch[1]
                    : null;
                  return resolve({
                    title: videoObj.name || null,
                    streamUrl: videoObj.contentUrl,
                    thumbnail: Array.isArray(videoObj.thumbnailUrl) ? videoObj.thumbnailUrl[0] : (videoObj.thumbnailUrl || null),
                    duration: parseIso8601Duration(videoObj.duration),
                    uploader: videoObj.creator?.name || channelSlug || null
                  });
                }
              } catch {}
            }
          } catch {}
          resolve(null);
        });
      });

      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
    } catch {
      resolve(null);
    }
  });
}

function startJob(job) {
  job.status = 'downloading';
  job.progress = 0;
  job.url = normalizeMediaUrl(job.url);

  const isAudio = job.audio_only === true;
  job.playback_speed = normalizePlaybackSpeed(job.playback_speed);
  const customStem = sanitizeFileStem(job.custom_name);
  const titleStem = sanitizeFileStem(job.title && job.title !== 'Video' && job.title !== 'master' ? job.title : '');
  const preferredStem = customStem || titleStem;

  const outputTemplate = preferredStem
    ? path.join(getDownloadDir(), job.is_playlist
      ? `${preferredStem} - %(playlist_index)s - %(title)s.%(ext)s`
      : `${preferredStem}.%(ext)s`)
    : path.join(getDownloadDir(), '%(title)s.%(ext)s');

  let args = [
    '--no-warnings',
    '--no-check-certificates',
    '--geo-bypass',
    ...YTDLP_JS_ARGS,
    '--ffmpeg-location', FFMPEG_PATH,
    '-o', outputTemplate,
    '--newline',
  ];

  if (isYouTubeUrl(job.url)) {
    args.push('--extractor-args', `youtube:player_client=${YOUTUBE_CLIENTS}`);
  }

  // Playlist
  if (job.is_playlist) {
    args.push('--yes-playlist');
  } else {
    args.push('--no-playlist');
  }

  // Trim
  const sanitizeTimestamp = v => typeof v === 'string' ? v.trim().replace(/[^0-9:.]/g, '') : '';
  const trimStart = sanitizeTimestamp(job.trim_start);
  const trimEnd   = sanitizeTimestamp(job.trim_end);
  if (trimStart || trimEnd) {
    const s = trimStart || '0';
    const e = trimEnd   || 'inf';
    args.push('--download-sections', `*${s}-${e}`);
    args.push('--force-keyframes-at-cuts');
  }

  // Thumbnail
  if (job.download_thumbnail) {
    args.push('--write-thumbnail', '--convert-thumbnails', 'jpg');
  }

  // Format
  if (isAudio) {
    args.push('-f', 'bestaudio/best');
    args.push('-x', '--audio-format', 'mp3', '--audio-quality', '320k');
    args.push(
      '--ppa',
      'ExtractAudio+ffmpeg:-ar 44100 -ac 2 -id3v2_version 3 -write_id3v1 1 -map_metadata -1'
    );
  } else {
    const reqFormat = job.format_id || DEFAULT_VIDEO_FORMAT;
    const isSelectorExpr = /bestvideo|best\[/i.test(reqFormat);
    const effectiveFormat = (reqFormat.endsWith('/best') || reqFormat === 'best' || !isSelectorExpr)
      ? reqFormat
      : `${reqFormat}/best`;
    args.push('-f', effectiveFormat);
    args.push('--merge-output-format', 'mp4');
    args.push('--format-sort', 'res,vcodec:h264,acodec:aac');
  }

  args.push(job.stream_url || job.url);

  const proc = spawnProcess(YTDLP_PATH, args);
  job.pid = proc.pid;

  proc.on('error', (err) => {
    if (job.status === 'cancelled') return;
    failJob(job, err.message || 'İndirme işlemi başlatılamadı.');
  });

  proc.stdout.on('data', (data) => {
    const line = data.toString();

    // % ilerleme
    const pct = line.match(/(\d+\.?\d*)%/);
    if (pct) job.progress = Math.min(parseFloat(pct[1]), 99);

    // Hız
    const spd = line.match(/at\s+([\d.]+\s*\w+\/s)/);
    if (spd) job.speed = spd[1];

    // ETA
    const eta = line.match(/ETA\s+([\d:]+)/);
    if (eta) job.eta = eta[1];

    // Dosya adı
    const dest = line.match(/\[download\] Destination: (.+)/);
    if (dest) job.filename = dest[1].trim();
    const merge = line.match(/\[Merger\] Merging formats into "(.+)"/);
    if (merge) job.filename = merge[1].trim();
    const audio = line.match(/\[ExtractAudio\] Destination: (.+)/);
    if (audio) job.filename = audio[1].trim();
    const convert = line.match(/\[(?:VideoConvertor|VideoRemuxer)\] Destination: (.+)/);
    if (convert) job.filename = convert[1].trim();
    const already = line.match(/\[download\] (.+) has already been downloaded/);
    if (already) job.filename = already[1].trim();
  });

  proc.stderr.on('data', (data) => {
    const line = data.toString();
    if (!line.includes('WARNING')) job.error = [job.error, line.trim()].filter(Boolean).join('\n').slice(-4000);
  });

  proc.on('close', (code) => {
    if (job.status === 'cancelled' || job.status === 'error') {
      cleanupOrphanedJobFiles(job);
      return;
    }

    if (code !== 0) {
      cleanupOrphanedJobFiles(job);
      return failJob(job, job.error || `İndirme işlemi başarısız oldu (çıkış kodu: ${code}).`);
    }

    if (job.filename && /\.f\d+\.[^.]+$/i.test(job.filename)) {
      const targetExt = isAudio ? '.mp3' : '.mp4';
      const expectedTarget = job.filename.replace(/\.f\d+\.[^.]+$/, targetExt);
      if (fs.existsSync(expectedTarget)) {
        job.filename = expectedTarget;
      } else {
        cleanupOrphanedJobFiles(job);
        return failJob(job, 'İndirme tamamlanamadı: Birleştirilmiş medya dosyası üretilemedi.');
      }
    }

    if (!isValidDownloadedFile(job.filename)) {
      cleanupOrphanedJobFiles(job);
      return failJob(job, 'İndirilen dosya bulunamadı veya boyutu geçersiz.');
    }

    const finalize = () => {
      const validation = validateMediaStreams(job.filename, isAudio);
      if (!validation.valid) {
        cleanupOrphanedJobFiles(job);
        return failJob(job, `Medya doğrulama hatası: ${validation.error}`);
      }
      finishJob(job);
    };

    job.status = 'processing';
    job.progress = 99;

    if (isAudio) {
      if (job.playback_speed > 1) {
        speedUpDownloadedFile(job, err => {
          if (job.status === 'cancelled') return;
          if (err) return failJob(job, `${job.playback_speed}x hızlandırma başarısız: ${err.message}`);
          finalize();
        });
      } else {
        finalize();
      }
    } else {
      if (job.playback_speed > 1) {
        speedUpDownloadedFile(job, err => {
          if (job.status === 'cancelled') return;
          if (err) return failJob(job, `${job.playback_speed}x hızlandırma başarısız: ${err.message}`);
          finalize();
        });
      } else {
        normalizeDownloadedVideo(job, err => {
          if (job.status === 'cancelled') return;
          if (err) return failJob(job, `Video dönüştürme başarısız: ${err.message}`);
          finalize();
        });
      }
    }
  });

  job._proc = proc;
}

// ── Dosya Erişim Güvenliği ──────────────────────────────────
function resolveInsideDownloadsDir(filepath) {
  if (!filepath) return null;
  const resolved = path.resolve(filepath);
  const rel = path.relative(getDownloadDir(), resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return resolved;
}

function findJobOrHistory(id) {
  return queue.find(j => j.id === id) || readHistory().find(h => h.id === id);
}

// Geçmiş klasörü değiştirilse bile eski klasörlerdeki dosyaları da kabul et.
function resolveFile(jobFilename) {
  const safe = resolveInsideDownloadsDir(jobFilename);
  if (safe) return safe;
  // Yerel güvenilir uygulama: gerçek ve var olan bir dosyaysa eski konumdan da ver
  try {
    if (fs.existsSync(jobFilename) && fs.statSync(jobFilename).isFile()) return jobFilename;
  } catch {}
  return null;
}

// Kullanıcı adını güvenli bir dosya adına çevir; uzantıyı indirme türü ekler.
function sanitizeFileStem(value) {
  let stem = String(value || '').trim();
  if (!stem) return null;
  stem = path.basename(stem)
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/[\u0000-\u001F]/g, '_')
    .replace(/\.(?:mp4|mkv|webm|mov|avi|mp3|m4a|wav|flac|jpg|jpeg|png|webp)$/i, '')
    .replace(/\s+/g, ' ')
    .replace(/^\.+|\.+$/g, '')
    .trim()
    .slice(0, 180);
  return stem || null;
}

// ── API: Giriş / Çıkış / Oturum (Girişsiz kullanım uyumluluğu) ─────────
app.post('/api/login', (req, res) => res.json({ ok: true }));
app.post('/api/logout', (req, res) => res.json({ ok: true }));
app.get('/api/me', (req, res) => res.json({ ok: true }));

// ── API: Varsayılan Kayıt Klasörü ───────────────────────────
app.get('/api/default-path', requireAuth, (req, res) => {
  res.json({ path: getDownloadDir() });
});

// ── API: Kayıt Klasörünü Değiştir ───────────────────────────
app.post('/api/download-dir', requireAuth, (req, res) => {
  const p = (req.body && req.body.path) || '';
  if (!p || !path.isAbsolute(p)) return res.status(400).json({ error: 'Geçersiz klasör yolu' });
  try {
    fs.mkdirSync(p, { recursive: true });
    downloadDir = path.resolve(p);
    res.json({ ok: true, path: downloadDir });
  } catch (e) {
    res.status(500).json({ error: 'Klasör ayarlanamadı: ' + (e.message || '') });
  }
});

// ── API: Native macOS Klasör Seçici ──────────────────────────
app.get('/api/pick-folder', requireAuth, (req, res) => {
  try {
    if (process.platform === 'darwin') {
      const folder = execFileSync('osascript', [
        '-e', 'POSIX path of (choose folder with prompt "Video indirme klasörünü seçin:")'
      ], { encoding: 'utf8', timeout: 60000, env: getAugmentedEnv() }).trim();
      if (folder) {
        downloadDir = path.resolve(folder);
        return res.json({ ok: true, path: downloadDir });
      }
    }
    return res.status(204).end();
  } catch {
    return res.status(204).end();
  }
});

// ── API: Klasörü Finder'da Aç ────────────────────────────────
app.post('/api/open-dir', requireAuth, (req, res) => {
  try {
    const rawTarget = (req.body && req.body.path) || downloadDir;
    if (typeof rawTarget !== 'string') return res.status(400).json({ error: 'Geçersiz yol' });
    const target = path.resolve(rawTarget);
    if (!fs.existsSync(target)) {
      return res.status(404).json({ error: 'Klasör bulunamadı' });
    }
    if (process.platform === 'darwin') {
      execFileSync('open', [target], { timeout: 5000, stdio: 'ignore', env: getAugmentedEnv() });
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Açılamadı' });
  }
});

// ── API: Dosyayı Finder'da Göster ────────────────────────────
app.post('/api/show-file', requireAuth, (req, res) => {
  try {
    const rawTarget = req.body && req.body.path;
    if (!rawTarget || typeof rawTarget !== 'string') return res.status(400).json({ error: 'Dosya yolu gerekli' });
    const target = path.resolve(rawTarget);
    if (!fs.existsSync(target)) {
      return res.status(404).json({ error: 'Dosya bulunamadı' });
    }
    if (process.platform === 'darwin') {
      execFileSync('open', ['-R', target], { timeout: 5000, stdio: 'ignore', env: getAugmentedEnv() });
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Gösterilemedi' });
  }
});


// ── API: Video Bilgisi ──────────────────────────────────────
app.post('/api/info', requireAuth, rateLimit(60 * 1000, 8, 'info'), (req, res) => {
  let { url } = req.body;
  if (!url || typeof url !== 'string') return res.status(400).json({ error: 'URL gerekli' });
  if (/[\r\n\0\t\x00-\x1f]/.test(url)) return res.status(400).json({ error: 'Geçersiz URL' });

  url = url.trim();
  if (!/^https?:\/\//i.test(url)) {
    url = 'https://' + url;
  }
  // Sadece http/https şemalarına izin ver (SSRF koruması)
  if (!/^https?:\/\//i.test(url)) {
    return res.status(400).json({ error: 'Geçersiz URL' });
  }

  url = normalizeMediaUrl(url);

  const runYtDlp = (targetUrl, extraArgs = [], timeoutMs = 0) => {
    return new Promise((resolve) => {
      const args = [
        '--dump-json',
        '--no-warnings',
        '--no-check-certificates',
        '--geo-bypass',
        ...YTDLP_JS_ARGS,
        '--user-agent', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        ...extraArgs,
      ];
      args.push(targetUrl);

      let done = false;
      const finish = (val) => { if (!done) { done = true; resolve(val); } };

      const proc = spawnProcess(YTDLP_PATH, args);
      let out = '', err = '';
      proc.stdout.on('data', d => { out += d; });
      proc.stderr.on('data', d => { err += d; });

      let timer = null;
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          try { proc.kill('SIGKILL'); } catch {}
          finish({ code: -1, out, err: `${err} [zaman aşımı]` });
        }, timeoutMs);
      }
      proc.on('error', e => { clearTimeout(timer); finish({ code: -1, out: '', err: e.message }); });
      proc.on('close', code => { clearTimeout(timer); finish({ code, out, err }); });
    });
  };

  const isBotError = (r) => r.err && (r.err.includes('Sign in to confirm') || r.err.includes('bot'));

  (async () => {
    console.log(`[/api/info] İstek alındı: ${url}`);

    const isYouTube = isYouTubeUrl(url);
    const isKick = isKickUrl(url);

    let kickMeta = null;
    let targetUrl = url;
    if (isKick) {
      try {
        kickMeta = await resolveKickMedia(url);
        if (kickMeta && kickMeta.streamUrl) {
          targetUrl = kickMeta.streamUrl;
          console.log(`[/api/info] Kick stream URL çözüldü: ${targetUrl.slice(0, 80)}...`);
        }
      } catch (err) {
        console.error('[/api/info] Kick resolve hatası:', err);
      }
    }

    const attempts = isYouTube
      ? [
          ['--playlist-end', '1', '--extractor-args', 'youtube:player_client=web_embedded'],
          ['--playlist-end', '1', '--extractor-args', 'youtube:player_client=web_safari'],
          ['--playlist-end', '1', '--extractor-args', 'youtube:player_client=android_vr'],
          ['--playlist-end', '1', '--extractor-args', 'youtube:player_client=android'],
          ['--playlist-end', '1', '--extractor-args', 'youtube:player_client=ios'],
          ['--playlist-end', '1', '--extractor-args', 'youtube:player_client=web_creator'],
          ['--no-playlist', '--extractor-args', 'youtube:player_client=android,ios,web_embedded,web_creator,tv'],
        ]
      : isKick
      ? [
          ['--playlist-end', '1'],
          ['--playlist-end', '1', '--impersonate', 'chrome']
        ]
      : [
          ['--playlist-end', '1']
        ];

    const CONCURRENCY = 1;         // paralel istek YouTube'u yavaşlatıyor; teker teker
    const ATTEMPT_TIMEOUT = isYouTube ? 25000 : 10000;
    const startTime = Date.now();
    const queue = attempts.slice();
    let active = 0, settled = false;
    let lastError = '';
    let result = await new Promise((resolve) => {
      const spawnNext = () => {
        while (active < CONCURRENCY && queue.length && !settled) {
          const args = queue.shift();
          active++;
          runYtDlp(targetUrl, args, ATTEMPT_TIMEOUT).then(r => {
            active--;
            if (r.err) lastError = r.err;
            const client = args[args.length - 1] || args[args.length - 2];
            console.log(`[/api/info] ${client} => kod:${r.code} stdout:${r.out.length}b err:${r.err.slice(0,80)}`);
            if (!settled && r.code === 0 && r.out.trim()) { settled = true; resolve(r); return; }
            if (!settled) spawnNext();
            if (active === 0 && queue.length === 0 && !settled) resolve(null);
          });
        }
      };
      spawnNext();
    });
    console.log(`[/api/info] tamamlandı (${Date.now() - startTime}ms)${result ? '' : ' — tüm clientlar başarısız'}`);
    if (!result) result = { code: -1, out: '', err: lastError || 'Tüm clientlar başarısız.' };

    if (result.code !== 0 || !result.out.trim()) {
      console.error(`[/api/info HATA] ${result.err.slice(0, 400)}`);
      let errorMsg = 'Video bilgileri alınamadı. Geçerli ve erişilebilir bir link giriniz.';
      if (isBotError(result)) {
        errorMsg = 'YouTube bu videoyu indirmeye izin vermiyor. Farklı bir link veya platform deneyin.';
      } else if (result.err && result.err.includes('The channel is not currently live')) {
        errorMsg = 'Bu Kick kanalı şu anda canlı yayında değil. Canlı bir yayın veya geçmiş bir yayın (VOD) / klip linki giriniz.';
      } else if (result.err && (result.err.includes('Unable to download JSON') || result.err.includes('HTTP Error 404'))) {
        errorMsg = isKick
          ? 'Kick videosu veya yayını bulunamadı. Linkin doğruluğunu kontrol ediniz.'
          : 'Video bilgileri alınamadı. Geçerli ve erişilebilir bir link giriniz.';
      }
      return res.status(400).json({
        error: errorMsg,
        detail: result.err
      });
    }

    console.log(`[/api/info] Başarılı, JSON parse ediliyor...`);
    const { out } = result;
    try {
      const lines = out.trim().split('\n').filter(Boolean);
      const infos = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      const first = infos[0];
      const isPlaylist = infos.length > 1 || first?._type === 'playlist';

      // maxHeight sadece "En İyi Kalite" label'ı için kullanılır, seçenekleri kısaltmaz.
      // Android/restricted client'lardan yanlış düşük maxHeight gelebilir.
      let maxHeight = 0;
      if (Array.isArray(first?.formats) && first.formats.length > 1) {
        // Birden fazla format varsa (web client) — gerçek max yüksekliği al
        const heights = first.formats.map(f => f.height).filter(h => typeof h === 'number' && h > 0);
        if (heights.length > 0) maxHeight = Math.max(...heights);
      }
      // Tek format varsa (android kısıtlı client) maxHeight'ı görmezden gel

      let bestLabel = 'En İyi Kalite';
      if (maxHeight >= 2160) bestLabel = 'En İyi Kalite (4K)';
      else if (maxHeight >= 1440) bestLabel = 'En İyi Kalite (2K)';
      else if (maxHeight >= 1080) bestLabel = 'En İyi Kalite (1080p)';
      else if (maxHeight >= 720)  bestLabel = 'En İyi Kalite (720p)';

      // Her zaman tüm seçenekleri göster — yt-dlp download anında gerçek en iyiyi seçer
      const allTiers = [
        { height: 2160, format_id: videoFormatForHeight(2160), label: '4K (2160p)', ext: 'mp4' },
        { height: 1440, format_id: videoFormatForHeight(1440), label: '2K (1440p)', ext: 'mp4' },
        { height: 1080, format_id: videoFormatForHeight(1080), label: '1080p', ext: 'mp4' },
        { height: 720,  format_id: videoFormatForHeight(720),  label: '720p',  ext: 'mp4' },
        { height: 480,  format_id: videoFormatForHeight(480),  label: '480p',  ext: 'mp4' },
        { height: 360,  format_id: videoFormatForHeight(360),  label: '360p',  ext: 'mp4' },
      ];

      const standardFormats = [
        { format_id: DEFAULT_VIDEO_FORMAT, label: bestLabel, ext: 'mp4' },
        ...allTiers,
        { format_id: 'bestaudio/best', label: 'Sadece Ses (MP3 320k)', ext: 'mp3', audio_only: true },
      ];

      // Extract thumbnail options & A/B test variants
      let ytId = null;
      if (first?.id && /^[a-zA-Z0-9_-]{11}$/.test(first.id)) {
        ytId = first.id;
      } else if (url) {
        const m = String(url).match(/(?:youtu\.be\/|v=|\/embed\/|\/shorts\/)([a-zA-Z0-9_-]{11})/);
        if (m) ytId = m[1];
      }

      let thumbnailList = [];
      let abVariants = [];

      // 1. Temiz ve tekil çözünürlük listesi (Gereksiz mikro-boyutları ve Standart Kapak tekrarlarını engeller)
      const has1080p = (Array.isArray(first?.thumbnails) && first.thumbnails.some(t => t && (t.width >= 1920 || t.height >= 1080) && !/[\/=]sb[\/=]|storyboard/i.test(t.url || ''))) ||
                       Boolean(first?.thumbnail && /maxresdefault/i.test(first.thumbnail));
      const has720p = has1080p ||
                      (Array.isArray(first?.thumbnails) && first.thumbnails.some(t => t && (t.width >= 1280 || t.height >= 720) && !/[\/=]sb[\/=]|storyboard/i.test(t.url || ''))) ||
                      Boolean(first?.thumbnail && /hq720/i.test(first.thumbnail));

      if (Array.isArray(first?.thumbnails) && first.thumbnails.length > 0) {
        // Yalnızca anlamlı çözünürlükleri al (en az 480x360), böylece 120x90, 168x94 gibi minik parçalar elenir
        let validSized = first.thumbnails
          .filter(t => t && t.url && typeof t.width === 'number' && typeof t.height === 'number' && t.width >= 480 && t.height >= 360)
          .sort((a, b) => (b.width * b.height) - (a.width * a.height));

        // Eğer hiç büyük çözünürlük bulunamadıysa en büyük mevcut boyutları al
        if (validSized.length === 0) {
          validSized = first.thumbnails
            .filter(t => t && t.url && typeof t.width === 'number' && typeof t.height === 'number' && t.width > 0 && t.height > 0)
            .sort((a, b) => (b.width * b.height) - (a.width * a.height));
        }

        const seenResolutions = new Set();
        validSized.forEach(t => {
          const isStoryboard = /[\/=]sb[\/=]|storyboard|\/1\.jpg|\/2\.jpg|\/3\.jpg/i.test(t.url);
          if (isStoryboard) return;

          const resKey = `${t.width}x${t.height}`;
          if (!seenResolutions.has(resKey)) {
            seenResolutions.add(resKey);
            let label = `${t.width}×${t.height}`;
            if (t.height >= 1080 || t.width >= 1920) label += ' (En Yüksek)';
            else if (t.height >= 720 || t.width >= 1280) label += ' (HD)';
            else if (t.height >= 480) label += ' (SD)';
            else label += ' (Standart)';
            thumbnailList.push({
              url: t.url,
              resolution: `${t.width}×${t.height}`,
              label: label,
              width: t.width,
              height: t.height
            });
          }
        });
      }

      // YouTube için doğrulanmış çözünürlük standart şablonları
      if (ytId) {
        const standardYt = [];
        if (has1080p) {
          standardYt.push({ url: `https://i.ytimg.com/vi/${ytId}/maxresdefault.jpg`, resolution: '1920×1080', label: '1920×1080 (En Yüksek)', width: 1920, height: 1080 });
        }
        if (has720p) {
          standardYt.push({ url: `https://i.ytimg.com/vi/${ytId}/hq720.jpg`, resolution: '1280×720', label: '1280×720 (HD)', width: 1280, height: 720 });
        }
        standardYt.push(
          { url: `https://i.ytimg.com/vi/${ytId}/sddefault.jpg`, resolution: '640×480', label: '640×480 (SD)', width: 640, height: 480 },
          { url: `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`, resolution: '480×360', label: '480×360 (Standart)', width: 480, height: 360 }
        );

        standardYt.forEach(st => {
          if (!thumbnailList.some(ex => ex.resolution === st.resolution)) {
            thumbnailList.push(st);
          }
        });
        thumbnailList.sort((a,b) => (b.width * b.height) - (a.width * a.height));
      }

      // primaryThumbUrl: Doğrulanmış first.thumbnail veya en yüksek çözünürlük
      const primaryThumbUrl = first?.thumbnail || thumbnailList[0]?.url || kickMeta?.thumbnail || null;
      if (thumbnailList.length === 0 && primaryThumbUrl) {
        thumbnailList.push({
          url: primaryThumbUrl,
          label: 'En Yüksek Kalite',
          resolution: 'HD',
          width: 1920,
          height: 1080
        });
      }

      // 2. A/B Test ve Alternatif Kapak Varyantlarını Yapılandır
      abVariants.push({
        id: 'var_primary',
        title: 'Ana Kapak (En Yüksek Kalite)',
        label: 'Ana Kapak',
        badge: 'Varsayılan',
        url: primaryThumbUrl,
        resolution: thumbnailList[0]?.resolution || 'Full HD',
        isCurrent: true,
        type: 'primary'
      });

      const seenVariantUrls = new Set([primaryThumbUrl]);
      let abCounter = 1;
      if (Array.isArray(first?.thumbnails)) {
        first.thumbnails.forEach(t => {
          if (!t || !t.url) return;
          const isCustom = /custom_[0-9]+|i9\.ytimg\.com/i.test(t.url) || /custom/i.test(t.id || '');
          if (isCustom && !seenVariantUrls.has(t.url)) {
            seenVariantUrls.add(t.url);
            abVariants.push({
              id: `var_ab_${abCounter}`,
              title: `A/B Test Kapak ${abCounter}`,
              label: `A/B Kapak ${abCounter}`,
              badge: 'A/B Test',
              url: t.url,
              resolution: t.width && t.height ? `${t.width}×${t.height}` : 'HD',
              isCurrent: false,
              type: 'ab_test'
            });
            abCounter++;
          }
        });
      }

      if (ytId) {
        const frameTitles = [
          'Alternatif Kare 1 (%25)',
          'Alternatif Kare 2 (%50)',
          'Alternatif Kare 3 (%75)'
        ];
        [1, 2, 3].forEach((fNum, idx) => {
          const frameUrl = `https://i.ytimg.com/vi/${ytId}/hq${fNum}.jpg`;
          if (!seenVariantUrls.has(frameUrl)) {
            seenVariantUrls.add(frameUrl);
            abVariants.push({
              id: `var_frame_${fNum}`,
              title: frameTitles[idx],
              label: `Kare ${fNum}`,
              badge: 'Kare Seçeneği',
              url: frameUrl,
              resolution: '480×360',
              isCurrent: false,
              type: 'frame'
            });
          }
        });
      }

      let platformName = first?.extractor_key || 'Unknown';
      if (/^kick/i.test(platformName) || isKick) platformName = 'Kick';

      const finalTitle = kickMeta?.title || (first?.title && first.title !== 'master' ? first.title : null) || first?.playlist_title || 'Video';
      const finalThumb = primaryThumbUrl;
      const finalThumbnails = thumbnailList;
      const finalDuration = kickMeta?.duration || first?.duration || null;
      const finalUploader = kickMeta?.uploader || first?.uploader || first?.channel || null;

      res.json({
        title:       finalTitle,
        thumbnail:   finalThumb,
        thumbnails:  finalThumbnails,
        variants:    abVariants,
        duration:    finalDuration,
        uploader:    finalUploader,
        platform:    platformName,
        stream_url:  kickMeta?.streamUrl || null,
        is_playlist: isPlaylist,
        playlist_count: isPlaylist ? infos.length : null,
        formats:     standardFormats,
      });
    } catch (e) {
      res.status(500).json({ error: 'Yanıt işlenemedi.' });
    }
  })();
});

// ── API: Kapak Resmi İndir (Attachment Stream) ─────────────
app.get('/api/download-thumbnail-file', requireAuth, rateLimit(60 * 1000, 30, 'thumb'), (req, res) => {
  const imageUrl = req.query.url;
  const title = req.query.title || 'kapak-resmi';
  if (!imageUrl || typeof imageUrl !== 'string') return res.status(400).send('URL gerekli');
  if (/[\r\n\0\t\x00-\x1f]/.test(imageUrl) || !/^https?:\/\//i.test(imageUrl.trim())) return res.status(400).send('Geçersiz URL');

  const cleanBase = title.replace(/[^\w\s\u00C0-\u024F\u1E00-\u1EFF\u0400-\u04FF-]/gi, '_').trim().slice(0, 60) || 'kapak-resmi';

  const fetchWithRedirects = (currentUrl, redirectCount = 0) => {
    if (redirectCount > 5) {
      return res.status(500).send('Çok fazla yönlendirme');
    }

    let parsed;
    try {
      parsed = new URL(currentUrl);
    } catch {
      return res.status(400).send('Geçersiz URL');
    }

    const mod = parsed.protocol === 'https:' ? require('https') : require('http');
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
      }
    };

    mod.get(parsed, options, (imgRes) => {
      if (imgRes.statusCode >= 300 && imgRes.statusCode < 400 && imgRes.headers.location) {
        const nextUrl = new URL(imgRes.headers.location, currentUrl).toString();
        imgRes.resume();
        return fetchWithRedirects(nextUrl, redirectCount + 1);
      }

      // YouTube maxresdefault.jpg 404 döndüyse hq720 veya hqdefault'a otomatik fallback yap
      if (imgRes.statusCode === 404 && currentUrl.includes('maxresdefault.jpg')) {
        imgRes.resume();
        const fallbackUrl = currentUrl.replace('maxresdefault.jpg', 'hq720.jpg');
        return fetchWithRedirects(fallbackUrl, redirectCount + 1);
      }
      if (imgRes.statusCode === 404 && currentUrl.includes('hq720.jpg')) {
        imgRes.resume();
        const fallbackUrl = currentUrl.replace('hq720.jpg', 'hqdefault.jpg');
        return fetchWithRedirects(fallbackUrl, redirectCount + 1);
      }

      if (imgRes.statusCode !== 200) {
        imgRes.resume();
        return res.status(500).send('Resim indirilemedi');
      }

      const contentType = imgRes.headers['content-type'] || 'image/jpeg';
      let ext = '.jpg';
      if (contentType.includes('webp')) ext = '.webp';
      else if (contentType.includes('png')) ext = '.png';

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(cleanBase)}${ext}"`);
      imgRes.pipe(res);
    }).on('error', () => {
      if (!res.headersSent) res.status(500).send('İndirme hatası');
    });
  };

  fetchWithRedirects(imageUrl.trim());
});

// ── API: Kuyruğa Ekle ──────────────────────────────────────
app.post('/api/queue/add', requireAuth, rateLimit(60 * 1000, 10, 'queue-add'), async (req, res) => {
  const { url, format_id, audio_only, title, thumbnail, platform,
          trim_start, trim_end, download_thumbnail, is_playlist, custom_name, playback_speed, stream_url } = req.body;

  if (!url || typeof url !== 'string') return res.status(400).json({ error: 'URL gerekli' });
  const trimmedUrl = url.trim();
  if (/[\r\n\0\t\x00-\x1f]/.test(url) || !/^https?:\/\//i.test(trimmedUrl)) return res.status(400).json({ error: 'Geçersiz URL' });

  // Dosyalar her zaman sunucunun indirme klasörüne kaydedilir
  fs.mkdirSync(getDownloadDir(), { recursive: true });

  const normalizedUrl = normalizeMediaUrl(trimmedUrl);
  let resolvedStreamUrl = (typeof stream_url === 'string' && /^https?:\/\//i.test(stream_url.trim()))
    ? stream_url.trim()
    : null;

  if (!resolvedStreamUrl && isKickUrl(normalizedUrl)) {
    try {
      const kickMeta = await resolveKickMedia(normalizedUrl);
      if (kickMeta && kickMeta.streamUrl) {
        resolvedStreamUrl = kickMeta.streamUrl;
      }
    } catch {}
  }

  const job = {
    id: Date.now().toString() + Math.random().toString(36).slice(2,6),
    status: 'waiting',
    url: normalizedUrl,
    stream_url: resolvedStreamUrl,
    format_id, audio_only: !!audio_only,
    title: title || 'Video', thumbnail, platform,
    custom_name: sanitizeFileStem(custom_name) || '',
    playback_speed: normalizePlaybackSpeed(playback_speed),
    trim_start: trim_start || '', trim_end: trim_end || '',
    download_thumbnail: !!download_thumbnail,
    is_playlist: !!is_playlist,
    progress: 0, speed: null, eta: null,
    filename: null, error: null, pid: null,
    addedAt: new Date().toISOString(), doneAt: null,
    _proc: null,
  };

  queue.push(job);
  processQueue();

  res.json({ id: job.id });
});

// ── API: Kuyruk Listesi ─────────────────────────────────────
app.get('/api/queue', requireAuth, (req, res) => {
  res.json(queue.map(({ _proc, ...j }) => j));
});

// ── API: Tamamlananları kuyruktan temizle ───────────────────
app.delete('/api/queue/done', requireAuth, (req, res) => {
  let removed = 0;
  for (let i = queue.length - 1; i >= 0; i--) {
    if (queue[i].status === 'done') {
      queue.splice(i, 1);
      removed++;
    }
  }
  res.json({ ok: true, removed });
});

// ── API: Duraklat ───────────────────────────────────────────
app.post('/api/queue/:id/pause', requireAuth, (req, res) => {
  const job = queue.find(j => j.id === req.params.id);
  if (!job) return res.status(404).json({ error: 'Bulunamadı' });
  if (job.status === 'downloading' && job.pid) {
    try { process.kill(job.pid, 'SIGSTOP'); } catch {}
    job.status = 'paused';
  }
  res.json({ ok: true });
});

// ── API: Devam Ettir ────────────────────────────────────────
app.post('/api/queue/:id/resume', requireAuth, (req, res) => {
  const job = queue.find(j => j.id === req.params.id);
  if (!job) return res.status(404).json({ error: 'Bulunamadı' });
  if (job.status === 'paused' && job.pid) {
    try { process.kill(job.pid, 'SIGCONT'); } catch {}
    job.status = 'downloading';
  }
  res.json({ ok: true });
});

// ── API: İptal / Sil ────────────────────────────────────────
app.delete('/api/queue/:id', requireAuth, (req, res) => {
  const idx = queue.findIndex(j => j.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Bulunamadı' });
  const job = queue[idx];
  if (job._proc) { try { job._proc.kill('SIGKILL'); } catch {} }
  job.status = 'cancelled';
  cleanupOrphanedJobFiles(job);
  queue.splice(idx, 1);
  processQueue();
  res.json({ ok: true });
});

// ── API: Dosya İndir (tarayıcıdan) ──────────────────────────
app.get('/api/download/:id', requireAuth, rateLimit(60 * 1000, 30, 'download'), (req, res) => {
  const job = findJobOrHistory(req.params.id);
  if (!job) return res.status(404).json({ error: 'Dosya bulunamadı' });

  let file = job.filename ? resolveFile(job.filename) : null;
  if (!file) {
    const dir = getDownloadDir();
    const stem = sanitizeFileStem(job.custom_name || job.title);
    if (stem) {
      for (const ext of ['.mp4', '.mkv', '.webm', '.mov', '.mp3', '.m4a']) {
        const candidate = path.join(dir, `${stem}${ext}`);
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          file = candidate;
          job.filename = candidate;
          break;
        }
      }
    }
  }

  if (!file) return res.status(404).json({ error: 'Dosya bulunamadı' });
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    return res.status(404).json({ error: 'Dosya sunucuda bulunmuyor' });
  }
  res.download(file, path.basename(file));
});

// ── API: Dosyayı yeniden adlandır ─────────────────────────
app.patch('/api/download/:id/name', requireAuth, (req, res) => {
  const job = findJobOrHistory(req.params.id);
  if (!job || !job.filename) return res.status(404).json({ error: 'Dosya bulunamadı' });

  const stem = sanitizeFileStem(req.body?.name);
  if (!stem) return res.status(400).json({ error: 'Geçerli bir dosya adı yazın' });

  const file = resolveFile(job.filename);
  if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    return res.status(404).json({ error: 'Dosya sunucuda bulunmuyor' });
  }

  const ext = path.extname(file) || (job.audio_only ? '.mp3' : '.mp4');
  const target = path.join(path.dirname(file), `${stem}${ext}`);
  if (path.resolve(target) !== path.resolve(file) && fs.existsSync(target)) {
    return res.status(409).json({ error: 'Bu isimde bir dosya zaten var' });
  }

  try {
    if (path.resolve(target) !== path.resolve(file)) {
      fs.renameSync(file, target);

      // İndirilmiş thumbnail varsa video ile birlikte yeniden adlandır.
      const oldBase = file.slice(0, file.length - path.extname(file).length);
      const newBase = target.slice(0, target.length - path.extname(target).length);
      for (const imageExt of ['.jpg', '.jpeg', '.png', '.webp']) {
        const oldThumb = oldBase + imageExt;
        const newThumb = newBase + imageExt;
        if (fs.existsSync(oldThumb) && !fs.existsSync(newThumb)) fs.renameSync(oldThumb, newThumb);
      }
    }

    job.filename = target;
    job.custom_name = stem;
    const h = readHistory().map(x => x.id === job.id
      ? { ...x, filename: target, custom_name: stem }
      : x);
    saveHistory(h);
    res.json({ ok: true, filename: target });
  } catch {
    res.status(500).json({ error: 'Dosya yeniden adlandırılamadı' });
  }
});

// ── API: Dosyayı Sunucudan Sil ──────────────────────────────
app.delete('/api/download/:id', requireAuth, (req, res) => {
  const job = findJobOrHistory(req.params.id);
  if (!job) return res.status(404).json({ error: 'Dosya bulunamadı' });

  let file = job.filename ? resolveFile(job.filename) : null;
  if (!file) {
    const dir = getDownloadDir();
    const stem = sanitizeFileStem(job.custom_name || job.title);
    if (stem) {
      for (const ext of ['.mp4', '.mkv', '.webm', '.mov', '.mp3', '.m4a']) {
        const candidate = path.join(dir, `${stem}${ext}`);
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          file = candidate;
          job.filename = candidate;
          break;
        }
      }
    }
  }

  if (!file) return res.status(404).json({ error: 'Dosya bulunamadı' });

  try {
    if (fs.existsSync(file)) fs.unlinkSync(file);
    // Ayrıca varsa thumbnail dosyasını da sil
    const base = file.replace(/\.[^.]+$/, '');
    for (const ext of ['.jpg', '.jpeg', '.png', '.webp']) {
      const f = base + ext;
      if (f !== file && fs.existsSync(f)) fs.unlinkSync(f);
    }
    job.filename = null;
    const h = readHistory().map(x => x.id === job.id ? { ...x, filename: null } : x);
    saveHistory(h);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Silinemedi' });
  }
});

// ── API: Geçmiş ─────────────────────────────────────────────
app.get('/api/history', requireAuth, (req, res) => res.json(readHistory()));

app.delete('/api/history', requireAuth, (req, res) => {
  saveHistory([]);
  res.json({ ok: true });
});

// ── Başlat ──────────────────────────────────────────────────
fs.mkdirSync(getDownloadDir(), { recursive: true });
app.listen(PORT, HOST, () => {
  console.log(`\n✅ Video İndirici çalışıyor: http://localhost:${PORT}`);
  console.log(`   Kayıt klasörü: ${getDownloadDir()}`);
  console.log(`   yt-dlp: ${YTDLP_PATH} | ffmpeg: ${FFMPEG_PATH} | ffprobe: ${FFPROBE_PATH}\n`);
  console.log(`   yt-dlp JS runtime: ${YTDLP_JS_RUNTIME || 'yok (yüksek kalite sınırlı olabilir)'}\n`);
});
