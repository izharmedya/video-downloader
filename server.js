const express = require('express');
const { spawn, execSync, execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');

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
const HOST = process.env.HOST || '0.0.0.0';
// İndirme klasörü çalışırken değiştirilebilir (uygulama içinden klasör seçilebilir).
let downloadDir = path.resolve(process.env.DOWNLOADS_DIR || path.join(__dirname, 'downloads'));
const HISTORY_FILE = path.join(downloadDir, 'history.json');
function getDownloadDir() { return downloadDir; }
const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT || '2', 10);
const DEFAULT_VIDEO_FORMAT = 'bestvideo+bestaudio[ext=m4a]/bestvideo+bestaudio/best';
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
// Format seçerken MP4/M4A ile sınırlamak, mevcut düşük çözünürlüklü MP4
// akışını seçip daha yüksek video akışlarını görmezden gelmesine neden olur.
function videoFormatForHeight(height) {
  const maxHeight = Number.isFinite(height) && height > 0 ? Math.round(height) : null;
  return maxHeight
    ? `bestvideo[height<=${maxHeight}]+bestaudio[ext=m4a]/bestvideo[height<=${maxHeight}]+bestaudio/best[height<=${maxHeight}]`
    : DEFAULT_VIDEO_FORMAT;
}

// ── Binary Yolları ─────────────────────────────────────────
// 1) env ile belirtilmişse onu kullan
// 2) macOS'ta eski kurulum yolunu dene
// 3) PATH'teki (yt-dlp/ffmpeg) ikili dosyaları kullan
function resolveBinary(envKey, fallbacks, legacyPath) {
  if (process.env[envKey]) return process.env[envKey];
  if (legacyPath && fs.existsSync(legacyPath)) return legacyPath;
  return fallbacks[0];
}
const YTDLP_PATH  = resolveBinary('YTDLP_PATH',  ['yt-dlp', 'ytdlp'], '/Users/izharmedya/.gemini/antigravity/bin/yt-dlp');
const FFMPEG_PATH = resolveBinary('FFMPEG_PATH', ['ffmpeg'], '/Users/izharmedya/.gemini/antigravity/bin/ffmpeg');

// ── Şifre / Oturum ─────────────────────────────────────────
// PASSWORD verilmediyse rastgele üretilir ve konsolda gösterilir.
const PASSWORD = process.env.PASSWORD || crypto.randomBytes(6).toString('hex');
const TOKENS = new Set([crypto.randomBytes(32).toString('hex')]);
const SESSION_DAYS = 7;

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(c => {
    const i = c.indexOf('=');
    if (i > -1) out[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim());
  });
  return out;
}

function requireAuth(req, res, next) {
  // IZ_LOCAL=1 (masaüstü uygulaması): sadece 127.0.0.1'e bağlı yerel kullanım — şifre istenmez
  if (process.env.IZ_LOCAL === '1') return next();
  if (TOKENS.has(parseCookies(req).vd_token)) return next();
  res.status(401).json({ error: 'Oturum gerekli' });
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

function spawnProcess(binaryPath, args) {
  const proc = spawn(binaryPath, args, {
    stdio: ['ignore', 'pipe', 'pipe']  // stdin kapalı — yt-dlp asılmasın
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
    doneAt: new Date().toISOString()
  });
  saveHistory(h.slice(0, 200));
}

// ── Sistem Bildirimi (platforma göre) ───────────────────────
function notify(title, msg) {
  try {
    if (process.platform === 'darwin') {
      execSync(`osascript -e 'display notification "${msg}" with title "${title}"'`);
    } else if (process.platform === 'linux') {
      execSync(`notify-send "${title}" "${msg}"`, { stdio: 'ignore' });
    }
  } catch {}
}

// ── Kuyruk İşleyici ─────────────────────────────────────────
function processQueue() {
  const active = queue.filter(j => j.status === 'downloading').length;
  const waiting = queue.filter(j => j.status === 'waiting');
  const slots = MAX_CONCURRENT - active;
  waiting.slice(0, slots).forEach(startJob);
}

function startJob(job) {
  job.status = 'downloading';
  job.progress = 0;

  const isAudio = job.audio_only === true;
  const customStem = sanitizeFileStem(job.custom_name);
  const outputTemplate = customStem
    ? path.join(getDownloadDir(), job.is_playlist
      ? `${customStem} - %(playlist_index)s - %(title)s.%(ext)s`
      : `${customStem}.%(ext)s`)
    : path.join(getDownloadDir(), '%(title)s.%(ext)s');

  let args = [
    '--no-warnings',
    '--no-check-certificates',
    '--geo-bypass',
    ...YTDLP_JS_ARGS,
    // Web istemcisi yüksek çözünürlükleri, mobil istemciler de erişilebilirliği sağlar.
    '--extractor-args', `youtube:player_client=${YOUTUBE_CLIENTS}`,
    '--ffmpeg-location', FFMPEG_PATH,
    '-o', outputTemplate,
    '--newline',
  ];

  // Playlist
  if (job.is_playlist) {
    args.push('--yes-playlist');
  } else {
    args.push('--no-playlist');
  }

  // Trim
  if (job.trim_start || job.trim_end) {
    const s = job.trim_start || '0';
    const e = job.trim_end   || '99:99:99';
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
    args.push('-x', '--audio-format', 'mp3', '--audio-quality', '0');
  } else {
    // Container yerine çözünürlüğü önceliklendiriyoruz. --merge-output-format
    // çıktıyı MP4 yapacağı için WebM/AV1 gibi yüksek kalite akışları da kullanılabilir.
    args.push('-f', job.format_id || DEFAULT_VIDEO_FORMAT);
    args.push('--merge-output-format', 'mp4');
  }

  args.push(job.url);

  const proc = spawnProcess(YTDLP_PATH, args);
  job.pid = proc.pid;

  proc.on('error', (err) => {
    if (job.status === 'cancelled') return;
    job.error = err.message || 'İndirme işlemi başlatılamadı.';
    job.status = 'error';
    processQueue();
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
  });

  proc.stderr.on('data', (data) => {
    const line = data.toString();
    if (!line.includes('WARNING')) job.error = [job.error, line.trim()].filter(Boolean).join('\n').slice(-4000);
  });

  proc.on('close', (code) => {
    if (job.status === 'cancelled' || job.status === 'error') return;

    // ECONNRESET / kesinti kurtarma kontrolü
    const fileExistsAndValid = job.filename && fs.existsSync(job.filename) && fs.statSync(job.filename).size > 1024 * 50;

    if (code === 0 || fileExistsAndValid) {
      job.status = 'done';
      job.progress = 100;
      job.doneAt = new Date().toISOString();
      addToHistory(job);
      notify('Video İndirici', `✅ ${job.title || 'Video'} indirildi!`);
    } else {
      job.status = 'error';
      notify('Video İndirici', `❌ ${job.title || 'Video'} indirilemedi.`);
    }
    processQueue();
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

// ── API: Giriş / Çıkış / Oturum ─────────────────────────────
app.post('/api/login', rateLimit(60 * 1000, 5, 'login'), (req, res) => {
  const { password } = req.body || {};
  const ok = typeof password === 'string' &&
    password.length === PASSWORD.length &&
    crypto.timingSafeEqual(Buffer.from(password), Buffer.from(PASSWORD));
  if (!ok) return res.status(401).json({ error: 'Yanlış şifre' });

  const token = [...TOKENS][0];
  res.setHeader('Set-Cookie', `vd_token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`);
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'vd_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/me', requireAuth, (req, res) => res.json({ ok: true }));

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

// ── API: Video Bilgisi ──────────────────────────────────────
app.post('/api/info', requireAuth, rateLimit(60 * 1000, 8, 'info'), (req, res) => {
  let { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL gerekli' });

  url = url.trim();
  if (!/^https?:\/\//i.test(url)) {
    url = 'https://' + url;
  }
  // Sadece http/https şemalarına izin ver (SSRF koruması)
  if (!/^https?:\/\//i.test(url)) {
    return res.status(400).json({ error: 'Geçersiz URL' });
  }

  const runYtDlp = (extraArgs = [], timeoutMs = 0) => {
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
      args.push(url);

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

    // Yavaşlığı önlemek için clientlar 2'li KÜÇÜK gruplar halinde denenir;
    // istek başına zaman aşımı vardır, takılması engellenir.
    const attempts = [
      ['--playlist-end', '1', '--extractor-args', 'youtube:player_client=web_embedded'],
      ['--playlist-end', '1', '--extractor-args', 'youtube:player_client=web_safari'],
      ['--playlist-end', '1', '--extractor-args', 'youtube:player_client=android_vr'],
      ['--playlist-end', '1', '--extractor-args', 'youtube:player_client=android'],
      ['--playlist-end', '1', '--extractor-args', 'youtube:player_client=ios'],
      ['--playlist-end', '1', '--extractor-args', 'youtube:player_client=web_creator'],
      ['--no-playlist', '--extractor-args', 'youtube:player_client=android,ios,web_embedded,web_creator,tv'],
    ];
    const CONCURRENCY = 1;         // paralel istek YouTube'u yavaşlatıyor; teker teker
    const ATTEMPT_TIMEOUT = 25000; // YouTube fetch'i ~15-18s sürebiliyor; bol süre
    const startTime = Date.now();
    const queue = attempts.slice();
    let active = 0, settled = false;
    let result = await new Promise((resolve) => {
      const spawnNext = () => {
        while (active < CONCURRENCY && queue.length && !settled) {
          const args = queue.shift();
          active++;
          runYtDlp(args, ATTEMPT_TIMEOUT).then(r => {
            active--;
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
    if (!result) result = { code: -1, out: '', err: 'Tüm clientlar başarısız.' };

    if (result.code !== 0 || !result.out.trim()) {
      console.error(`[/api/info HATA] ${result.err.slice(0, 400)}`);
      return res.status(400).json({
        error: isBotError(result)
          ? 'YouTube bu videoyu indirmeye izin vermiyor. Farklı bir link veya platform deneyin.'
          : 'Video bilgileri alınamadı. Geçerli ve erişilebilir bir link giriniz.',
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
        { format_id: 'bestaudio/best', label: '🎵 Sadece Ses (MP3)', ext: 'mp3', audio_only: true },
      ];

      // Extract thumbnail options
      let thumbnailList = [];
      if (Array.isArray(first?.thumbnails) && first.thumbnails.length > 0) {
        const sorted = [...first.thumbnails].filter(t => t && t.url).sort((a,b) => (b.height || b.width || 0) - (a.height || a.width || 0));
        const seen = new Set();
        sorted.forEach(t => {
          const resKey = t.width && t.height ? `${t.width}x${t.height}` : t.url;
          if (!seen.has(resKey)) {
            seen.add(resKey);
            let label = t.width && t.height ? `${t.width}x${t.height}` : 'Standart Kapak';
            if (thumbnailList.length === 0) label += ' (En Yüksek)';
            thumbnailList.push({
              url: t.url,
              resolution: t.width && t.height ? `${t.width}x${t.height}` : 'HD',
              label: label,
              width: t.width || null,
              height: t.height || null
            });
          }
        });
      }

      if (thumbnailList.length === 0 && first?.thumbnail) {
        thumbnailList.push({
          url: first.thumbnail,
          label: 'En Yüksek Kalite',
          resolution: 'HD'
        });
      }

      res.json({
        title:       first?.title || first?.playlist_title || 'Video',
        thumbnail:   first?.thumbnail || null,
        thumbnails:  thumbnailList,
        duration:    first?.duration  || null,
        uploader:    first?.uploader  || first?.channel || null,
        platform:    first?.extractor_key || 'Unknown',
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
  if (!imageUrl) return res.status(400).send('URL gerekli');
  if (!/^https?:\/\//i.test(imageUrl)) return res.status(400).send('Geçersiz URL');

  const httpModule = imageUrl.startsWith('https') ? require('https') : require('http');

  const fetchImage = (url) => {
    httpModule.get(url, (imgRes) => {
      if (imgRes.statusCode >= 300 && imgRes.statusCode < 400 && imgRes.headers.location) {
        return fetchImage(imgRes.headers.location);
      }
      if (imgRes.statusCode !== 200) {
        return res.status(500).send('Resim indirilemedi');
      }
      const cleanName = title.replace(/[^\w\s\u00C0-\u024F\u1E00-\u1EFF\u0400-\u04FF-]/gi, '_').trim().slice(0, 60) || 'kapak-resmi';
      res.setHeader('Content-Type', imgRes.headers['content-type'] || 'image/jpeg');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(cleanName)}.jpg"`);
      imgRes.pipe(res);
    }).on('error', () => {
      res.status(500).send('İndirme hatası');
    });
  };

  fetchImage(imageUrl);
});

// ── API: Kuyruğa Ekle ──────────────────────────────────────
app.post('/api/queue/add', requireAuth, rateLimit(60 * 1000, 10, 'queue-add'), (req, res) => {
  const { url, format_id, audio_only, title, thumbnail, platform,
          trim_start, trim_end, download_thumbnail, is_playlist, custom_name } = req.body;

  if (!url) return res.status(400).json({ error: 'URL gerekli' });
  if (!/^https?:\/\//i.test(url.trim())) return res.status(400).json({ error: 'Geçersiz URL' });

  // Dosyalar her zaman sunucunun indirme klasörüne kaydedilir
  fs.mkdirSync(getDownloadDir(), { recursive: true });

  const job = {
    id: Date.now().toString() + Math.random().toString(36).slice(2,6),
    status: 'waiting',
    url, format_id, audio_only: !!audio_only,
    title: title || 'Video', thumbnail, platform,
    custom_name: sanitizeFileStem(custom_name) || '',
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
  queue.splice(idx, 1);
  processQueue();
  res.json({ ok: true });
});

// ── API: Dosya İndir (tarayıcıdan) ──────────────────────────
app.get('/api/download/:id', requireAuth, rateLimit(60 * 1000, 30, 'download'), (req, res) => {
  const job = findJobOrHistory(req.params.id);
  if (!job || !job.filename) return res.status(404).json({ error: 'Dosya bulunamadı' });

  const file = resolveFile(job.filename);
  if (!file) return res.status(403).json({ error: 'Erişim reddedildi' });
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
    if (job._proc === undefined && job.doneAt) {
      const h = readHistory().map(x => x.id === job.id
        ? { ...x, filename: target, custom_name: stem }
        : x);
      saveHistory(h);
    }
    res.json({ ok: true, filename: target });
  } catch {
    res.status(500).json({ error: 'Dosya yeniden adlandırılamadı' });
  }
});

// ── API: Dosyayı Sunucudan Sil ──────────────────────────────
app.delete('/api/download/:id', requireAuth, (req, res) => {
  const job = findJobOrHistory(req.params.id);
  if (!job || !job.filename) return res.status(404).json({ error: 'Dosya bulunamadı' });

  const file = resolveFile(job.filename);
  if (!file) return res.status(403).json({ error: 'Erişim reddedildi' });

  try {
    if (fs.existsSync(file)) fs.unlinkSync(file);
    // Ayrıca varsa thumbnail dosyasını da sil
    const base = file.replace(/\.[^.]+$/, '');
    for (const ext of ['.jpg', '.jpeg', '.png', '.webp']) {
      const f = base + ext;
      if (f !== file && fs.existsSync(f)) fs.unlinkSync(f);
    }
    job.filename = null;
    if (job._proc === undefined && job.doneAt) {
      // history kaydını da güncelle
      const h = readHistory().map(x => x.id === job.id ? { ...x, filename: null } : x);
      saveHistory(h);
    }
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
  console.log(`   Şifre: ${PASSWORD}`);
  console.log(`   Kayıt klasörü: ${getDownloadDir()}`);
  console.log(`   yt-dlp: ${YTDLP_PATH} | ffmpeg: ${FFMPEG_PATH}\n`);
  console.log(`   yt-dlp JS runtime: ${YTDLP_JS_RUNTIME || 'yok (yüksek kalite sınırlı olabilir)'}\n`);
  if (!process.env.PASSWORD) {
    console.log(`⚠️  PASSWORD ortam değişkeni tanımlanmadı. Yukarıdaki rastgele şifreyi kullanın.\n`);
  }
});
