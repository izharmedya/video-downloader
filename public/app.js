// ── Durum ────────────────────────────────────────────────
let selectedFormat = null;
let videoInfo = null;
let pollTimer = null;
let lastQueue = [];

// ── API İsteği ──────────────────────────────────────────────
async function api(path, opts = {}) {
  const res = await fetch(path, opts);
  if (res.status === 401) {
    showLogin();
    throw new Error('Oturum gerekli');
  }
  return res;
}

// ── Bildirim Toast Sistemi (beUI Animated Toast Stack) ─────
function showToast(msg, type = 'info', duration = 3500) {
  const container = document.getElementById('toast-container');
  if (!container) {
    console.log(`[Toast ${type}]: ${msg}`);
    return;
  }
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const iconMap = {
    info: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
    success: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="16 10 10 16 7 13"/></svg>`,
    error: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
    warning: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`
  };
  const icon = iconMap[type] || iconMap.info;

  toast.innerHTML = `<span style="display:inline-flex;align-items:center;flex-shrink:0">${icon}</span><span>${esc(msg)}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast-hide');
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 250);
  }, duration);
}

// ── Giriş / Çıkış (Girişsiz açık kullanım) ───────────────────
function showLogin() {
  stopPolling();
  const overlay = document.getElementById('login-overlay');
  if (overlay) overlay.classList.remove('hidden');
}
function hideLogin() {
  const overlay = document.getElementById('login-overlay');
  if (overlay) overlay.classList.add('hidden');
  const err = document.getElementById('login-error');
  if (err) err.classList.add('hidden');
  startPolling();
}
async function login() {}
async function logout() {
  stopPolling();
  try {
    await fetch('/api/logout', { method: 'POST' });
  } catch {}
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

// ── Analiz Süreci Yüzde Animasyonları ─────────────────────
let _fetchTimer = null;
let _fetchVal   = 0;

function _fetchBarSet(v) {
  const bar = document.getElementById('fetch-bar');
  const txt = document.getElementById('fetch-pct-text');
  if (bar) bar.style.width = v.toFixed(1) + '%';
  if (txt) txt.textContent = Math.round(v) + '%';
}

function _fetchBarStart() {
  _fetchVal = 0;
  _fetchBarSet(0);
  clearInterval(_fetchTimer);
  _fetchTimer = setInterval(() => {
    _fetchVal += (90 - _fetchVal) * 0.05;
    _fetchBarSet(_fetchVal);
  }, 60);
}

function _fetchBarDone(cb) {
  clearInterval(_fetchTimer);
  _fetchBarSet(100);
  setTimeout(() => {
    if (typeof cb === 'function') cb();
  }, 200);
}

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
    _fetchThumbVal += (90 - _fetchThumbVal) * 0.05;
    _fetchThumbBarSet(_fetchThumbVal);
  }, 60);
}

function _fetchThumbBarDone(cb) {
  clearInterval(_fetchThumbTimer);
  _fetchThumbBarSet(100);
  setTimeout(() => {
    if (typeof cb === 'function') cb();
  }, 200);
}

// ── Sekme Değiştir (beUI Gliding Indicator) ────────────────
function switchTab(name) {
  // Sidebar butonları
  document.querySelectorAll('.sidebar-tab').forEach(t => {
    t.classList.remove('active');
    t.setAttribute('aria-selected', 'false');
  });
  const tabBtn = document.getElementById(`tab-${name}`);
  if (tabBtn) {
    tabBtn.classList.add('active');
    tabBtn.setAttribute('aria-selected', 'true');

    // Sidebar Glider Pozisyonu
    const glider = document.getElementById('sidebar-glider');
    if (glider && tabBtn.parentElement) {
      glider.style.top = `${tabBtn.offsetTop}px`;
      glider.style.height = `${tabBtn.offsetHeight}px`;
      glider.style.opacity = '1';
    }
  }

  // Sekmeler
  document.querySelectorAll('.tab-content').forEach(s => {
    s.style.display = 'none';
  });
  const section = document.getElementById(`section-${name}`);
  if (section) {
    if (name === 'indir' || name === 'thumbnail') {
      section.style.display = 'flex';
    } else {
      section.style.display = 'block';
    }
  }

  if (name === 'kuyruk') renderQueue();
  if (name === 'gecmis') renderHistory();
}

// ── Varsayılan Yol ────────────────────────────────────────
async function loadDefaultPath() {
  try {
    const r = await api('/api/default-path');
    const d = await r.json();
    const saveInp = document.getElementById('save-path');
    if (saveInp && d.path) saveInp.value = d.path;
  } catch {}
}

// ── Klasör Seç (native + web fallback) ────────────────────
async function chooseDownloadDir() {
  if (window.izhar && window.izhar.chooseFolder) {
    const p = await window.izhar.chooseFolder();
    if (!p) return;
    try {
      const res = await api('/api/download-dir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: p })
      });
      const d = await res.json();
      if (!res.ok) return showToast(d.error || 'Klasör ayarlanamadı.', 'error');
      document.getElementById('save-path').value = d.path;
      showToast('Kayıt klasörü güncellendi.', 'success');
    } catch {
      showToast('Sunucuya bağlanılamadı.', 'error');
    }
    return;
  }
  // Tarayıcı fallback
  try {
    const res = await api('/api/pick-folder');
    if (res.status === 204) return;
    const d = await res.json();
    if (d && d.path) {
      document.getElementById('save-path').value = d.path;
      showToast('Kayıt klasörü güncellendi.', 'success');
    }
  } catch {
    showToast('Klasör seçici açılamadı.', 'error');
  }
}

function openDownloadDir() {
  const p = document.getElementById('save-path').value;
  if (window.izhar && p) {
    window.izhar.openFolder(p);
  } else if (p) {
    api('/api/open-dir', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: p })
    }).catch(() => {
      showToast('Klasör açılamadı.', 'error');
    });
  }
}

// ── Finder'da göster ─────────────────────────────────────
function showDownloaded(filename) {
  if (!filename) return;
  if (window.izhar && window.izhar.showInFolder) {
    window.izhar.showInFolder(filename);
  } else {
    api('/api/show-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: filename })
    }).catch(() => {
      showToast('Dosya konumu gösterilemedi.', 'error');
    });
  }
}

// ── Video Bilgisi Al ──────────────────────────────────────
async function fetchInfo() {
  const urlInput = document.getElementById('url-input');
  const url = urlInput ? urlInput.value.trim() : '';
  if (!url) return showToast('Lütfen bir video veya ses bağlantısı girin.', 'warning');

  const fetchBtn = document.getElementById('btn-fetch');
  if (fetchBtn) fetchBtn.disabled = true;

  updateFetchStatus('Link taranıyor ve medya akışları çözümleniyor...');
  _fetchBarStart();
  showInfoCard('loading');

  try {
    const res = await api('/api/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    const data = await res.json();
    if (!res.ok) {
      _fetchBarDone();
      const errTxt = data.detail ? `${data.error}\n(${data.detail})` : data.error;
      showInfoCard('error', errTxt || 'Video bilgisi alınamadı.');
      return;
    }
    _fetchBarDone(() => {
      videoInfo = data;
      renderInfo(data);
      showInfoCard('info');
    });
  } catch (e) {
    _fetchBarDone();
    showInfoCard('error', 'Sunucuya bağlanılamadı.');
  } finally {
    if (fetchBtn) fetchBtn.disabled = false;
  }
}

function renderInfo(d) {
  // Thumbnail
  const img = document.getElementById('thumb');
  if (img) {
    img.onerror = () => { img.style.display = 'none'; };
    img.src = d.thumbnail || '';
    img.style.display = d.thumbnail ? 'block' : 'none';
  }

  const titleEl = document.getElementById('info-title');
  if (titleEl) titleEl.textContent = d.title || 'Video';
  const uploaderEl = document.getElementById('info-uploader');
  if (uploaderEl) uploaderEl.textContent = d.uploader ? `${d.uploader}` : '';
  const platEl = document.getElementById('info-platform');
  if (platEl) platEl.textContent = d.platform ? `${d.platform}` : '';
  const nameInput = document.getElementById('filename-input');
  if (nameInput) nameInput.value = '';

  // Playlist
  const rowPl   = document.getElementById('row-playlist');
  const badgePl = document.getElementById('badge-playlist');
  if (d.is_playlist) {
    if (rowPl) rowPl.classList.remove('hidden');
    if (badgePl) {
      badgePl.classList.remove('hidden');
      badgePl.textContent = `Playlist · ${d.playlist_count || '?'} video`;
    }
  } else {
    if (rowPl) rowPl.classList.add('hidden');
    if (badgePl) badgePl.classList.add('hidden');
  }

  // Formatlar
  const list = document.getElementById('format-list');
  if (!list) return;
  list.innerHTML = '';
  selectedFormat = null;

  (d.formats || []).forEach((fmt, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'fmt-btn';
    btn.textContent = fmt.label;
    if (fmt.height >= 2160 || (fmt.label && fmt.label.includes('4K'))) {
      btn.title = '4K Ultra HD (2160p) - Adobe Premiere Pro uyumlu H.264/AAC';
      btn.classList.add('fmt-is-4k');
    }
    btn.onclick = () => {
      list.querySelectorAll('.fmt-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedFormat = fmt;
      updateFormatHint(fmt);

      // Thumbnail overlay badge update
      const thumbPill = document.getElementById('thumb-quality-pill');
      if (thumbPill) {
        thumbPill.textContent = fmt.label || (fmt.height ? `${fmt.height}p` : 'HD');
      }
    };
    list.appendChild(btn);
    if (i === 0) btn.click();
  });
}

function updateFormatHint(fmt) {
  let hintEl = document.getElementById('format-hint');
  if (!hintEl) {
    hintEl = document.createElement('p');
    hintEl.id = 'format-hint';
    hintEl.className = 'info-note';
    hintEl.style.marginTop = '6px';
    const list = document.getElementById('format-list');
    if (list && list.parentNode) list.parentNode.appendChild(hintEl);
  }

  if (fmt.audio_only) {
    hintEl.innerHTML = '<b>MP3 Ses:</b> 320 kbps yüksek kalite MP3 olarak dönüştürülür ve evrensel ID3v2 etiketleri eklenir.';
  } else if (fmt.height >= 2160 || (fmt.label && fmt.label.includes('4K'))) {
    hintEl.innerHTML = '<b>4K Ultra HD:</b> 2160p orijinal video akışı indirilir, Premiere Pro için uyumlu H.264 High 5.2/AAC MP4 olarak kaydedilir.';
  } else if (fmt.height >= 1440 || (fmt.label && fmt.label.includes('2K'))) {
    hintEl.innerHTML = '<b>2K QHD:</b> 1440p video akışı Premiere Pro uyumlu H.264/AAC MP4 olarak kaydedilir.';
  } else if (fmt.height >= 1080 || (fmt.label && fmt.label.includes('1080p'))) {
    hintEl.innerHTML = '<b>Full HD:</b> 1080p video hızlı akış kopyalama veya H.264/AAC MP4 olarak kaydedilir.';
  } else {
    hintEl.innerHTML = '<b>Standart MP4:</b> Video ve ses Premiere Pro, Apple QuickTime ve VLC ile tam uyumlu formatta kaydedilir.';
  }
}

// ── Kuyruğa Ekle ─────────────────────────────────────────
async function addToQueue() {
  if (!videoInfo || !selectedFormat) return showToast('Önce video bilgisi alın.', 'warning');

  const btn = document.getElementById('btn-add');
  const btnSpan = btn ? (btn.querySelector('span') || btn) : null;
  if (btn) btn.disabled = true;
  if (btnSpan) btnSpan.textContent = 'Ekleniyor...';

  try {
    const res = await api('/api/queue/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url:               document.getElementById('url-input').value.trim(),
        stream_url:        videoInfo.stream_url || null,
        format_id:         selectedFormat.format_id,
        quality_label:     selectedFormat.label,
        audio_only:        selectedFormat.audio_only === true,
        title:             videoInfo.title,
        thumbnail:         videoInfo.thumbnail,
        platform:          videoInfo.platform,
        trim_start:        document.getElementById('trim-start').value.trim(),
        trim_end:          document.getElementById('trim-end').value.trim(),
        download_thumbnail:document.getElementById('chk-thumbnail').checked,
        is_playlist:       videoInfo.is_playlist && document.getElementById('chk-playlist').checked,
        custom_name:       document.getElementById('filename-input').value.trim(),
        playback_speed:    Number(document.getElementById('playback-speed').value),
      })
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Kuyruğa eklenemedi.', 'error');
      return;
    }

    showToast('İndirme kuyruğa eklendi.', 'success');
    switchTab('kuyruk');
    resetInfo();
  } catch (e) {
    showToast('Sunucuya bağlanılamadı.', 'error');
  } finally {
    if (btn) btn.disabled = false;
    if (btnSpan) btnSpan.textContent = 'Kuyruğa Ekle';
  }
}

// ── Kuyruk ve Durum Etiketleri ────────────────────────────
function statusLabel(j) {
  if (typeof j === 'string') {
    const labels = {
      waiting:    '⏳ Bekliyor',
      downloading:'⬇ İndiriliyor',
      processing: '⚙️ İşleniyor',
      paused:     '⏸ Duraklatıldı',
      done:       '✅ Tamamlandı',
      error:      '❌ Hata',
      cancelled:  '🚫 İptal',
    };
    return labels[j] || j;
  }

  const s = j.status;
  if (s === 'processing') {
    if (j.playback_speed > 1) {
      return `⚙️ Hızlandırılıyor (${j.playback_speed}x)`;
    }
    return j.audio_only ? '⚙️ Ses İşleniyor' : '⚙️ Premiere Pro İçin İşleniyor';
  }

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

function getJobQualityLabel(j) {
  if (j.audio_only) return 'MP3 (320k)';
  if (j.quality_label) return j.quality_label;
  const fid = String(j.format_id || '');
  if (fid.includes('2160')) return '4K (2160p)';
  if (fid.includes('1440')) return '2K (1440p)';
  if (fid.includes('1080')) return '1080p';
  if (fid.includes('720'))  return '720p';
  if (fid.includes('480'))  return '480p';
  if (fid.includes('360'))  return '360p';
  return 'MP4';
}

function formatJobError(rawError) {
  if (!rawError) return { title: 'Bilinmeyen bir hata oluştu.', suggestion: 'Lütfen tekrar deneyiniz.', detail: null };
  const err = String(rawError).trim();

  let title = 'İndirme işlemi tamamlanamadı.';
  let suggestion = 'Tekrar deneyebilir veya farklı bir bağlantı kullanabilirsiniz.';

  if (/Sign in to confirm|bot/i.test(err)) {
    title = 'YouTube bot veya oturum doğrulaması istedi.';
    suggestion = 'YouTube bu video için bot kontrolü uyguluyor. Birkaç dakika sonra tekrar deneyin veya alternatif bir bağlantı kullanın.';
  } else if (/Private video|This video is private/i.test(err)) {
    title = 'Video gizli veya kısıtlı erişimli.';
    suggestion = 'Yalnızca herkese açık (public) videolar indirilebilir.';
  } else if (/Video unavailable|removed by the uploader|not available/i.test(err)) {
    title = 'Video kullanılamıyor veya yayından kaldırılmış.';
    suggestion = 'Videonun platform üzerinde oynatılabilir olduğundan emin olun.';
  } else if (/Requested format is not available|No video formats found/i.test(err)) {
    title = 'İstenen çözünürlük veya video akışı bulunamadı.';
    suggestion = 'Farklı bir çözünürlük seçerek (örneğin "En İyi Kalite" veya "1080p") tekrar deneyin.';
  } else if (/Medya doğrulama hatası|akış bulunamadı/i.test(err)) {
    title = 'Medya akışı doğrulama hatası.';
    suggestion = 'İndirilen dosyada beklenen ses veya video akışı eksik çıktı. Tekrar deneyiniz.';
  } else if (/Video dönüştürme başarısız|hızlandırma başarısız|ffmpeg|codec/i.test(err)) {
    title = 'Medya dönüştürme (FFmpeg) hatası.';
    suggestion = 'Premiere Pro uyumluluk dönüştürmesi sırasında bir hata oluştu.';
  } else if (/ETIMEDOUT|ECONNREFUSED|ENOTFOUND|timeout|zaman aşımı/i.test(err)) {
    title = 'Ağ bağlantısı zaman aşımına uğradı.';
    suggestion = 'İnternet bağlantınızı kontrol edin ve tekrar deneyin.';
  } else if (/No space left|EACCES|permission/i.test(err)) {
    title = 'Disk alanı veya dosya yazma izni yetersiz.';
    suggestion = 'Kayıt klasörünün yazma izinlerini ve diskteki boş alanı kontrol edin.';
  } else {
    const cleanLines = err.split('\n').filter(l => !l.startsWith('WARNING') && l.trim().length > 0);
    const firstLine = cleanLines[0] || 'İşlem başarısız oldu.';
    title = firstLine.length > 120 ? firstLine.slice(0, 117) + '...' : firstLine;
  }

  const hasDetail = err.length > title.length || err.includes('\n');
  return {
    title,
    suggestion,
    detail: hasDetail ? err : null
  };
}

// ── beUI Dynamic Island Güncellemesi ──────────────────────
function updateDynamicIsland(items) {
  const island = document.getElementById('dynamic-island');
  const dot = document.getElementById('island-dot');
  const txt = document.getElementById('island-text');
  if (!island || !dot || !txt) return;

  const activeJob = (items || []).find(j => ['downloading', 'processing'].includes(j.status)) ||
                    (items || []).find(j => ['waiting', 'paused'].includes(j.status));

  if (!activeJob) {
    island.className = 'dynamic-island';
    dot.className = 'island-dot idle';
    txt.innerHTML = `Hazır · Link yapıştırın`;
    return;
  }

  island.classList.add('active');
  const title = activeJob.custom_name || activeJob.title || 'Video';
  const shortTitle = title.length > 24 ? title.slice(0, 22) + '...' : title;

  if (activeJob.status === 'downloading') {
    island.className = 'dynamic-island active downloading';
    dot.className = 'island-dot downloading';
    const pct = typeof activeJob.progress === 'number' ? `${Math.round(activeJob.progress)}%` : '0%';
    const speed = activeJob.speed ? ` · ${activeJob.speed}` : '';
    txt.innerHTML = `<b>${esc(shortTitle)}</b> <span class="island-pct">${pct}</span>${esc(speed)}`;
  } else if (activeJob.status === 'processing') {
    island.className = 'dynamic-island active processing';
    dot.className = 'island-dot processing';
    txt.innerHTML = `<b>${esc(shortTitle)}</b> İşleniyor...`;
  } else if (activeJob.status === 'paused') {
    island.className = 'dynamic-island active paused';
    dot.className = 'island-dot paused';
    txt.innerHTML = `<b>${esc(shortTitle)}</b> Duraklatıldı`;
  } else {
    island.className = 'dynamic-island active waiting';
    dot.className = 'island-dot waiting';
    txt.innerHTML = `<b>${esc(shortTitle)}</b> Sırada`;
  }
}

function onDynamicIslandClick() {
  const hasActive = lastQueue.some(j => ['downloading','processing','waiting','paused'].includes(j.status));
  if (hasActive) {
    switchTab('kuyruk');
  } else {
    openCommandPalette();
  }
}

// ── Kuyruk Render ─────────────────────────────────────────
function updateQueueBadge(items) {
  const active = (items || []).filter(j => ['waiting','downloading','processing','paused'].includes(j.status)).length;
  const badge = document.getElementById('badge-kuyruk');
  if (badge) {
    if (active > 0) {
      badge.textContent = active;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  }

  const sub = document.getElementById('queue-count-sub');
  if (sub) {
    sub.textContent = `${items.length} indirme`;
  }

  // Dynamic Island Senkronizasyonu
  updateDynamicIsland(items);
}

async function renderQueue(preloadedItems = null) {
  try {
    let items = preloadedItems;
    if (!Array.isArray(items)) {
      const res = await api('/api/queue');
      items = await res.json();
    }
    lastQueue = items || [];

    updateQueueBadge(items);

    const el = document.getElementById('queue-list');
    if (!el) return;

    if (items.length === 0) {
      el.innerHTML = '<p class="empty-msg">Kuyruk boş.<br>İndir sekmesinden ekleyin.</p>';
      return;
    }

    el.innerHTML = items.map(j => {
      const pct = (typeof j.progress === 'number') ? j.progress.toFixed(1) : '0.0';
      const isProcessing = j.status === 'processing';
      const showProgress = ['downloading','processing','paused'].includes(j.status);
      const canPause  = j.status === 'downloading';
      const canResume = j.status === 'paused';
      const canCancel = ['waiting','downloading','processing','paused'].includes(j.status);
      const isDone    = j.status === 'done';
      const isError   = j.status === 'error';
      const displayName = j.custom_name || j.title;
      const qualityTag = getJobQualityLabel(j);
      const is4K = qualityTag.includes('4K') || (j.format_id && String(j.format_id).includes('2160'));
      const badgeHtml = is4K ? `<span class="badge-quality badge-4k">4K UHD</span>` : `<span class="badge-quality badge-compat">${esc(qualityTag)}</span>`;

      let errorHtml = '';
      if (isError) {
        const errInfo = formatJobError(j.error);
        errorHtml = `
        <div class="q-error-box">
          <div class="q-error-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
          </div>
          <div class="q-error-content">
            <div class="q-error-title">${esc(errInfo.title)}</div>
            ${errInfo.suggestion ? `<div class="q-error-detail" style="margin-top:3px;color:var(--text2)">${esc(errInfo.suggestion)}</div>` : ''}
            ${errInfo.detail ? `
            <details style="margin-top:6px;font-size:0.71rem;color:var(--text3)">
              <summary style="cursor:pointer;font-weight:600">Teknik Detayları Göster</summary>
              <pre style="margin-top:4px;padding:8px 10px;background:var(--surface2);border-radius:6px;border:1px solid var(--border);white-space:pre-wrap;word-break:break-all;max-height:120px;overflow-y:auto;font-family:monospace">${esc(errInfo.detail)}</pre>
            </details>` : ''}
          </div>
        </div>`;
      }

      let warningHtml = '';
      if (isDone && j.warning) {
        warningHtml = `
        <div class="inline-warning" style="margin-top:8px;padding:8px 12px;font-size:0.75rem">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px;margin-right:4px">
            <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>${esc(j.warning)}
        </div>`;
      }

      return `
      <div class="q-item ${j.status}" id="qitem-${j.id}">
        <div class="q-top">
          ${j.thumbnail ? `<img class="q-thumb" src="${esc(j.thumbnail)}" alt="">` : '<div class="q-thumb"></div>'}
          <div class="q-info">
            <div class="q-title" title="${esc(displayName)}">${esc(displayName)}</div>
            <div class="q-sub">${esc(j.platform || '')} · ${badgeHtml}
              ${j.trim_start || j.trim_end ? ' · Kırpılıyor' : ''}
              ${j.download_thumbnail ? ' · Kapak' : ''}
              ${j.is_playlist ? ' · Playlist' : ''}
              ${j.playback_speed > 1 ? ` · ${j.playback_speed}x Hız` : ''}
            </div>
          </div>
          <span class="q-status ${j.status}">${statusLabel(j)}</span>
        </div>

        ${showProgress ? `
        <div class="q-progress">
          <div class="prog-bar-bg"><div class="prog-bar-fill ${isProcessing ? 'processing' : ''}" style="width:${isProcessing ? '100' : pct}%;"></div></div>
          <div class="q-prog-info">
            <span>${isProcessing ? 'İşleniyor...' : `%${pct}`}</span>
            <span>${isProcessing ? (j.playback_speed > 1 ? 'Medya hızlandırılıyor...' : 'Premiere Pro uyumlu H.264/AAC kodlanıyor...') : `${j.speed ? j.speed : ''}${j.eta ? ' · ETA ' + j.eta : ''}`}</span>
          </div>
        </div>` : ''}

        ${isDone && j.filename ? `
        <div class="q-prog-info" style="margin-top:8px">
          <span style="font-size:.75rem;color:var(--text3);word-break:break-all"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px;margin-right:4px"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>${esc(j.filename)}</span>
        </div>` : ''}

        ${errorHtml}
        ${warningHtml}

        <div class="q-actions">
          ${canPause  ? `<button type="button" class="btn-secondary btn-sm" onclick="qPause('${j.id}')"><svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" style="vertical-align:-1px;margin-right:3px"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>Duraklat</button>` : ''}
          ${canResume ? `<button type="button" class="btn-secondary btn-sm" onclick="qResume('${j.id}')"><svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" style="vertical-align:-1px;margin-right:3px"><polygon points="5 3 19 12 5 21 5 3"/></svg>Devam</button>` : ''}
          ${isDone && j.filename ? `<a class="btn-secondary btn-sm" href="/api/download/${j.id}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" style="vertical-align:-1px;margin-right:3px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>İndir</a>` : ''}
          ${isDone && j.filename ? `<button type="button" class="btn-secondary btn-sm" onclick="showDownloaded(unb64('${b64(j.filename)}'))" title="Finder'da göster"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></button>` : ''}
          ${isDone && j.filename ? `<button type="button" class="btn-secondary btn-sm" onclick="renameDownload('${j.id}')" title="Yeniden adlandır"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg></button>` : ''}
          ${isDone && j.filename ? `<button type="button" class="btn-danger btn-sm" onclick="qDeleteFile('${j.id}')"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px;margin-right:3px"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>Sil</button>` : ''}
          ${isDone && !j.filename ? `<button type="button" class="btn-danger btn-sm" onclick="qDismissError('${j.id}')"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px;margin-right:3px"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>Kaldır</button>` : ''}
          ${isError ? `<button type="button" class="btn-warning btn-sm" onclick="qRetry('${j.id}')"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" style="vertical-align:-1px;margin-right:3px"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>Tekrar Dene</button>` : ''}
          ${isError ? `<button type="button" class="btn-danger btn-sm" onclick="qDismissError('${j.id}')"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px;margin-right:3px"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>Kaldır</button>` : ''}
          ${canCancel ? `<button type="button" class="btn-danger btn-sm" onclick="qCancel('${j.id}')"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" style="vertical-align:-1px;margin-right:3px"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>İptal</button>` : ''}
        </div>
      </div>`;
    }).join('');
  } catch {}
}

async function qPause(id) {
  try {
    const res = await api(`/api/queue/${id}/pause`, { method: 'POST' });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      showToast(d.error || 'İşlem duraklatılamadı.', 'error');
    }
    renderQueue();
  } catch {
    showToast('Sunucuya bağlanılamadı.', 'error');
  }
}

async function qResume(id) {
  try {
    const res = await api(`/api/queue/${id}/resume`, { method: 'POST' });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      showToast(d.error || 'İşlem devam ettirilemedi.', 'error');
    }
    renderQueue();
  } catch {
    showToast('Sunucuya bağlanılamadı.', 'error');
  }
}

async function qCancel(id) {
  if (!confirm('İndirme iptal edilsin mi?')) return;
  try {
    const res = await api(`/api/queue/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      showToast(d.error || 'İşlem iptal edilemedi.', 'error');
    } else {
      showToast('İndirme iptal edildi.', 'info');
    }
    renderQueue();
  } catch {
    showToast('Sunucuya bağlanılamadı.', 'error');
  }
}

async function qDismissError(id) {
  try {
    const res = await api(`/api/queue/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      showToast(d.error || 'Kuyruktan kaldırılamadı.', 'error');
    }
    renderQueue();
  } catch {
    showToast('Sunucuya bağlanılamadı.', 'error');
  }
}

async function qRetry(id, showNotice = true) {
  const job = lastQueue.find(j => j.id === id);
  if (!job) {
    if (showNotice) showToast('İşlem bilgisi bulunamadı.', 'warning');
    return;
  }

  try {
    const res = await api('/api/queue/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url:               job.url,
        stream_url:        job.stream_url || null,
        format_id:         job.format_id,
        quality_label:     job.quality_label,
        audio_only:        job.audio_only === true,
        title:             job.title,
        thumbnail:         job.thumbnail,
        platform:          job.platform,
        trim_start:        job.trim_start,
        trim_end:          job.trim_end,
        download_thumbnail:job.download_thumbnail,
        is_playlist:       job.is_playlist,
        custom_name:       job.custom_name,
        playback_speed:    job.playback_speed,
      })
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      if (showNotice) showToast(d.error || 'Tekrar kuyruğa eklenemedi.', 'error');
      return;
    }
    // Eski hatalı işi kuyruktan temizle
    await api(`/api/queue/${id}`, { method: 'DELETE' }).catch(() => {});
    if (showNotice) showToast('İşlem yeniden başlatıldı.', 'success');
    renderQueue();
  } catch {
    if (showNotice) showToast('Sunucuya bağlanılamadı.', 'error');
  }
}

async function retryFailedJobs() {
  const failedJobs = lastQueue.filter(j => j.status === 'error');
  if (failedJobs.length === 0) {
    showToast('Kuyrukta hata veren işlem bulunamadı.', 'info');
    return;
  }

  showToast(`${failedJobs.length} hatalı indirme yeniden başlatılıyor...`, 'info');
  for (const job of failedJobs) {
    try {
      await qRetry(job.id, false);
    } catch {}
  }
  await renderQueue();
  showToast('Hatalı işlemler tekrar sıraya alındı.', 'success');
}

async function clearAllQueue() {
  if (lastQueue.length === 0) {
    showToast('Kuyruk zaten boş.', 'info');
    return;
  }
  if (!confirm('Kuyruktaki tüm işlemler iptal edilip silinsin mi?')) return;

  try {
    for (const job of lastQueue) {
      await api(`/api/queue/${job.id}`, { method: 'DELETE' }).catch(() => {});
    }
    showToast('Kuyruk temizlendi.', 'success');
    renderQueue();
  } catch {
    showToast('Kuyruk temizlenirken hata oluştu.', 'error');
  }
}

async function qDeleteFile(id) {
  if (!confirm('Dosya sunucudan silinsin mi?')) return;
  try {
    const res = await api(`/api/download/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      showToast(d.error || 'Dosya silinemedi.', 'error');
    } else {
      showToast('Dosya silindi.', 'info');
    }
    renderQueue();
  } catch {
    showToast('Sunucuya bağlanılamadı.', 'error');
  }
}

async function renameDownload(id) {
  const name = prompt('Yeni dosya adı:', '');
  if (name === null) return;
  try {
    const res = await api(`/api/download/${id}/name`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim() })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return showToast(data.error || 'Dosya yeniden adlandırılamadı.', 'error');
    showToast('Dosya adı güncellendi.', 'success');
    renderQueue();
    renderHistory();
  } catch {
    showToast('Sunucuya bağlanılamadı.', 'error');
  }
}

async function clearDone() {
  try {
    const res = await api('/api/queue/done', { method: 'DELETE' });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      showToast(d.error || 'Kuyruk temizlenemedi.', 'error');
    } else {
      showToast('Tamamlanan indirmeler temizlendi.', 'success');
    }
    renderQueue();
  } catch {
    showToast('Sunucuya bağlanılamadı.', 'error');
  }
}

// ── Geçmiş Render ─────────────────────────────────────────
async function renderHistory() {
  try {
    const res = await api('/api/history');
    const items = await res.json();
    const el = document.getElementById('history-list');
    if (!el) return;

    const sub = document.getElementById('history-count-sub');
    if (sub) {
      sub.textContent = `${items.length} kayıt`;
    }

    if (items.length === 0) {
      el.innerHTML = '<p class="empty-msg">Henüz indirme yapılmadı.</p>';
      return;
    }
    el.innerHTML = items.map(h => {
      const date = new Date(h.doneAt).toLocaleString('tr-TR');
      const displayName = h.custom_name || h.title;
      return `
      <div class="h-item">
        ${h.thumbnail ? `<img class="h-thumb" src="${esc(h.thumbnail)}" alt="">` : '<div class="h-thumb"></div>'}
        <div class="h-info">
          <div class="h-title" title="${esc(displayName)}">${esc(displayName)}</div>
          <div class="h-sub">${esc(h.platform || '')} · ${date}</div>
        </div>
        <div class="h-actions">
          ${h.filename ? `<a class="btn-secondary btn-sm" href="/api/download/${h.id}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" style="vertical-align:-1px;margin-right:3px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>İndir</a>` : ''}
          ${h.filename ? `<button type="button" class="btn-secondary btn-sm" onclick="showDownloaded(unb64('${b64(h.filename)}'))" title="Finder'da göster"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></button>` : ''}
          ${h.filename ? `<button type="button" class="btn-secondary btn-sm" onclick="renameDownload('${h.id}')" title="Yeniden adlandır"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg></button>` : ''}
          ${h.filename ? `<button type="button" class="btn-danger btn-sm" onclick="hDeleteFile('${h.id}')"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px;margin-right:3px"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>Sil</button>` : ''}
        </div>
      </div>`;
    }).join('');
  } catch {}
}

async function hDeleteFile(id) {
  if (!confirm('Dosya sunucudan silinsin mi?')) return;
  try {
    const res = await api(`/api/download/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      showToast(d.error || 'Dosya silinemedi.', 'error');
    } else {
      showToast('Dosya silindi.', 'info');
    }
    renderHistory();
  } catch {
    showToast('Sunucuya bağlanılamadı.', 'error');
  }
}

async function clearHistory() {
  if (!confirm('Tüm geçmiş silinsin mi?')) return;
  try {
    const res = await api('/api/history', { method: 'DELETE' });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      showToast(d.error || 'Geçmiş temizlenemedi.', 'error');
    } else {
      showToast('Geçmiş temizlendi.', 'success');
    }
    renderHistory();
  } catch {
    showToast('Sunucuya bağlanılamadı.', 'error');
  }
}

// ── Yardımcı Fonksiyonlar ─────────────────────────────────
function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
// UTF-8 güvenli base64
function b64(s) { return btoa(unescape(encodeURIComponent(s || ''))); }
function unb64(s) { return decodeURIComponent(escape(atob(s))); }

// ── showInfoCard — card-loading/error/info göster/gizle ──
function showInfoCard(name, msg) {
  const cLoad = document.getElementById('card-loading');
  const cErr  = document.getElementById('card-error');
  const cInfo = document.getElementById('card-info');

  if (cLoad) cLoad.style.display = 'none';
  if (cErr)  cErr.style.display  = 'none';
  if (cInfo) cInfo.style.display = 'none';

  if (name === 'loading' && cLoad) cLoad.style.display = 'block';
  if (name === 'error'   && cErr)  cErr.style.display   = 'flex';
  if (name === 'info'    && cInfo) {
    cInfo.style.display  = 'block';
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        const curSpeed = document.getElementById('playback-speed')?.value || '1';
        setSpeedSegment(curSpeed);
      });
    }
  }

  if (msg) {
    const errEl = document.getElementById('error-msg');
    if (errEl) errEl.textContent = msg;
  }
}

function resetInfo() {
  videoInfo = null;
  selectedFormat = null;
  const urlInp = document.getElementById('url-input');
  if (urlInp) {
    urlInp.value = '';
    onUrlInputChange('');
  }
  const fnInp = document.getElementById('filename-input');
  if (fnInp) fnInp.value = '';
  setSpeedSegment('1');
  const tStart = document.getElementById('trim-start');
  if (tStart) tStart.value = '';
  const tEnd = document.getElementById('trim-end');
  if (tEnd) tEnd.value = '';
  const chkThumb = document.getElementById('chk-thumbnail');
  if (chkThumb) chkThumb.checked = false;
  const chkPl = document.getElementById('chk-playlist');
  if (chkPl) chkPl.checked = true;
  const hintEl = document.getElementById('format-hint');
  if (hintEl) hintEl.textContent = '';
  showInfoCard(null);
}

// ── Otomatik Polling ──────────────────────────────────────
function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(async () => {
    try {
      const res = await api('/api/queue');
      const items = await res.json();
      lastQueue = items || [];

      // Badge ve Dynamic Island güncelle
      updateQueueBadge(items);

      // Kuyruk sekmesi açıksa listeyi güncelle
      const kuyrukSection = document.getElementById('section-kuyruk');
      if (kuyrukSection && kuyrukSection.style.display === 'block') {
        renderQueue(items);
      }
    } catch {
      // 401 veya bağlantı hatası api() içinde yakalanır
    }
  }, 1000);
}

// ── Kırpma Saat Maskesi ───────────────────────────────────
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

function showThumbCard(name, msg) {
  const cLoad = document.getElementById('card-loading-thumb');
  const cErr  = document.getElementById('card-error-thumb');
  const cRes  = document.getElementById('card-thumb-result');

  if (cLoad) cLoad.style.display = 'none';
  if (cErr)  cErr.style.display  = 'none';
  if (cRes)  cRes.style.display  = 'none';

  if (name === 'loading' && cLoad) cLoad.style.display = 'block';
  if (name === 'error'   && cErr)  cErr.style.display   = 'flex';
  if (name === 'info'    && cRes)  cRes.style.display  = 'block';

  if (msg) {
    const errEl = document.getElementById('error-msg-thumb');
    if (errEl) errEl.textContent = msg;
  }
}

function resetThumbnailInfo() {
  thumbVideoInfo = null;
  selectedThumbnailUrl = null;
  const tUrl = document.getElementById('thumb-url-input');
  if (tUrl) tUrl.value = '';
  showThumbCard(null);
}

async function fetchThumbnailInfo() {
  const thumbUrlInput = document.getElementById('thumb-url-input');
  const url = thumbUrlInput ? thumbUrlInput.value.trim() : '';
  if (!url) return showToast('Lütfen bir video linki girin.', 'warning');

  const fetchBtn = document.getElementById('btn-fetch-thumb');
  if (fetchBtn) fetchBtn.disabled = true;

  updateFetchThumbStatus('Kapak resmi ve yüksek çözünürlükler taranıyor...');
  _fetchThumbBarStart();
  showThumbCard('loading');

  try {
    const res = await api('/api/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    const data = await res.json();
    if (!res.ok) {
      _fetchThumbBarDone();
      showThumbCard('error', data.error || 'Kapak resmi alınamadı.');
      return;
    }
    _fetchThumbBarDone(() => {
      thumbVideoInfo = data;
      renderThumbnailInfo(data);
      showThumbCard('info');
    });
  } catch (e) {
    _fetchThumbBarDone();
    showThumbCard('error', 'Sunucuya bağlanılamadı.');
  } finally {
    if (fetchBtn) fetchBtn.disabled = false;
  }
}

function renderThumbnailInfo(d) {
  const titleEl = document.getElementById('thumb-info-title');
  if (titleEl) titleEl.textContent = d.title || 'Video Kapak Resmi';
  const uploaderEl = document.getElementById('thumb-info-uploader');
  if (uploaderEl) uploaderEl.textContent = d.uploader ? `${d.uploader}` : '';
  const platEl = document.getElementById('thumb-info-platform');
  if (platEl) platEl.textContent = d.platform ? `${d.platform}` : '';

  selectedThumbnailUrl = null;

  // 1. A/B Test ve Alternatif Kapak Varyantlarını Render Et
  const variantsWrap = document.getElementById('thumb-variants-wrap');
  const variantsGrid = document.getElementById('thumb-variants-grid');
  const countBadge = document.getElementById('variants-count-badge');

  if (variantsWrap && variantsGrid) {
    variantsGrid.innerHTML = '';
    const variants = Array.isArray(d.variants) && d.variants.length > 0 ? d.variants : [];

    if (variants.length > 1) {
      variantsWrap.style.display = 'block';
      if (countBadge) countBadge.textContent = `${variants.length} Seçenek`;

      variants.forEach((v, idx) => {
        const card = document.createElement('div');
        card.className = `thumb-var-card ${idx === 0 ? 'active' : ''}`;
        card.setAttribute('role', 'radio');
        card.setAttribute('aria-checked', idx === 0 ? 'true' : 'false');
        card.tabIndex = 0;

        const isAb = v.type === 'ab_test' || v.badge === 'A/B Test';
        const badgeClass = isAb ? 'badge-ab' : (v.type === 'frame' ? 'badge-frame' : 'badge-primary');

        card.innerHTML = `
          <div class="var-img-container">
            <img src="${esc(v.url)}" class="var-preview-img" alt="${esc(v.title || v.label)}" loading="lazy" />
            <span class="var-type-badge ${badgeClass}">${esc(v.badge || 'Kapak')}</span>
          </div>
          <div class="var-meta">
            <div class="var-name" title="${esc(v.title || v.label)}">${esc(v.label)}</div>
            <div class="var-res">${esc(v.resolution || 'HD')}</div>
          </div>
        `;

        card.onclick = () => {
          document.querySelectorAll('#thumb-variants-grid .thumb-var-card').forEach(c => {
            c.classList.remove('active');
            c.setAttribute('aria-checked', 'false');
          });
          card.classList.add('active');
          card.setAttribute('aria-checked', 'true');
          selectedThumbnailUrl = v.url;

          // Eğer seçilen varyant ana kapak değilse çözünürlük butonlarını pasif yap
          if (idx !== 0) {
            document.querySelectorAll('#thumb-format-list .fmt-btn').forEach(b => b.classList.remove('active'));
          } else {
            // Ana kapak seçildiyse ilk çözünürlük butonunu aktif yap
            const firstFmt = document.querySelector('#thumb-format-list .fmt-btn');
            if (firstFmt && !document.querySelector('#thumb-format-list .fmt-btn.active')) {
              firstFmt.classList.add('active');
            }
          }

          const previewImg = document.getElementById('thumb-large-preview');
          if (previewImg) previewImg.src = v.url;

          const btnDownload = document.getElementById('btn-download-thumb');
          if (btnDownload) {
            const span = btnDownload.querySelector('span');
            if (span) span.textContent = `"${v.label}" İndir (.jpg)`;
          }
        };

        card.onkeydown = (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            card.onclick();
          }
        };

        const vImg = card.querySelector('.var-preview-img');
        if (vImg && idx !== 0) {
          vImg.onerror = () => { card.style.display = 'none'; };
        }

        variantsGrid.appendChild(card);
      });
    } else {
      variantsWrap.style.display = 'none';
    }
  }

  // 2. Kapak Çözünürlük Butonları (Deduplicated ve temiz)
  const list = document.getElementById('thumb-format-list');
  if (!list) return;
  list.innerHTML = '';

  const thumbs = (d.thumbnails && d.thumbnails.length > 0) ? d.thumbnails : [
    { url: d.thumbnail, label: 'En Yüksek Kalite', resolution: 'HD' }
  ];

  thumbs.forEach((t, i) => {
    if (!t || !t.url) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `fmt-btn ${i === 0 ? 'active' : ''}`;
    btn.textContent = t.label || t.resolution || 'Kapak';
    btn.onclick = () => {
      document.querySelectorAll('#thumb-format-list .fmt-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedThumbnailUrl = t.url;

      // Çözünürlük tıklandığında varyant gridinde ilk kartı (Ana Kapak) aktif yap
      const varCards = document.querySelectorAll('#thumb-variants-grid .thumb-var-card');
      varCards.forEach((c, idx) => {
        c.classList.toggle('active', idx === 0);
        c.setAttribute('aria-checked', idx === 0 ? 'true' : 'false');
      });

      const previewImg = document.getElementById('thumb-large-preview');
      if (previewImg) previewImg.src = t.url;

      const btnDownload = document.getElementById('btn-download-thumb');
      if (btnDownload) {
        const span = btnDownload.querySelector('span');
        if (span) span.textContent = `Seçilen Çözünürlükte İndir (${t.resolution || 'HD'})`;
      }
    };
    list.appendChild(btn);
  });

  // Başlangıç seçimi
  if (thumbs.length > 0) {
    selectedThumbnailUrl = thumbs[0].url;
    const previewImg = document.getElementById('thumb-large-preview');
    if (previewImg) {
      previewImg.src = thumbs[0].url;
      previewImg.onerror = () => {
        if (d.thumbnail && previewImg.src !== d.thumbnail) {
          previewImg.src = d.thumbnail;
          selectedThumbnailUrl = d.thumbnail;
        }
      };
    }
    const btnDownload = document.getElementById('btn-download-thumb');
    if (btnDownload) {
      const span = btnDownload.querySelector('span');
      if (span) span.textContent = `Seçilen Çözünürlükte İndir (${thumbs[0].resolution || 'HD'})`;
    }
  }

  setupTiltCards();
}

function downloadSelectedThumbnail() {
  if (!selectedThumbnailUrl) return showToast('Lütfen bir kapak seçin.', 'warning');
  const title = thumbVideoInfo?.title || 'kapak-resmi';
  const downloadUrl = `/api/download-thumbnail-file?url=${encodeURIComponent(selectedThumbnailUrl)}&title=${encodeURIComponent(title)}`;

  const a = document.createElement('a');
  a.href = downloadUrl;
  a.download = `${title}.jpg`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  showToast('Kapak resmi indirmesi başlatıldı.', 'success');
}

// ══════════════════════════════════════════════════════════════
// beUI YENİ ETKİLEŞİMLER VE BİLEŞENLER
// ══════════════════════════════════════════════════════════════

// ── URL Giriş & Canlı Platform Tespiti ────────────────────────
function onUrlInputChange(val) {
  const clearBtn = document.getElementById('btn-clear-url');
  if (clearBtn) {
    clearBtn.style.display = val ? 'inline-flex' : 'none';
  }

  // Platform çipleri güncelleme
  const url = (val || '').toLowerCase();
  document.querySelectorAll('.platform-chip').forEach(chip => {
    const p = chip.getAttribute('data-platform');
    let matched = false;
    if (p === 'youtube' && (url.includes('youtube.com') || url.includes('youtu.be'))) matched = true;
    else if (p === 'tiktok' && url.includes('tiktok.com')) matched = true;
    else if (p === 'instagram' && url.includes('instagram.com')) matched = true;
    else if (p === 'kick' && url.includes('kick.com')) matched = true;
    else if (p === 'twitter' && (url.includes('twitter.com') || url.includes('x.com'))) matched = true;
    else if (p === 'soundcloud' && url.includes('soundcloud.com')) matched = true;

    if (matched) {
      chip.classList.add('active');
    } else {
      chip.classList.remove('active');
    }
  });
}

function clearUrlInput() {
  const inp = document.getElementById('url-input');
  if (inp) {
    inp.value = '';
    onUrlInputChange('');
    inp.focus();
  }
}

async function pasteFromClipboard(targetId) {
  try {
    if (navigator.clipboard && navigator.clipboard.readText) {
      const text = await navigator.clipboard.readText();
      const target = document.getElementById(targetId);
      if (target && text) {
        const clean = text.trim();
        target.value = clean;
        if (targetId === 'url-input') {
          onUrlInputChange(clean);
          showToast('Bağlantı panodan yapıştırıldı.', 'info');
          if (/^https?:\/\//i.test(clean)) {
            fetchInfo();
          }
        } else if (targetId === 'thumb-url-input') {
          showToast('Bağlantı panodan yapıştırıldı.', 'info');
          if (/^https?:\/\//i.test(clean)) {
            fetchThumbnailInfo();
          }
        }
      }
    } else {
      showToast('Panoya erişim izni bulunamadı.', 'warning');
    }
  } catch (err) {
    showToast('Panodan yapıştırma başarısız oldu.', 'warning');
  }
}

// ── Segmented Video Hızı ──────────────────────────────────
function setSpeedSegment(speedVal) {
  const sel = document.getElementById('playback-speed');
  if (sel) {
    sel.value = String(speedVal);
  }

  const glider = document.getElementById('speed-glider');
  const container = document.getElementById('speed-segmented');
  const btns = container ? container.querySelectorAll('.seg-btn') : [];

  btns.forEach(btn => {
    if (btn.getAttribute('data-speed') === String(speedVal)) {
      btn.classList.add('active');
      if (glider && btn.parentElement) {
        if (btn.offsetWidth > 0) {
          glider.style.transform = `translateX(${btn.offsetLeft}px)`;
          glider.style.width = `${btn.offsetWidth}px`;
          glider.style.opacity = '1';
        }
      }
    } else {
      btn.classList.remove('active');
    }
  });
}

// ── Trim Zaman Önayarları ─────────────────────────────────
function applyTrimPreset(type) {
  if (type === 'start-0') {
    const s = document.getElementById('trim-start');
    if (s) s.value = '00:00:00';
  }
}

function applyTrimOffset(sec) {
  const parseSec = (str) => {
    if (!str) return 0;
    const parts = str.split(':').map(Number);
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return Number(str) || 0;
  };

  const toTime = (s) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sc = s % 60;
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sc).padStart(2,'0')}`;
  };

  const endInp = document.getElementById('trim-end');
  const startInp = document.getElementById('trim-start');
  if (!endInp) return;

  let currentEnd = parseSec(endInp.value);
  if (!currentEnd && startInp && startInp.value) {
    currentEnd = parseSec(startInp.value);
  }
  const next = currentEnd + sec;
  endInp.value = toTime(next);
}

function clearTrimFields() {
  const s = document.getElementById('trim-start');
  const e = document.getElementById('trim-end');
  if (s) s.value = '';
  if (e) e.value = '';
}

// ── 3D Tilt Kart Efekti (beUI Smooth Damped Tilt) ─────────
function setupTiltCards() {
  document.querySelectorAll('.be-tilt').forEach(card => {
    if (card._tiltAttached) return;
    card._tiltAttached = true;

    let targetRotX = 0, targetRotY = 0;
    let currentRotX = 0, currentRotY = 0;
    let isHovering = false;
    let animId = null;

    function updateCardTransform() {
      if (!isHovering && Math.abs(currentRotX) < 0.002 && Math.abs(currentRotY) < 0.002) {
        card.style.transform = 'perspective(4200px) rotateX(0deg) rotateY(0deg)';
        const glare = card.querySelector('.tilt-glare');
        if (glare) glare.style.opacity = '0';
        animId = null;
        return;
      }

      currentRotX += (targetRotX - currentRotX) * 0.08;
      currentRotY += (targetRotY - currentRotY) * 0.08;

      card.style.transform = `perspective(4200px) rotateX(${currentRotX.toFixed(3)}deg) rotateY(${currentRotY.toFixed(3)}deg)`;
      animId = requestAnimationFrame(updateCardTransform);
    }

    card.addEventListener('mousemove', e => {
      isHovering = true;
      card.style.transition = 'none';

      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;

      // Sakin, baş döndürmeyen, gözü yormayan lüks mikro-eğim (maks ±0.20 derece)
      targetRotX = ((y - centerY) / centerY) * -0.20;
      targetRotY = ((x - centerX) / centerX) * 0.20;

      const glare = card.querySelector('.tilt-glare');
      if (glare) {
        glare.style.opacity = '0.25';
        glare.style.background = `radial-gradient(circle at ${x}px ${y}px, rgba(255,255,255,0.03), transparent 65%)`;
      }

      if (!animId) {
        animId = requestAnimationFrame(updateCardTransform);
      }
    });

    card.addEventListener('mouseleave', () => {
      isHovering = false;
      targetRotX = 0;
      targetRotY = 0;
      card.style.transition = 'transform 0.4s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.2s ease';
      card.style.transform = 'perspective(4200px) rotateX(0deg) rotateY(0deg)';
      const glare = card.querySelector('.tilt-glare');
      if (glare) glare.style.opacity = '0';
      if (animId) {
        cancelAnimationFrame(animId);
        animId = null;
      }
    });
  });
}

// ── Modern Custom Cursor Takipçisi ────────────────────────
function setupCustomCursor() {
  const follower = document.getElementById('beui-cursor-follower');
  if (!follower || window.matchMedia('(pointer: coarse)').matches) return;

  let mouseX = -100, mouseY = -100;
  let followerX = -100, followerY = -100;
  let active = false;

  window.addEventListener('mousemove', e => {
    mouseX = e.clientX;
    mouseY = e.clientY;
    if (!active) {
      active = true;
      follower.style.opacity = '1';
    }

    const target = e.target;
    const isTextInput = target && target.closest('input:not([type="button"]):not([type="submit"]), textarea');
    if (isTextInput) {
      follower.classList.add('cursor-text');
      follower.classList.remove('cursor-hover');
      return;
    }
    follower.classList.remove('cursor-text');

    const isClickable = target && target.closest('button, a, input[type="button"], input[type="submit"], select, .fmt-btn, .sidebar-tab, .theme-btn, .thumb-var-card, [role="button"], [role="tab"]');
    if (isClickable) {
      follower.classList.add('cursor-hover');
    } else {
      follower.classList.remove('cursor-hover');
    }
  });

  window.addEventListener('mouseleave', () => {
    follower.style.opacity = '0';
    active = false;
  });

  function renderCursor() {
    followerX += (mouseX - followerX) * 0.22;
    followerY += (mouseY - followerY) * 0.22;
    follower.style.transform = `translate3d(${followerX}px, ${followerY}px, 0) translate(-50%, -50%)`;
    requestAnimationFrame(renderCursor);
  }
  requestAnimationFrame(renderCursor);
}

// ── Command Palette (beUI Command Palette ⌘K) ──────────────
const commandPaletteItems = [
  {
    id: 'cmd-tab-indir',
    title: 'İndir Sekmesine Git',
    icon: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
    action: () => switchTab('indir'),
    shortcut: '1'
  },
  {
    id: 'cmd-tab-thumb',
    title: 'Kapak Resmi (Thumbnail) Sekmesine Git',
    icon: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`,
    action: () => switchTab('thumbnail'),
    shortcut: '2'
  },
  {
    id: 'cmd-tab-kuyruk',
    title: 'İndirme Kuyruğunu Aç',
    icon: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><polyline points="3 6 4 7 6 5"/><polyline points="3 12 4 13 6 11"/><polyline points="3 18 4 19 6 17"/></svg>`,
    action: () => switchTab('kuyruk'),
    shortcut: '3'
  },
  {
    id: 'cmd-tab-gecmis',
    title: 'İndirme Geçmişini Aç',
    icon: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 15"/></svg>`,
    action: () => switchTab('gecmis'),
    shortcut: '4'
  },
  {
    id: 'cmd-open-dir',
    title: 'İndirilen Dosyalar Klasörünü Aç',
    icon: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`,
    action: () => openDownloadDir(),
    shortcut: 'O'
  },
  {
    id: 'cmd-retry-failed',
    title: 'Hata Veren İndirmeleri Yeniden Başlat',
    icon: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>`,
    action: () => retryFailedJobs(),
    shortcut: 'R'
  },
  {
    id: 'cmd-clear-done',
    title: 'Tamamlanan İndirmeleri Kuyruktan Temizle',
    icon: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>`,
    action: () => clearDone(),
    shortcut: 'C'
  },
  {
    id: 'cmd-theme-dark',
    title: 'Karanlık Temaya Geç',
    icon: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`,
    action: () => setTheme('dark'),
    shortcut: 'D'
  },
  {
    id: 'cmd-theme-light',
    title: 'Aydınlık Temaya Geç',
    icon: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`,
    action: () => setTheme('light'),
    shortcut: 'L'
  },
  {
    id: 'cmd-theme-pink',
    title: 'Pembe Temaya Geç',
    icon: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4L12 2z"/></svg>`,
    action: () => setTheme('pink'),
    shortcut: 'P'
  },
];

let activeCmdIndex = 0;

function openCommandPalette() {
  const modal = document.getElementById('command-palette-modal');
  const input = document.getElementById('cmd-palette-input');
  if (modal) {
    modal.classList.remove('hidden');
    if (document.body) document.body.style.overflow = 'hidden';
    renderCommandPaletteList('');
    if (input) {
      input.value = '';
      setTimeout(() => input.focus(), 50);
    }
  }
}

function closeCommandPalette() {
  const modal = document.getElementById('command-palette-modal');
  if (modal) {
    modal.classList.add('hidden');
    if (document.body) document.body.style.overflow = '';
  }
}

function onCmdBackdropClick(e) {
  if (e.target && e.target.id === 'command-palette-modal') {
    closeCommandPalette();
  }
}

function renderCommandPaletteList(filter = '') {
  const list = document.getElementById('cmd-palette-list');
  if (!list) return;

  const q = (filter || '').toLowerCase().trim();
  let matches = [];

  // Eğer doğrudan bir link girilmişse "Bu linki indir" seçeneğini en üste ekle
  if (/^https?:\/\//i.test(q)) {
    matches.push({
      id: 'cmd-direct-download',
      title: `Bu Bağlantıyı Çözümle & İndir`,
      detail: q,
      icon: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
      action: () => {
        document.getElementById('url-input').value = q;
        onUrlInputChange(q);
        switchTab('indir');
        fetchInfo();
      }
    });
    matches.push({
      id: 'cmd-direct-thumb',
      title: `Bu Bağlantının Kapak Resmini İndir`,
      detail: q,
      icon: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`,
      action: () => {
        document.getElementById('thumb-url-input').value = q;
        switchTab('thumbnail');
        fetchThumbnailInfo();
      }
    });
  }

  const filteredCommands = commandPaletteItems.filter(item => {
    return item.title.toLowerCase().includes(q) || (item.shortcut && item.shortcut.toLowerCase() === q);
  });

  matches = matches.concat(filteredCommands);
  activeCmdIndex = 0;

  if (matches.length === 0) {
    list.innerHTML = `<div class="cmd-empty-msg">Eşleşen komut bulunamadı.</div>`;
    return;
  }

  list.innerHTML = matches.map((item, idx) => `
    <div class="cmd-item ${idx === 0 ? 'selected' : ''}" data-idx="${idx}" onclick="executeCmdItem(${idx})">
      <span class="cmd-item-icon">${item.icon}</span>
      <div class="cmd-item-info">
        <span class="cmd-item-title">${esc(item.title)}</span>
        ${item.detail ? `<span class="cmd-item-detail">${esc(item.detail)}</span>` : ''}
      </div>
      ${item.shortcut ? `<kbd class="cmd-item-kbd">${esc(item.shortcut)}</kbd>` : ''}
    </div>
  `).join('');

  list._matches = matches;
}

function filterCommandPalette(val) {
  renderCommandPaletteList(val);
}

function executeCmdItem(idx) {
  const list = document.getElementById('cmd-palette-list');
  if (list && list._matches && list._matches[idx]) {
    closeCommandPalette();
    list._matches[idx].action();
  }
}

function handleCmdPaletteKey(e) {
  const list = document.getElementById('cmd-palette-list');
  if (!list || !list._matches || list._matches.length === 0) return;

  const items = list.querySelectorAll('.cmd-item');

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    activeCmdIndex = (activeCmdIndex + 1) % list._matches.length;
    items.forEach((it, i) => it.classList.toggle('selected', i === activeCmdIndex));
    if (items[activeCmdIndex]) items[activeCmdIndex].scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    activeCmdIndex = (activeCmdIndex - 1 + list._matches.length) % list._matches.length;
    items.forEach((it, i) => it.classList.toggle('selected', i === activeCmdIndex));
    if (items[activeCmdIndex]) items[activeCmdIndex].scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter') {
    e.preventDefault();
    executeCmdItem(activeCmdIndex);
  } else if (e.key === 'Escape') {
    closeCommandPalette();
  }
}

// ── Global Klavye Kısayolları (⌘K / Ctrl+K) ──────────────────
document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    const modal = document.getElementById('command-palette-modal');
    if (modal && !modal.classList.contains('hidden')) {
      closeCommandPalette();
    } else {
      openCommandPalette();
    }
  } else if (e.key === 'Escape') {
    closeCommandPalette();
  }
});

// ── Enter tuşu & Yükleme ─────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  hideLogin();
  boot();
});

function boot() {
  loadDefaultPath();
  setupTrimInputs();
  setupTiltCards();
  setupCustomCursor();

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

  switchTab('indir');
}
