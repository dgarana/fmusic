export function getMobileUiHtml(): string {
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<title>fmusic</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg: #0f0f0f;
    --surface: #1a1a1a;
    --surface2: #242424;
    --border: #2e2e2e;
    --accent: #6366f1;
    --accent2: #818cf8;
    --text: #f1f1f1;
    --text2: #999;
    --text3: #666;
    --danger: #ef4444;
    --radius: 12px;
  }
  html, body { height: 100%; background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
  body { display: flex; flex-direction: column; max-width: 480px; margin: 0 auto; }

  /* Tabs */
  .tabs { display: flex; background: var(--surface); border-bottom: 1px solid var(--border); flex-shrink: 0; }
  .tab { flex: 1; padding: 14px 8px; text-align: center; font-size: 13px; font-weight: 500; color: var(--text2); cursor: pointer; transition: color .15s; border: none; background: none; }
  .tab.active { color: var(--accent2); border-bottom: 2px solid var(--accent); margin-bottom: -1px; }

  /* Content panels */
  .panel { display: none; flex: 1; overflow-y: auto; overscroll-behavior: contain; }
  .panel.active { display: flex; flex-direction: column; }

  /* ── Now Playing ── */
  .now-playing { flex: 1; display: flex; flex-direction: column; align-items: center; padding: 24px 20px 16px; gap: 20px; }
  .artwork-wrap { width: 100%; aspect-ratio: 1; max-width: 300px; border-radius: var(--radius); overflow: hidden; background: var(--surface2); flex-shrink: 0; box-shadow: 0 8px 32px rgba(0,0,0,.5); }
  .artwork-wrap img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .artwork-placeholder { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; font-size: 64px; opacity: .4; }
  .track-info { width: 100%; text-align: center; }
  .track-title { font-size: 18px; font-weight: 700; line-height: 1.3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .track-artist { font-size: 14px; color: var(--text2); margin-top: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .track-album { font-size: 12px; color: var(--text3); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  /* Seek */
  .seek-wrap { width: 100%; }
  .seek-bar { width: 100%; -webkit-appearance: none; appearance: none; height: 4px; border-radius: 2px; background: var(--border); outline: none; cursor: pointer; }
  .seek-bar::-webkit-slider-thumb { -webkit-appearance: none; width: 16px; height: 16px; border-radius: 50%; background: var(--accent2); cursor: pointer; }
  .seek-times { display: flex; justify-content: space-between; font-size: 11px; color: var(--text3); margin-top: 6px; }

  /* Controls */
  .controls { display: flex; align-items: center; justify-content: center; gap: 28px; }
  .ctrl-btn { background: none; border: none; cursor: pointer; color: var(--text2); font-size: 28px; padding: 8px; border-radius: 50%; transition: color .15s, background .15s; line-height: 1; display: flex; align-items: center; justify-content: center; }
  .ctrl-btn:active { background: var(--surface2); color: var(--text); }
  .ctrl-btn.play-btn { color: var(--text); font-size: 36px; background: var(--accent); padding: 14px; width: 64px; height: 64px; }
  .ctrl-btn.play-btn:active { background: var(--accent2); }
  .ctrl-btn:disabled { opacity: .3; pointer-events: none; }

  /* Volume */
  .volume-wrap { display: flex; align-items: center; gap: 10px; width: 100%; }
  .vol-icon { font-size: 18px; color: var(--text3); }
  .vol-slider { flex: 1; -webkit-appearance: none; appearance: none; height: 4px; border-radius: 2px; background: var(--border); outline: none; cursor: pointer; }
  .vol-slider::-webkit-slider-thumb { -webkit-appearance: none; width: 14px; height: 14px; border-radius: 50%; background: var(--text2); cursor: pointer; }

  /* Status bar */
  .status-bar { height: 32px; display: flex; align-items: center; justify-content: center; gap: 6px; font-size: 12px; color: var(--text3); flex-shrink: 0; background: var(--surface); border-top: 1px solid var(--border); }
  .status-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--text3); }
  .status-dot.connected { background: #22c55e; }
  .status-dot.error { background: var(--danger); }

  /* ── Queue ── */
  .section-header { padding: 16px 16px 8px; font-size: 12px; font-weight: 600; color: var(--text3); text-transform: uppercase; letter-spacing: .06em; }
  .track-row { display: flex; align-items: center; gap: 12px; padding: 10px 16px; cursor: pointer; transition: background .1s; border-bottom: 1px solid var(--border); }
  .track-row:active { background: var(--surface2); }
  .track-row.current { background: rgba(99,102,241,.1); }
  .track-thumb { width: 44px; height: 44px; border-radius: 6px; object-fit: cover; background: var(--surface2); flex-shrink: 0; }
  .track-thumb-placeholder { width: 44px; height: 44px; border-radius: 6px; background: var(--surface2); flex-shrink: 0; display: flex; align-items: center; justify-content: center; font-size: 18px; color: var(--text3); }
  .track-meta { flex: 1; min-width: 0; }
  .track-meta .name { font-size: 14px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .track-meta .sub { font-size: 12px; color: var(--text2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 2px; }
  .track-dur { font-size: 12px; color: var(--text3); flex-shrink: 0; }
  .empty-msg { text-align: center; color: var(--text3); font-size: 14px; padding: 48px 20px; }

  /* Library search */
  .search-wrap { padding: 12px 16px; position: sticky; top: 0; background: var(--bg); z-index: 1; border-bottom: 1px solid var(--border); }
  .search-input { width: 100%; background: var(--surface2); border: 1px solid var(--border); color: var(--text); padding: 10px 14px; border-radius: 8px; font-size: 14px; outline: none; }
  .search-input:focus { border-color: var(--accent); }
</style>
</head>
<body>

<div class="tabs">
  <button class="tab active" onclick="showTab('now-playing')">Now Playing</button>
  <button class="tab" onclick="showTab('queue')">Queue</button>
  <button class="tab" onclick="showTab('library')">Library</button>
</div>

<!-- Now Playing -->
<div id="tab-now-playing" class="panel active">
  <div class="now-playing">
    <div class="artwork-wrap" id="artwork-wrap">
      <div class="artwork-placeholder" id="artwork-placeholder">♪</div>
      <img id="artwork-img" style="display:none" alt="cover">
    </div>
    <div class="track-info">
      <div class="track-title" id="track-title">Nothing playing</div>
      <div class="track-artist" id="track-artist">—</div>
      <div class="track-album" id="track-album"></div>
    </div>
    <div class="seek-wrap">
      <input class="seek-bar" id="seek-bar" type="range" min="0" max="100" value="0" step="0.1">
      <div class="seek-times">
        <span id="pos-time">0:00</span>
        <span id="dur-time">0:00</span>
      </div>
    </div>
    <div class="controls">
      <button class="ctrl-btn" id="btn-prev" onclick="send({type:'prev'})" title="Previous">⏮</button>
      <button class="ctrl-btn play-btn" id="btn-play" onclick="send({type:'play'})" title="Play/Pause">▶</button>
      <button class="ctrl-btn" id="btn-next" onclick="send({type:'next'})" title="Next">⏭</button>
    </div>
    <div class="volume-wrap">
      <span class="vol-icon">🔉</span>
      <input class="vol-slider" id="vol-slider" type="range" min="0" max="1" step="0.01" value="0.9">
      <span class="vol-icon">🔊</span>
    </div>
  </div>
</div>

<!-- Queue -->
<div id="tab-queue" class="panel">
  <div class="section-header">Up Next</div>
  <div id="queue-list"></div>
</div>

<!-- Library -->
<div id="tab-library" class="panel">
  <div class="search-wrap">
    <input class="search-input" id="lib-search" placeholder="Search library…" oninput="filterLibrary(this.value)">
  </div>
  <div id="library-list"></div>
</div>

<div class="status-bar">
  <div class="status-dot" id="status-dot"></div>
  <span id="status-text">Connecting…</span>
</div>

<script>
(function () {
  const params = new URLSearchParams(location.search);
  const token = params.get('token') || '';
  const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = wsProto + '//' + location.host + '/ws?token=' + token;

  let state = null;
  let ws = null;
  let seekDragging = false;
  let allTracks = [];

  // ── WebSocket ──────────────────────────────────────────────
  function connect() {
    ws = new WebSocket(wsUrl);

    ws.onopen = () => setStatus('connected', 'Connected');

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'state') {
          state = msg.data;
          render();
        }
      } catch {}
    };

    ws.onclose = () => {
      setStatus('error', 'Disconnected — retrying…');
      setTimeout(connect, 3000);
    };

    ws.onerror = () => {
      setStatus('error', 'Connection error');
    };
  }

  function send(cmd) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(cmd));
    }
  }

  window.send = send;

  // ── Status bar ────────────────────────────────────────────
  function setStatus(type, text) {
    const dot = document.getElementById('status-dot');
    dot.className = 'status-dot ' + type;
    document.getElementById('status-text').textContent = text;
  }

  // ── Helpers ───────────────────────────────────────────────
  function fmt(sec) {
    if (!sec || !isFinite(sec)) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return m + ':' + String(s).padStart(2, '0');
  }

  function thumbUrl(trackId) {
    return '/thumbnail/' + trackId + '?token=' + token;
  }

  function thumbOrPlaceholder(track, size) {
    if (track && track.thumbnailPath) {
      return '<img class="track-thumb' + (size === 'large' ? '' : '') + '" src="' + thumbUrl(track.id) + '" onerror="this.style.display=\'none\'" alt="">';
    }
    return '<div class="track-thumb-placeholder">♪</div>';
  }

  // ── Render ────────────────────────────────────────────────
  function render() {
    if (!state) return;

    const { current, isPlaying, position, duration, volume, queue, queueIndex } = state;

    // Artwork
    const img = document.getElementById('artwork-img');
    const ph = document.getElementById('artwork-placeholder');
    if (current && current.thumbnailPath) {
      img.src = thumbUrl(current.id);
      img.style.display = 'block';
      ph.style.display = 'none';
    } else {
      img.style.display = 'none';
      ph.style.display = 'flex';
    }

    // Track info
    document.getElementById('track-title').textContent = current ? current.title : 'Nothing playing';
    document.getElementById('track-artist').textContent = current ? (current.artist || '—') : '—';
    document.getElementById('track-album').textContent = current ? (current.album || '') : '';

    // Play/pause button
    document.getElementById('btn-play').textContent = isPlaying ? '⏸' : '▶';
    document.getElementById('btn-play').title = isPlaying ? 'Pause' : 'Play';
    document.getElementById('btn-play').onclick = () => send({ type: isPlaying ? 'pause' : 'play' });

    // Seek bar
    if (!seekDragging) {
      const pct = duration > 0 ? (position / duration) * 100 : 0;
      document.getElementById('seek-bar').value = pct;
    }
    document.getElementById('pos-time').textContent = fmt(position);
    document.getElementById('dur-time').textContent = fmt(duration);
    document.getElementById('seek-bar').max = 100;

    // Volume
    const volSlider = document.getElementById('vol-slider');
    if (document.activeElement !== volSlider) {
      volSlider.value = volume;
    }

    // Queue list
    const ql = document.getElementById('queue-list');
    if (!queue || queue.length === 0) {
      ql.innerHTML = '<div class="empty-msg">Queue is empty</div>';
    } else {
      ql.innerHTML = queue.map((t, i) => {
        const active = i === queueIndex ? ' current' : '';
        return '<div class="track-row' + active + '" onclick="send({type:\'play-track\',trackId:' + t.id + '})">' +
          thumbOrPlaceholder(t) +
          '<div class="track-meta">' +
            '<div class="name">' + esc(t.title) + '</div>' +
            '<div class="sub">' + esc(t.artist || '—') + '</div>' +
          '</div>' +
          '<div class="track-dur">' + fmt(t.durationSec) + '</div>' +
        '</div>';
      }).join('');
    }
  }

  // ── Seek bar events ───────────────────────────────────────
  const seekBar = document.getElementById('seek-bar');
  seekBar.addEventListener('mousedown', () => { seekDragging = true; });
  seekBar.addEventListener('touchstart', () => { seekDragging = true; }, { passive: true });
  seekBar.addEventListener('change', () => {
    seekDragging = false;
    if (!state || !state.duration) return;
    const secs = (parseFloat(seekBar.value) / 100) * state.duration;
    send({ type: 'seek', position: secs });
  });
  seekBar.addEventListener('mouseup', () => { seekDragging = false; });

  // ── Volume slider ─────────────────────────────────────────
  document.getElementById('vol-slider').addEventListener('input', function () {
    send({ type: 'volume', value: parseFloat(this.value) });
  });

  // ── Library ───────────────────────────────────────────────
  function renderLibrary(tracks) {
    const el = document.getElementById('library-list');
    if (!tracks || tracks.length === 0) {
      el.innerHTML = '<div class="empty-msg">Library is empty</div>';
      return;
    }
    el.innerHTML = tracks.map((t) =>
      '<div class="track-row" onclick="send({type:\'play-track\',trackId:' + t.id + '})">' +
        thumbOrPlaceholder(t) +
        '<div class="track-meta">' +
          '<div class="name">' + esc(t.title) + '</div>' +
          '<div class="sub">' + esc(t.artist || '—') + '</div>' +
        '</div>' +
        '<div class="track-dur">' + fmt(t.durationSec) + '</div>' +
      '</div>'
    ).join('');
  }

  function filterLibrary(q) {
    const lower = q.toLowerCase();
    const filtered = lower
      ? allTracks.filter(t =>
          t.title.toLowerCase().includes(lower) ||
          (t.artist && t.artist.toLowerCase().includes(lower)) ||
          (t.album && t.album.toLowerCase().includes(lower))
        )
      : allTracks;
    renderLibrary(filtered);
  }

  window.filterLibrary = filterLibrary;

  async function loadLibrary() {
    try {
      const res = await fetch('/api/tracks?token=' + token);
      allTracks = await res.json();
      renderLibrary(allTracks);
    } catch {
      document.getElementById('library-list').innerHTML = '<div class="empty-msg">Failed to load library</div>';
    }
  }

  // ── Tabs ──────────────────────────────────────────────────
  let libraryLoaded = false;
  window.showTab = function (name) {
    document.querySelectorAll('.tab').forEach((t, i) => {
      const names = ['now-playing', 'queue', 'library'];
      t.classList.toggle('active', names[i] === name);
    });
    document.querySelectorAll('.panel').forEach(p => {
      p.classList.toggle('active', p.id === 'tab-' + name);
    });
    if (name === 'library' && !libraryLoaded) {
      libraryLoaded = true;
      loadLibrary();
    }
  };

  // ── Escape HTML ───────────────────────────────────────────
  function esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  connect();
})();
</script>
</body>
</html>`;
}
