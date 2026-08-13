// ── Durum ────────────────────────────────────────────────
let selectedFormat = null;
let videoInfo = null;
let pollTimer = null;

// ── API İsteği (401 → giriş ekranı) ──────────────────────
async function api(path, opts = {}) {
  const res = await fetch(path, opts);
  if (res.status === 401) {
    showLogin();
    throw new Error('Oturum gerekli');
  }
  return res;
}

// ── Giriş / Çıkış ────────────────────────────────────────
function showLogin() {
  document.getElementById('login-overlay').classList.remove('hidden');
}
function hideLogin() {
  document.getElementById('login-overlay').classList.add('hidden');
  document.getElementById('login-error').classList.add('hidden');
  document.getElementById('btn-logout').classList.remove('hidden');
}

async function login() {
  const password = document.getElementById('login-password').value;
  const btn = document.getElementById('btn-login');
  btn.disabled = true;
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    if (res.ok) {
      document.getElementById('login-password').value = '';
      hideLogin();
    } else {
      document.getElementById('login-error').classList.remove('hidden');
    }
  } catch {
    document.getElementById('login-error').textContent = 'Sunucuya bağlanılamadı.';
    document.getElementById('login-error').classList.remove('hidden');
  } finally {
    btn.disabled = false;
  }
}

async function logout() {
  await fetch('/api/logout', { method: 'POST' });
  showLogin();
}

// ── Durum Metinleri ───────────────────────────────────────
function updateFetchStatus(text) {
  const el = document.getElementById('fetch-status-text');
  if (el) el.textContent = text;
}
function updateFetchThumbStatus(text) {
  const el = document.getElementById('fetch-status-text-thumb');
  if (el) el.textContent = text;
}

// ── Sekme Değiştir ───────────────────────────────────────
// DÜZELTME: hidden class kullanmak yerine doğrudan data-tab attribute ile kontrol
function switchTab(name) {
  // Sidebar butonları
  document.querySelectorAll('.sidebar-tab').forEach(t => t.classList.remove('active'));
  document.getElementById(`tab-${name}`).classList.add('active');

  // Sekmeler — hidden yerine data-active attribute kullan
  document.querySelectorAll('.tab-content').forEach(s => {
    s.style.display = 'none';
  });
  const section = document.getElementById(`section-${name}`);
  // Her sekmenin doğru display tipi
  if (name === 'indir' || name === 'thumbnail') {
    section.style.display = 'flex';
  } else {
    section.style.display = 'block';
  }

  if (name === 'kuyruk') renderQueue();
  if (name === 'gecmis') renderHistory();
}

// ── Varsayılan Yol (gösterim amaçlı) ─────────────────────
async function loadDefaultPath() {
  try {
    const r = await api('/api/default-path');
    const d = await r.json();
    document.getElementById('save-path').value = d.path;
  } catch {}
}

// ── Klasör Seç (native) ──────────────────────────────────
async function chooseDownloadDir() {
  if (!window.izhar) return alert('Klasör seçme sadece masaüstü uygulamasında çalışır.');
  const p = await window.izhar.chooseFolder();
  if (!p) return;
  try {
    const res = await api('/api/download-dir', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: p })
    });
    const d = await res.json();
    if (!res.ok) return alert(d.error || 'Klasör ayarlanamadı.');
    document.getElementById('save-path').value = d.path;
  } catch {
    alert('Sunucuya bağlanılamadı.');
  }
}

function openDownloadDir() {
  const p = document.getElementById('save-path').value;
  if (window.izhar && p) window.izhar.openFolder(p);
  else if (p) alert(p);
}

// ── Finder'da göster ─────────────────────────────────────
function showDownloaded(filename) {
  if (!filename) return;
  if (window.izhar) window.izhar.showInFolder(filename);
  else alert(filename);
}

// ── Video Bilgisi Al ──────────────────────────────────────
async function fetchInfo() {
  const url = document.getElementById('url-input').value.trim();
  if (!url) return alert('Lütfen bir link girin.');

  const fetchBtn = document.getElementById('btn-fetch');
  if (fetchBtn) fetchBtn.disabled = true;

  updateFetchStatus('Link taranıyor ve formatlar çözümleniyor...');
  showInfoCard('loading');

  try {
    const res = await api('/api/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    const data = await res.json();
    if (!res.ok) {
      const errTxt = data.detail ? `${data.error}\n(${data.detail})` : data.error;
      showInfoCard('error', errTxt);
      if (fetchBtn) fetchBtn.disabled = false;
      return;
    }
    videoInfo = data;
    renderInfo(data);
    showInfoCard('info');
    if (fetchBtn) fetchBtn.disabled = false;
  } catch (e) {
    showInfoCard('error', 'Sunucuya bağlanılamadı.');
    if (fetchBtn) fetchBtn.disabled = false;
  }
}

function renderInfo(d) {
  // Thumbnail
  const img = document.getElementById('thumb');
  img.src = d.thumbnail || '';
  img.style.display = d.thumbnail ? 'block' : 'none';

  document.getElementById('info-title').textContent    = d.title    || 'Video';
  document.getElementById('info-uploader').textContent = d.uploader ? `📺 ${d.uploader}` : '';
  document.getElementById('info-platform').textContent = d.platform ? `🌐 ${d.platform}` : '';
  document.getElementById('filename-input').value = '';

  // Playlist
  const rowPl  = document.getElementById('row-playlist');
  const badgePl= document.getElementById('badge-playlist');
  if (d.is_playlist) {
    rowPl.classList.remove('hidden');
    badgePl.classList.remove('hidden');
    badgePl.textContent = `📋 Playlist · ${d.playlist_count || '?'} video`;
  } else {
    rowPl.classList.add('hidden');
    badgePl.classList.add('hidden');
  }

  // Formatlar
  const list = document.getElementById('format-list');
  list.innerHTML = '';
  selectedFormat = null;
  (d.formats || []).forEach((fmt, i) => {
    const btn = document.createElement('button');
    btn.className = 'fmt-btn';
    btn.textContent = fmt.label;
    btn.onclick = () => {
      list.querySelectorAll('.fmt-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedFormat = fmt;
    };
    list.appendChild(btn);
    if (i === 0) btn.click();
  });
}

// ── Kuyruğa Ekle ─────────────────────────────────────────
async function addToQueue() {
  if (!videoInfo || !selectedFormat) return alert('Önce video bilgisi alın.');

  const btn = document.getElementById('btn-add');
  btn.disabled = true;
  btn.textContent = 'Ekleniyor...';

  try {
    const res = await api('/api/queue/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url:               document.getElementById('url-input').value.trim(),
        format_id:         selectedFormat.format_id,
        audio_only:        selectedFormat.audio_only === true,
        title:             videoInfo.title,
        thumbnail:         videoInfo.thumbnail,
        platform:          videoInfo.platform,
        trim_start:        document.getElementById('trim-start').value.trim(),
        trim_end:          document.getElementById('trim-end').value.trim(),
        download_thumbnail:document.getElementById('chk-thumbnail').checked,
        is_playlist:       videoInfo.is_playlist && document.getElementById('chk-playlist').checked,
        custom_name:       document.getElementById('filename-input').value.trim(),
      })
    });
    const data = await res.json();
    if (!res.ok) { alert(data.error); return; }

    switchTab('kuyruk');
    resetInfo();
  } catch (e) {
    alert('Sunucuya bağlanılamadı.');
  } finally {
    btn.disabled = false;
    btn.textContent = '➕ Kuyruğa Ekle';
  }
}

// ── Kuyruk Render ─────────────────────────────────────────
function statusLabel(s) {
  const labels = {
    waiting:    '⏳ Bekliyor',
    downloading:'⬇ İndiriliyor',
    paused:     '⏸ Duraklatıldı',
    done:       '✅ Tamamlandı',
    error:      '❌ Hata',
    cancelled:  '🚫 İptal',
  };
  return labels[s] || s;
}

async function renderQueue() {
  try {
    const res = await api('/api/queue');
    const items = await res.json();

    // Badge
    const active = items.filter(j => ['waiting','downloading','paused'].includes(j.status)).length;
    const badge = document.getElementById('badge-kuyruk');
    if (active > 0) { badge.textContent = active; badge.classList.remove('hidden'); }
    else badge.classList.add('hidden');

    const el = document.getElementById('queue-list');
    if (items.length === 0) {
      el.innerHTML = '<p class="empty-msg">Kuyruk boş.<br>İndir sekmesinden ekleyin.</p>';
      return;
    }

    el.innerHTML = items.map(j => {
      const pct = j.progress?.toFixed(1) || '0.0';
      const showProgress = ['downloading','paused'].includes(j.status);
      const canPause  = j.status === 'downloading';
      const canResume = j.status === 'paused';
      const canCancel = ['waiting','downloading','paused'].includes(j.status);
      const isDone    = j.status === 'done';
      const displayName = j.custom_name || j.title;

      return `
      <div class="q-item ${j.status}" id="qitem-${j.id}">
        <div class="q-top">
          ${j.thumbnail ? `<img class="q-thumb" src="${j.thumbnail}" alt="">` : '<div class="q-thumb"></div>'}
          <div class="q-info">
            <div class="q-title" title="${esc(displayName)}">${esc(displayName)}</div>
            <div class="q-sub">${j.platform || ''} · ${j.audio_only ? 'MP3' : 'MP4'}
              ${j.trim_start || j.trim_end ? ' · ✂️ Kırpılıyor' : ''}
              ${j.download_thumbnail ? ' · 🖼' : ''}
              ${j.is_playlist ? ' · 📋 Playlist' : ''}
            </div>
          </div>
          <span class="q-status ${j.status}">${statusLabel(j.status)}</span>
        </div>

        ${showProgress ? `
        <div class="q-progress">
          <div class="prog-bar-bg"><div class="prog-bar-fill" style="width:${pct}%"></div></div>
          <div class="q-prog-info">
            <span>%${pct}</span>
            <span>${j.speed ? j.speed : ''}${j.eta ? ' · ETA ' + j.eta : ''}</span>
          </div>
        </div>` : ''}

        ${j.status === 'done' && j.filename ? `
        <div class="q-prog-info" style="margin-top:8px">
          <span style="font-size:.75rem;color:var(--text3);word-break:break-all">📁 ${esc(j.filename)}</span>
        </div>` : ''}

        ${j.status === 'error' ? `
        <div style="margin-top:8px;font-size:.75rem;color:var(--danger)">${esc(j.error || 'Bilinmeyen hata')}</div>` : ''}

        <div class="q-actions">
          ${canPause  ? `<button class="btn-secondary btn-sm" onclick="qPause('${j.id}')">⏸ Duraklat</button>` : ''}
          ${canResume ? `<button class="btn-secondary btn-sm" onclick="qResume('${j.id}')">▶ Devam</button>` : ''}
          ${isDone && j.filename ? `<a class="btn-secondary btn-sm" href="/api/download/${j.id}">⬇ İndir</a>` : ''}
          ${isDone && j.filename ? `<button class="btn-secondary btn-sm" onclick="showDownloaded(unb64('${b64(j.filename)}'))" title="Finder'da göster">📂</button>` : ''}
          ${isDone && j.filename ? `<button class="btn-secondary btn-sm" onclick="renameDownload('${j.id}')" title="Yeniden adlandır">✏️</button>` : ''}
          ${isDone && j.filename ? `<button class="btn-danger btn-sm" onclick="qDeleteFile('${j.id}')">🗑 Sil</button>` : ''}
          ${canCancel ? `<button class="btn-danger btn-sm" onclick="qCancel('${j.id}')">❌ İptal</button>` : ''}
        </div>
      </div>`;
    }).join('');
  } catch {}
}

async function qPause(id) {
  await api(`/api/queue/${id}/pause`, { method: 'POST' });
  renderQueue();
}
async function qResume(id) {
  await api(`/api/queue/${id}/resume`, { method: 'POST' });
  renderQueue();
}
async function qCancel(id) {
  if (!confirm('İndirme iptal edilsin mi?')) return;
  await api(`/api/queue/${id}`, { method: 'DELETE' });
  renderQueue();
}
async function qDeleteFile(id) {
  if (!confirm('Dosya sunucudan silinsin mi?')) return;
  await api(`/api/download/${id}`, { method: 'DELETE' });
  renderQueue();
}
async function renameDownload(id) {
  const name = prompt('Yeni dosya adı:', '');
  if (name === null) return;
  const res = await api(`/api/download/${id}/name`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name.trim() })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return alert(data.error || 'Dosya yeniden adlandırılamadı.');
  renderQueue();
  renderHistory();
}
async function clearDone() {
  await api('/api/queue/done', { method: 'DELETE' });
  renderQueue();
}

// ── Geçmiş Render ─────────────────────────────────────────
async function renderHistory() {
  try {
    const res = await api('/api/history');
    const items = await res.json();
    const el = document.getElementById('history-list');
    if (items.length === 0) {
      el.innerHTML = '<p class="empty-msg">Henüz indirme yapılmadı.</p>';
      return;
    }
    el.innerHTML = items.map(h => {
      const date = new Date(h.doneAt).toLocaleString('tr-TR');
      const displayName = h.custom_name || h.title;
      return `
      <div class="h-item">
        ${h.thumbnail ? `<img class="h-thumb" src="${h.thumbnail}" alt="">` : '<div class="h-thumb"></div>'}
        <div class="h-info">
          <div class="h-title" title="${esc(displayName)}">${esc(displayName)}</div>
          <div class="h-sub">${h.platform || ''} · ${date}</div>
        </div>
        <div class="h-actions">
          ${h.filename ? `<a class="btn-secondary btn-sm" href="/api/download/${h.id}">⬇ İndir</a>` : ''}
          ${h.filename ? `<button class="btn-secondary btn-sm" onclick="showDownloaded(unb64('${b64(h.filename)}'))" title="Finder'da göster">📂</button>` : ''}
          ${h.filename ? `<button class="btn-secondary btn-sm" onclick="renameDownload('${h.id}')" title="Yeniden adlandır">✏️</button>` : ''}
          ${h.filename ? `<button class="btn-danger btn-sm" onclick="hDeleteFile('${h.id}')">🗑 Sil</button>` : ''}
        </div>
      </div>`;
    }).join('');
  } catch {}
}

async function hDeleteFile(id) {
  if (!confirm('Dosya sunucudan silinsin mi?')) return;
  await api(`/api/download/${id}`, { method: 'DELETE' });
  renderHistory();
}

async function clearHistory() {
  if (!confirm('Tüm geçmiş silinsin mi?')) return;
  await api('/api/history', { method: 'DELETE' });
  renderHistory();
}

// ── Yardımcı ─────────────────────────────────────────────
function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
// UTF-8 güvenli base64 — dosya yolunu onclick içine güvenli gömmek için
function b64(s) { return btoa(unescape(encodeURIComponent(s || ''))); }
function unb64(s) { return decodeURIComponent(escape(atob(s))); }

// ── showInfoCard — card-loading/error/info göster/gizle ──
function showInfoCard(name, msg) {
  document.getElementById('card-loading').style.display = 'none';
  document.getElementById('card-error').style.display   = 'none';
  document.getElementById('card-info').style.display    = 'none';

  if (name === 'loading') document.getElementById('card-loading').style.display = 'block';
  if (name === 'error')   document.getElementById('card-error').style.display   = 'flex';
  if (name === 'info')    document.getElementById('card-info').style.display    = 'block';

  if (msg) document.getElementById('error-msg').textContent = '❌ ' + msg;
}

function resetInfo() {
  videoInfo = null; selectedFormat = null;
  document.getElementById('url-input').value = '';
  document.getElementById('filename-input').value = '';
  document.getElementById('trim-start').value = '';
  document.getElementById('trim-end').value = '';
  document.getElementById('chk-thumbnail').checked = false;
  document.getElementById('chk-playlist').checked = true;
  showInfoCard(null);
}

// ── Otomatik Polling ──────────────────────────────────────
function startPolling() {
  pollTimer = setInterval(() => {
    // Kuyruk sekmesi açıksa güncelle
    const kuyrukSection = document.getElementById('section-kuyruk');
    if (kuyrukSection && kuyrukSection.style.display === 'block') {
      renderQueue();
    }
    // Badge her zaman güncelle
    api('/api/queue').then(r => r.json()).then(items => {
      const active = items.filter(j => ['waiting','downloading','paused'].includes(j.status)).length;
      const badge = document.getElementById('badge-kuyruk');
      if (active > 0) { badge.textContent = active; badge.classList.remove('hidden'); }
      else badge.classList.add('hidden');
    }).catch(() => {});
  }, 1000);
}

// ── Kırpma Saat Maskesi (Otomatik :) ──────────────────────
function setupTrimInputs() {
  const formatInput = (input) => {
    input.addEventListener('input', (e) => {
      const isDelete = e.inputType && e.inputType.startsWith('delete');
      let digits = input.value.replace(/\D/g, '').slice(0, 6);

      if (isDelete && digits.length === 0) {
        input.value = '';
        return;
      }

      let formatted = '';
      if (digits.length > 4) {
        formatted = `${digits.slice(0, 2)}:${digits.slice(2, 4)}:${digits.slice(4)}`;
      } else if (digits.length > 2) {
        formatted = `${digits.slice(0, 2)}:${digits.slice(2)}`;
        if (digits.length === 4 && !isDelete) formatted += ':';
      } else if (digits.length > 0) {
        formatted = digits;
        if (digits.length === 2 && !isDelete) formatted += ':';
      }

      input.value = formatted;
    });
  };

  const startInp = document.getElementById('trim-start');
  const endInp   = document.getElementById('trim-end');
  if (startInp) formatInput(startInp);
  if (endInp)   formatInput(endInp);
}

// ── Thumbnail İndirme Durumu ──────────────────────────────
let selectedThumbnailUrl = null;
let thumbVideoInfo = null;

let _fetchThumbTimer = null;
let _fetchThumbVal   = 0;

function _fetchThumbBarSet(v) {
  const bar = document.getElementById('fetch-bar-thumb');
  const txt = document.getElementById('fetch-pct-text-thumb');
  if (bar) bar.style.width = v.toFixed(1) + '%';
  if (txt) txt.textContent = Math.round(v) + '%';
}

function _fetchThumbBarStart() {
  _fetchThumbVal = 0;
  _fetchThumbBarSet(0);
  clearInterval(_fetchThumbTimer);
  _fetchThumbTimer = setInterval(() => {
    _fetchThumbVal += (85 - _fetchThumbVal) * 0.045;
    _fetchThumbBarSet(_fetchThumbVal);
  }, 60);
}

function _fetchThumbBarDone(cb) {
  clearInterval(_fetchThumbTimer);
  _fetchThumbBarSet(100);
  setTimeout(cb, 300);
}

function showThumbCard(name, msg) {
  document.getElementById('card-loading-thumb').style.display = 'none';
  document.getElementById('card-error-thumb').style.display   = 'none';
  document.getElementById('card-thumb-result').style.display  = 'none';

  if (name === 'loading') document.getElementById('card-loading-thumb').style.display = 'block';
  if (name === 'error')   document.getElementById('card-error-thumb').style.display   = 'flex';
  if (name === 'info')    document.getElementById('card-thumb-result').style.display  = 'block';

  if (msg) document.getElementById('error-msg-thumb').textContent = '❌ ' + msg;
}

function resetThumbnailInfo() {
  thumbVideoInfo = null; selectedThumbnailUrl = null;
  document.getElementById('thumb-url-input').value = '';
  showThumbCard(null);
}

async function fetchThumbnailInfo() {
  const url = document.getElementById('thumb-url-input').value.trim();
  if (!url) return alert('Lütfen bir video linki girin.');

  const fetchBtn = document.getElementById('btn-fetch-thumb');
  if (fetchBtn) fetchBtn.disabled = true;

  updateFetchThumbStatus('Kapak resmi ve yüksek çözünürlükler taranıyor...');
  showThumbCard('loading');

  try {
    const res = await api('/api/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    const data = await res.json();
    if (!res.ok) {
      showThumbCard('error', data.error);
      if (fetchBtn) fetchBtn.disabled = false;
      return;
    }
    thumbVideoInfo = data;
    renderThumbnailInfo(data);
    showThumbCard('info');
    if (fetchBtn) fetchBtn.disabled = false;
  } catch (e) {
    showThumbCard('error', 'Sunucuya bağlanılamadı.');
    if (fetchBtn) fetchBtn.disabled = false;
  }
}

function renderThumbnailInfo(d) {
  document.getElementById('thumb-info-title').textContent    = d.title    || 'Video Kapak Resmi';
  document.getElementById('thumb-info-uploader').textContent = d.uploader ? `📺 ${d.uploader}` : '';
  document.getElementById('thumb-info-platform').textContent = d.platform ? `🌐 ${d.platform}` : '';

  const list = document.getElementById('thumb-format-list');
  list.innerHTML = '';
  selectedThumbnailUrl = null;

  const thumbs = (d.thumbnails && d.thumbnails.length > 0) ? d.thumbnails : [
    { url: d.thumbnail, label: 'En Yüksek Kalite', resolution: 'HD' }
  ];

  thumbs.forEach((t, i) => {
    if (!t || !t.url) return;
    const btn = document.createElement('button');
    btn.className = 'fmt-btn';
    btn.textContent = t.label || t.resolution || 'Kapak';
    btn.onclick = () => {
      document.querySelectorAll('#thumb-format-list .fmt-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedThumbnailUrl = t.url;
      document.getElementById('thumb-large-preview').src = t.url;
    };
    list.appendChild(btn);
    if (i === 0) btn.click();
  });
}

function downloadSelectedThumbnail() {
  if (!selectedThumbnailUrl) return alert('Lütfen bir kapak seçin.');
  const title = thumbVideoInfo?.title || 'kapak-resmi';
  const downloadUrl = `/api/download-thumbnail-file?url=${encodeURIComponent(selectedThumbnailUrl)}&title=${encodeURIComponent(title)}`;

  const a = document.createElement('a');
  a.href = downloadUrl;
  a.download = `${title}.jpg`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// ── Enter tuşu & Yükleme ─────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Önce oturum kontrolü — 401 ise giriş ekranı göster
  api('/api/me')
    .then(() => {
      hideLogin();
      boot();
    })
    .catch(() => {
      showLogin();
      boot();
    });
});

function boot() {
  loadDefaultPath();
  startPolling();
  setupTrimInputs();

  const mainUrlInp = document.getElementById('url-input');
  if (mainUrlInp) {
    mainUrlInp.addEventListener('keydown', e => {
      if (e.key === 'Enter') fetchInfo();
    });
  }

  const thumbUrlInp = document.getElementById('thumb-url-input');
  if (thumbUrlInp) {
    thumbUrlInp.addEventListener('keydown', e => {
      if (e.key === 'Enter') fetchThumbnailInfo();
    });
  }

  const loginInp = document.getElementById('login-password');
  if (loginInp) {
    loginInp.addEventListener('keydown', e => {
      if (e.key === 'Enter') login();
    });
  }

  // İlk yüklemede indir sekmesini doğru şekilde göster
  switchTab('indir');
}
