/* Musii – kostenloser Musik-Player
 * Musikquelle: Audius Open API (frei & legal, komplette Songs unabhängiger Artists, kein API-Key nötig)
 * plus eigene Audiodateien (bleiben lokal im Browser via IndexedDB).
 */
(() => {
  'use strict';

  const API = 'https://api.audius.co/v1';
  const APP = 'app_name=musii';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const view = $('#view');
  const audio = $('#audio');

  const ICON_PLAY = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
  const ICON_PAUSE = '<svg viewBox="0 0 24 24"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>';
  const FALLBACK_ART = 'icon.svg';

  const GENRES = [
    ['Electronic', '#7c3aed', '⚡'], ['Hip-Hop/Rap', '#e11d48', '🎤'], ['Pop', '#db2777', '✨'],
    ['Lo-Fi', '#0891b2', '☕'], ['House', '#ea580c', '🏠'], ['Techno', '#4f46e5', '🔊'],
    ['Rock', '#b91c1c', '🎸'], ['R&B/Soul', '#9333ea', '💜'], ['Ambient', '#0f766e', '🌙'],
    ['Alternative', '#65a30d', '🌀'], ['Drum & Bass', '#c2410c', '🥁'], ['Dubstep', '#1d4ed8', '💥'],
    ['Jazz', '#a16207', '🎷'], ['Classical', '#57534e', '🎻'], ['Latin', '#dc2626', '💃'],
    ['Trap', '#6d28d9', '🔥'], ['Folk', '#854d0e', '🪕'], ['Acoustic', '#15803d', '🎶'],
    ['Reggae', '#16a34a', '🌴'], ['Metal', '#3f3f46', '🤘'], ['Funk', '#c026d3', '🕺'],
    ['Soundtrack', '#334155', '🎬'], ['Deep House', '#0e7490', '🌊'], ['Experimental', '#be185d', '🧪'],
  ];

  /* ---------------- Storage ---------------- */
  const store = {
    get(k, d) { try { const v = localStorage.getItem('musii:' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem('musii:' + k, JSON.stringify(v)); } catch {} },
  };
  let liked = store.get('liked', []);
  let playlists = store.get('playlists', []);
  let recent = store.get('recent', []);

  // IndexedDB für eigene Dateien
  const idb = {
    db: null,
    open() {
      if (this.db) return Promise.resolve(this.db);
      return new Promise((res, rej) => {
        const r = indexedDB.open('musii', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('files', { keyPath: 'id' });
        r.onsuccess = () => { this.db = r.result; res(this.db); };
        r.onerror = () => rej(r.error);
      });
    },
    async tx(mode, fn) {
      const db = await this.open();
      return new Promise((res, rej) => {
        const t = db.transaction('files', mode);
        const req = fn(t.objectStore('files'));
        t.oncomplete = () => res(req && req.result);
        t.onerror = () => rej(t.error);
      });
    },
    all() { return this.tx('readonly', s => s.getAll()); },
    put(v) { return this.tx('readwrite', s => s.put(v)); },
    del(id) { return this.tx('readwrite', s => s.delete(id)); },
  };
  const localUrls = new Map();

  /* ---------------- API ---------------- */
  const cache = new Map();
  async function api(path) {
    const url = `${API}${path}${path.includes('?') ? '&' : '?'}${APP}`;
    if (cache.has(url)) return cache.get(url);
    const p = fetch(url).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }).then(j => j.data);
    cache.set(url, p);
    p.catch(() => cache.delete(url));
    return p;
  }
  const art = (o, size = '480x480') => (o && (o[size] || o['480x480'] || o['150x150'] || o['1000x1000'])) || FALLBACK_ART;
  const normTrack = t => ({
    id: t.id, title: t.title, artist: t.user?.name || 'Unbekannt', artistId: t.user?.id,
    art: art(t.artwork), artBig: art(t.artwork, '1000x1000'), duration: t.duration || 0, genre: t.genre || '',
    plays: t.play_count || 0,
  });
  const playable = t => !t.is_stream_gated && !t.is_unlisted && t.is_streamable !== false;
  const tracksOf = list => (list || []).filter(playable).map(normTrack);
  const srcOf = t => t.local ? localUrls.get(t.id) : `${API}/tracks/${t.id}/stream?${APP}`;

  /* ---------------- Helpers ---------------- */
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = s => { s = Math.max(0, Math.floor(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const fmtNum = n => n >= 1e6 ? (n / 1e6).toFixed(1).replace('.0', '') + ' Mio.' : n >= 1e3 ? (n / 1e3).toFixed(1).replace('.0', '') + 'K' : String(n || 0);
  const totalDur = list => { const m = Math.round(list.reduce((a, t) => a + (t.duration || 0), 0) / 60); return m >= 60 ? `${Math.floor(m / 60)} Std. ${m % 60} Min.` : `${m} Min.`; };
  const uid = () => Math.random().toString(36).slice(2, 10);
  let toastTimer;
  function toast(msg) {
    const el = $('#toast'); el.textContent = msg; el.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }
  const greeting = () => { const h = new Date().getHours(); return h < 5 ? 'Gute Nacht' : h < 11 ? 'Guten Morgen' : h < 18 ? 'Guten Tag' : 'Guten Abend'; };

  /* ---------------- Player ---------------- */
  const P = {
    queue: [], index: -1, original: [], shuffle: store.get('shuffle', false), repeat: store.get('repeat', 0), // 0 aus, 1 alle, 2 eins
    get current() { return this.queue[this.index]; },
  };
  // Registry: Listen, die in der aktuellen Ansicht gerendert werden
  const lists = {};

  function playList(list, start = 0) {
    if (!list || !list.length) return;
    P.original = list.slice();
    if (P.shuffle) {
      const first = list[start];
      const rest = list.filter((_, i) => i !== start).sort(() => Math.random() - 0.5);
      P.queue = [first, ...rest]; P.index = 0;
    } else { P.queue = list.slice(); P.index = start; }
    load(true);
  }
  function load(autoplay) {
    const t = P.current; if (!t) return;
    const src = srcOf(t);
    if (!src) { toast('Datei nicht verfügbar'); return next(); }
    audio.src = src;
    if (autoplay) audio.play().catch(() => {});
    updateNow();
    recent = [t, ...recent.filter(x => x.id !== t.id)].slice(0, 30);
    if (!t.local) store.set('recent', recent.filter(x => !x.local));
    renderQueue(); markPlaying();
  }
  function toggle() {
    if (!P.current) { const l = Object.values(lists)[0]; if (l) playList(l); return; }
    audio.paused ? audio.play().catch(() => {}) : audio.pause();
  }
  function next(manual = true) {
    if (!P.queue.length) return;
    if (!manual && P.repeat === 2) { audio.currentTime = 0; audio.play(); return; }
    if (P.index < P.queue.length - 1) P.index++;
    else if (P.repeat === 1 || manual) P.index = 0;
    else { audio.pause(); return; }
    load(true);
  }
  function prev() {
    if (audio.currentTime > 3) { audio.currentTime = 0; return; }
    if (P.index > 0) P.index--; else P.index = P.queue.length - 1;
    load(true);
  }
  function setShuffle(on) {
    P.shuffle = on; store.set('shuffle', on);
    $('#shuffleBtn').classList.toggle('on', on);
    if (!P.current) return;
    const cur = P.current;
    if (on) { const rest = P.queue.filter(t => t !== cur).sort(() => Math.random() - 0.5); P.queue = [cur, ...rest]; P.index = 0; }
    else { P.queue = P.original.slice(); P.index = Math.max(0, P.queue.findIndex(t => t.id === cur.id)); }
    renderQueue();
  }
  function setRepeat(v) {
    P.repeat = v; store.set('repeat', v);
    $('#repeatBtn').classList.toggle('on', v > 0); $('#repeatOne').hidden = v !== 2;
  }
  function addToQueue(t, nextUp) {
    if (!P.current) return playList([t]);
    const copy = { ...t };
    if (nextUp) P.queue.splice(P.index + 1, 0, copy); else P.queue.push(copy);
    P.original.push(copy);
    renderQueue(); toast(nextUp ? 'Wird als Nächstes gespielt' : 'Zur Warteschlange hinzugefügt');
  }

  function updateNow() {
    const t = P.current; if (!t) return;
    $('#npArt').src = t.art; $('#npTitle').textContent = t.title;
    $('#npArtist').innerHTML = t.artistId ? `<a href="#/artist/${esc(t.artistId)}">${esc(t.artist)}</a>` : esc(t.artist);
    $('#fsArt').src = t.artBig || t.art; $('#fsTitle').textContent = t.title; $('#fsArtist').textContent = t.artist;
    $('#fsBg').style.backgroundImage = `url("${t.artBig || t.art}")`;
    document.title = `${t.title} · ${t.artist} – Musii`;
    updateLikeBtn();
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: t.title, artist: t.artist, album: 'Musii',
        artwork: [{ src: t.artBig || t.art, sizes: '480x480', type: 'image/jpeg' }],
      });
    }
  }
  function updateLikeBtn() {
    const t = P.current; const b = $('#npLike');
    const on = t && isLiked(t.id); b.textContent = on ? '♥' : '♡'; b.classList.toggle('on', !!on);
  }
  function setRange(el, pct) { el.style.setProperty('--p', pct + '%'); }

  let seeking = false;
  audio.addEventListener('timeupdate', () => {
    if (seeking || !audio.duration) return;
    const p = audio.currentTime / audio.duration * 1000;
    $('#seek').value = p; setRange($('#seek'), p / 10);
    $('#curTime').textContent = fmt(audio.currentTime);
  });
  audio.addEventListener('loadedmetadata', () => { $('#durTime').textContent = fmt(audio.duration); });
  audio.addEventListener('play', () => { $('#playBtn').innerHTML = ICON_PAUSE; document.body.classList.remove('paused'); markPlaying(); startViz(); });
  audio.addEventListener('pause', () => { $('#playBtn').innerHTML = ICON_PLAY; document.body.classList.add('paused'); markPlaying(); });
  audio.addEventListener('ended', () => next(false));
  audio.addEventListener('error', () => { if (P.current) { toast('Song konnte nicht geladen werden – nächster…'); setTimeout(() => next(false), 800); } });

  $('#seek').addEventListener('input', e => { seeking = true; setRange(e.target, e.target.value / 10); $('#curTime').textContent = fmt(e.target.value / 1000 * (audio.duration || 0)); });
  $('#seek').addEventListener('change', e => { if (audio.duration) audio.currentTime = e.target.value / 1000 * audio.duration; seeking = false; });
  const vol = $('#volume');
  function setVolume(v) { v = Math.min(100, Math.max(0, v)); audio.volume = v / 100; vol.value = v; setRange(vol, v); store.set('volume', v); audio.muted = false; }
  vol.addEventListener('input', e => setVolume(+e.target.value));
  setVolume(store.get('volume', 80));
  $('#muteBtn').onclick = () => { audio.muted = !audio.muted; $('#muteBtn').classList.toggle('on', audio.muted); setRange(vol, audio.muted ? 0 : vol.value); };
  $('#playBtn').onclick = toggle;
  $('#nextBtn').onclick = () => next(true);
  $('#prevBtn').onclick = prev;
  $('#shuffleBtn').onclick = () => setShuffle(!P.shuffle);
  $('#repeatBtn').onclick = () => setRepeat((P.repeat + 1) % 3);
  $('#npLike').onclick = () => P.current && toggleLike(P.current);
  setShuffle(P.shuffle); setRepeat(P.repeat);

  if ('mediaSession' in navigator) {
    const ms = navigator.mediaSession;
    ms.setActionHandler('play', () => audio.play());
    ms.setActionHandler('pause', () => audio.pause());
    ms.setActionHandler('nexttrack', () => next(true));
    ms.setActionHandler('previoustrack', prev);
    try { ms.setActionHandler('seekto', d => { audio.currentTime = d.seekTime; }); } catch {}
  }

  document.addEventListener('keydown', e => {
    if (e.target.matches('input, textarea')) return;
    if (e.code === 'Space') { e.preventDefault(); toggle(); }
    else if (e.code === 'ArrowRight' && e.shiftKey) next(true);
    else if (e.code === 'ArrowLeft' && e.shiftKey) prev();
    else if (e.code === 'ArrowRight') audio.currentTime += 5;
    else if (e.code === 'ArrowLeft') audio.currentTime -= 5;
    else if (e.code === 'ArrowUp') { e.preventDefault(); setVolume(+vol.value + 5); }
    else if (e.code === 'ArrowDown') { e.preventDefault(); setVolume(+vol.value - 5); }
    else if (e.key === 's') setShuffle(!P.shuffle);
    else if (e.key === 'r') setRepeat((P.repeat + 1) % 3);
    else if (e.key === 'm') $('#muteBtn').click();
    else if (e.key === 'l' && P.current) toggleLike(P.current);
    else if (e.key === 'f') toggleFullscreen();
    else if (e.key === '/') { e.preventDefault(); $('#searchInput').focus(); }
    else if (e.key === 'Escape') { $('#fullscreen').hidden = true; hideMenu(); }
  });

  /* ---------------- Queue panel ---------------- */
  $('#queueBtn').onclick = () => { const q = $('#queuePanel'); q.hidden = !q.hidden; $('#queueBtn').classList.toggle('on', !q.hidden); renderQueue(); };
  $('#closeQueue').onclick = () => { $('#queuePanel').hidden = true; $('#queueBtn').classList.remove('on'); };
  function renderQueue() {
    const panel = $('#queuePanel'); if (panel.hidden) return;
    const box = $('#queueList');
    if (!P.current) { box.innerHTML = '<p class="muted">Die Warteschlange ist leer.</p>'; return; }
    const item = (t, i, cls = '') => `<div class="qitem ${cls}" data-i="${i}"><img src="${esc(t.art)}" alt="" loading="lazy"><div><div class="qt">${esc(t.title)}</div><div class="qa">${esc(t.artist)}</div></div></div>`;
    const upcoming = P.queue.slice(P.index + 1, P.index + 51);
    box.innerHTML = `<div class="qlabel">Läuft gerade</div>${item(P.current, P.index, 'current')}
      <div class="qlabel">Als Nächstes</div>${upcoming.map((t, k) => item(t, P.index + 1 + k)).join('') || '<p class="muted">Nichts mehr in der Warteschlange.</p>'}`;
    $$('.qitem', box).forEach(el => el.onclick = () => { P.index = +el.dataset.i; load(true); });
  }

  /* ---------------- Fullscreen + Visualizer ---------------- */
  function toggleFullscreen() { if (!P.current) return; const f = $('#fullscreen'); f.hidden = !f.hidden; if (!f.hidden) startViz(); }
  $('#fullBtn').onclick = toggleFullscreen; $('#fsClose').onclick = toggleFullscreen; $('#npArt').onclick = toggleFullscreen;

  let actx, analyser, vizOn = false;
  function startViz() {
    if ($('#fullscreen').hidden) return;
    try {
      if (!actx) {
        actx = new (window.AudioContext || window.webkitAudioContext)();
        const srcNode = actx.createMediaElementSource(audio);
        analyser = actx.createAnalyser(); analyser.fftSize = 256;
        srcNode.connect(analyser); analyser.connect(actx.destination);
      }
      if (actx.state === 'suspended') actx.resume();
    } catch { return; }
    if (vizOn) return; vizOn = true;
    const c = $('#viz'), g = c.getContext('2d'); const data = new Uint8Array(analyser.frequencyBinCount);
    const draw = () => {
      if ($('#fullscreen').hidden) { vizOn = false; return; }
      requestAnimationFrame(draw);
      const w = c.width = c.clientWidth * devicePixelRatio, h = c.height = c.clientHeight * devicePixelRatio;
      analyser.getByteFrequencyData(data);
      const cx = w / 2, cy = h / 2, r = Math.min(w, h) * 0.34, n = 96;
      g.clearRect(0, 0, w, h);
      for (let i = 0; i < n; i++) {
        const v = data[Math.floor(i / n * data.length * 0.75)] / 255;
        const a = i / n * Math.PI * 2 - Math.PI / 2, len = r * 0.08 + v * r * 0.45;
        g.strokeStyle = `hsla(${330 - i / n * 70}, 90%, 65%, ${0.35 + v * 0.65})`;
        g.lineWidth = 4 * devicePixelRatio; g.lineCap = 'round';
        g.beginPath(); g.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        g.lineTo(cx + Math.cos(a) * (r + len), cy + Math.sin(a) * (r + len)); g.stroke();
      }
    };
    draw();
  }

  /* ---------------- Likes & Playlists ---------------- */
  const isLiked = id => liked.some(t => t.id === id);
  function toggleLike(t) {
    if (t.local) { toast('Eigene Dateien findest du unter „Eigene Dateien“'); return; }
    if (isLiked(t.id)) { liked = liked.filter(x => x.id !== t.id); toast('Aus Lieblingssongs entfernt'); }
    else { liked = [{ ...t }, ...liked]; toast('Zu Lieblingssongs hinzugefügt ♥'); }
    store.set('liked', liked); updateLikeBtn();
    $$(`.like-btn[data-id="${CSS.escape(t.id)}"]`).forEach(b => { const on = isLiked(t.id); b.classList.toggle('on', on); b.textContent = on ? '♥' : '♡'; });
    if (location.hash === '#/liked') route();
  }
  function savePlaylists() { store.set('playlists', playlists); renderSidePlaylists(); }
  function createPlaylist(name, tracks = []) {
    const p = { id: uid(), name: name || `Meine Playlist Nr. ${playlists.length + 1}`, tracks, created: Date.now() };
    playlists.unshift(p); savePlaylists(); return p;
  }
  function addToPlaylist(p, t) {
    if (p.tracks.some(x => x.id === t.id)) { toast('Schon in der Playlist'); return; }
    p.tracks.push({ ...t }); savePlaylists(); toast(`Zu „${p.name}“ hinzugefügt`);
  }
  function renderSidePlaylists() {
    $('#sidePlaylists').innerHTML = playlists.map(p => `<a href="#/my/${p.id}">${esc(p.name)}</a>`).join('');
  }
  $('#newPlaylistBtn').onclick = () => { const p = createPlaylist(); location.hash = `#/my/${p.id}`; toast('Playlist erstellt'); };

  /* ---------------- Context menu ---------------- */
  function hideMenu() { $('#menu').hidden = true; }
  document.addEventListener('click', e => { if (!e.target.closest('#menu') && !e.target.closest('.more')) hideMenu(); });
  function showMenu(x, y, items) {
    const m = $('#menu');
    m.innerHTML = items.map((it, i) => it === '-' ? '<hr>' : `<button data-i="${i}">${esc(it.label)}</button>`).join('');
    m.hidden = false;
    const r = m.getBoundingClientRect();
    m.style.left = Math.min(x, innerWidth - r.width - 8) + 'px';
    m.style.top = Math.min(y, innerHeight - r.height - 8) + 'px';
    $$('button', m).forEach(b => b.onclick = () => { hideMenu(); items[+b.dataset.i].fn(); });
  }
  function trackMenu(t, x, y, ctx) {
    const items = [
      { label: '▶ Abspielen', fn: () => playList([t]) },
      { label: '⏭ Als Nächstes spielen', fn: () => addToQueue(t, true) },
      { label: '☰ Zur Warteschlange', fn: () => addToQueue(t, false) },
    ];
    if (!t.local) items.push({ label: isLiked(t.id) ? '♡ Aus Lieblingssongs entfernen' : '♥ Zu Lieblingssongs', fn: () => toggleLike(t) });
    items.push('-', { label: '＋ Neue Playlist mit diesem Song', fn: () => { const p = createPlaylist(t.title, [{ ...t }]); toast(`Playlist „${p.name}“ erstellt`); } });
    playlists.forEach(p => items.push({ label: `→ ${p.name}`, fn: () => addToPlaylist(p, t) }));
    if (ctx?.playlist) items.push('-', { label: '✕ Aus dieser Playlist entfernen', fn: () => { ctx.playlist.tracks = ctx.playlist.tracks.filter(x => x.id !== t.id); savePlaylists(); route(); } });
    if (t.local) items.push('-', { label: '🗑 Datei aus Musii löschen', fn: async () => { await idb.del(t.id); route(); toast('Datei gelöscht'); } });
    if (t.artistId) items.push('-', { label: '👤 Zum Artist', fn: () => location.hash = `#/artist/${t.artistId}` });
    showMenu(x, y, items);
  }

  /* ---------------- Rendering ---------------- */
  function trackTable(key, list, opts = {}) {
    lists[key] = list;
    if (!list.length) return `<div class="empty"><div class="big">🎧</div><p>${opts.emptyText || 'Keine Songs gefunden.'}</p></div>`;
    const head = `<div class="trow thead"><div class="num">#</div><div>Titel</div><div class="genre-cell">Genre</div><div></div><div class="dur">⏱</div><div></div></div>`;
    return `<div class="tracks" data-list="${key}">${opts.noHead ? '' : head}${list.map((t, i) => `
      <div class="trow" data-i="${i}" data-id="${esc(t.id)}">
        <div class="num"><span class="n">${i + 1}</span><span class="pi">▶</span></div>
        <div class="main-cell"><img src="${esc(t.art)}" alt="" loading="lazy"><div style="min-width:0"><div class="tt">${esc(t.title)}</div>
          <div class="ta">${t.artistId ? `<a href="#/artist/${esc(t.artistId)}">${esc(t.artist)}</a>` : esc(t.artist)}</div></div></div>
        <div class="genre-cell">${esc(t.genre)}</div>
        <button class="icon like-btn ${isLiked(t.id) ? 'on' : ''}" data-id="${esc(t.id)}" title="Gefällt mir">${isLiked(t.id) ? '♥' : '♡'}</button>
        <div class="dur">${fmt(t.duration)}</div>
        <button class="icon more" title="Mehr">⋯</button>
      </div>`).join('')}</div>`;
  }
  view.addEventListener('click', e => {
    const row = e.target.closest('.trow:not(.thead)'); if (!row) return;
    const key = row.closest('.tracks').dataset.list; const list = lists[key]; const i = +row.dataset.i; const t = list[i];
    if (e.target.closest('a')) return;
    if (e.target.closest('.like-btn')) return toggleLike(t);
    if (e.target.closest('.more')) { const r = e.target.getBoundingClientRect(); return trackMenu(t, r.left - 180, r.bottom, viewCtx); }
    if (matchMedia('(max-width: 860px)').matches || e.target.closest('.num')) return playList(list, i);
  });
  view.addEventListener('dblclick', e => {
    const row = e.target.closest('.trow:not(.thead)'); if (!row || e.target.closest('button, a')) return;
    playList(lists[row.closest('.tracks').dataset.list], +row.dataset.i);
  });
  view.addEventListener('contextmenu', e => {
    const row = e.target.closest('.trow:not(.thead)'); if (!row) return;
    e.preventDefault(); trackMenu(lists[row.closest('.tracks').dataset.list][+row.dataset.i], e.clientX, e.clientY, viewCtx);
  });

  function markPlaying() {
    const cur = P.current;
    $$('.trow').forEach(r => {
      const on = cur && r.dataset.id === String(cur.id);
      r.classList.toggle('playing', !!on);
      const n = $('.n', r); if (!n) return;
      n.innerHTML = on && !audio.paused ? '<span class="eq"><i></i><i></i><i></i></span>' : String(+r.dataset.i + 1);
    });
  }

  const PLAY_SVG = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
  function card({ href, img, title, sub, round, play }) {
    return `<div class="card ${round ? 'round-art' : ''}" data-href="${esc(href)}">
      <div class="cover"><img src="${esc(img)}" alt="" loading="lazy" onerror="this.src='${FALLBACK_ART}'"></div>
      ${play ? `<button class="fab" data-play="${esc(play)}" aria-label="Abspielen">${PLAY_SVG}</button>` : ''}
      <div class="t">${esc(title)}</div><div class="s">${esc(sub)}</div></div>`;
  }
  view.addEventListener('click', async e => {
    const fab = e.target.closest('[data-play]');
    if (fab) {
      e.stopPropagation();
      const [kind, id] = fab.dataset.play.split(':');
      try {
        const l = kind === 'playlist' ? tracksOf(await api(`/playlists/${id}/tracks`))
          : kind === 'artist' ? tracksOf(await api(`/users/${id}/tracks?sort=plays&limit=50`))
          : kind === 'genre' ? tracksOf(await api(`/tracks/trending?genre=${encodeURIComponent(id)}&limit=50`))
          : kind === 'list' ? lists[id] : [];
        l && l.length ? playList(l) : toast('Keine abspielbaren Songs');
      } catch { toast('Laden fehlgeschlagen'); }
      return;
    }
    const c = e.target.closest('.card[data-href]'); if (c) location.hash = c.dataset.href;
  });

  const skeletonRow = n => `<div class="row">${Array.from({ length: n }, () => '<div class="skeleton" style="height:230px"></div>').join('')}</div>`;
  const trackCards = (key, list) => { lists[key] = list; return list.map((t, i) => card({ href: t.artistId ? `#/artist/${t.artistId}` : '#/home', img: t.art, title: t.title, sub: t.artist, play: `track:${key}:${i}` })).join(''); };
  // Einzelne Tracks über Karten abspielen
  view.addEventListener('click', e => {
    const fab = e.target.closest('[data-play^="track:"]'); if (!fab) return;
    e.stopImmediatePropagation();
    const [, key, i] = fab.dataset.play.split(':'); playList(lists[key], +i);
  }, true);

  async function section(el, fn) {
    try { el.innerHTML = await fn(); markPlaying(); }
    catch (err) { el.innerHTML = `<p class="muted">Konnte nicht geladen werden. <button class="pill" onclick="location.reload()">Neu laden</button></p>`; }
  }

  /* ---------------- Views ---------------- */
  let viewCtx = null;

  async function vHome() {
    const quick = [
      `<a href="#/liked"><div class="tile" style="font-size:24px">♥</div>Lieblingssongs</a>`,
      ...playlists.slice(0, 3).map(p => `<a href="#/my/${p.id}"><img src="${esc(p.tracks[0]?.art || FALLBACK_ART)}" alt="">${esc(p.name)}</a>`),
      ...recent.slice(0, 5 - Math.min(3, playlists.length)).map((t, i) => `<a href="#" data-recent="${i}"><img src="${esc(t.art)}" alt="">${esc(t.title)}</a>`),
    ].slice(0, 6);
    view.innerHTML = `
      <div class="hero"><h1>${greeting()}! 👋</h1>
        <p>Millionen Songs von unabhängigen Artists – komplett kostenlos, ohne Werbung, ohne Abo. Dazu kannst du deine eigenen Musikdateien abspielen.</p>
        <button class="btn" id="heroPlay">▶ Trending abspielen</button></div>
      <div class="quick">${quick.join('')}</div>
      <h2 class="section">🔥 Trending diese Woche <a href="#/charts">Alle anzeigen</a></h2><div id="s1">${skeletonRow(6)}</div>
      ${recent.length ? `<h2 class="section">Zuletzt gehört</h2><div class="row" id="sRecent"></div>` : ''}
      <h2 class="section">🎧 Beliebte Playlists</h2><div id="s2">${skeletonRow(6)}</div>
      <h2 class="section">💎 Underground-Hits</h2><div id="s3">${skeletonRow(6)}</div>
      <h2 class="section">🌙 Lo-Fi & Chill</h2><div id="s4">${skeletonRow(6)}</div>
      <h2 class="section">⚡ Electronic</h2><div id="s5">${skeletonRow(6)}</div>
      <h2 class="section">🎤 Hip-Hop</h2><div id="s6">${skeletonRow(6)}</div>`;
    $$('[data-recent]').forEach(a => a.onclick = e => { e.preventDefault(); playList(recent, +a.dataset.recent); });
    if (recent.length) $('#sRecent').innerHTML = trackCards('recent', recent.slice(0, 12));
    $('#heroPlay').onclick = async () => { try { playList(tracksOf(await api('/tracks/trending?time=week&limit=50'))); } catch { toast('Laden fehlgeschlagen'); } };
    section($('#s1'), async () => `<div class="row">${trackCards('trend', tracksOf(await api('/tracks/trending?time=week&limit=20')))}</div>`);
    section($('#s2'), async () => `<div class="row">${(await api('/playlists/trending?limit=20')).map(p => card({ href: `#/playlist/${p.id}`, img: art(p.artwork), title: p.playlist_name, sub: `von ${p.user?.name || ''}`, play: `playlist:${p.id}` })).join('')}</div>`);
    section($('#s3'), async () => `<div class="row">${trackCards('under', tracksOf(await api('/tracks/trending/underground?limit=20')))}</div>`);
    section($('#s4'), async () => `<div class="row">${trackCards('lofi', tracksOf(await api('/tracks/trending?genre=Lo-Fi&time=month&limit=20')))}</div>`);
    section($('#s5'), async () => `<div class="row">${trackCards('elec', tracksOf(await api('/tracks/trending?genre=Electronic&time=week&limit=20')))}</div>`);
    section($('#s6'), async () => `<div class="row">${trackCards('hiphop', tracksOf(await api('/tracks/trending?genre=Hip-Hop%2FRap&time=week&limit=20')))}</div>`);
  }

  async function vCharts() {
    view.innerHTML = `<h1>🔥 Charts</h1><div class="tabs" id="tabs">
      <button data-t="week" class="on">Diese Woche</button><button data-t="month">Dieser Monat</button><button data-t="allTime">Allzeit</button></div><div id="list"></div>`;
    const load = time => section($('#list'), async () => trackTable('charts', tracksOf(await api(`/tracks/trending?time=${time}&limit=100`))));
    $$('#tabs button').forEach(b => b.onclick = () => { $$('#tabs button').forEach(x => x.classList.remove('on')); b.classList.add('on'); load(b.dataset.t); });
    load('week');
  }

  let searchTimer;
  async function vSearch(q) {
    $('#searchInput').value = q || '';
    if (!q) {
      view.innerHTML = `<h1>Alle durchsuchen</h1><div class="genres">${GENRES.map(([g, c, e]) =>
        `<a class="genre" style="background:${c}" href="#/genre/${encodeURIComponent(g)}">${esc(g)}<span>${e}</span></a>`).join('')}</div>`;
      return;
    }
    view.innerHTML = `<h1>Ergebnisse für „${esc(q)}“</h1><div class="tabs" id="tabs">
      <button data-t="all" class="on">Alle</button><button data-t="songs">Songs</button><button data-t="artists">Artists</button><button data-t="playlists">Playlists</button><button data-t="albums">Alben</button></div><div id="res">${skeletonRow(6)}</div>`;
    const qq = encodeURIComponent(q);
    let data;
    try {
      const [tr, us, pl, al] = await Promise.all([
        api(`/tracks/search?query=${qq}&limit=50`), api(`/users/search?query=${qq}&limit=24`),
        api(`/playlists/search?query=${qq}&limit=24`), api(`/playlists/search?query=${qq}&limit=24&kind=album`).catch(() => []),
      ]);
      data = { songs: tracksOf(tr), artists: us || [], playlists: (pl || []).filter(p => !p.is_album), albums: (al || []).filter(p => p.is_album) };
    } catch { $('#res').innerHTML = '<p class="muted">Suche fehlgeschlagen. Bitte erneut versuchen.</p>'; return; }
    const artistCards = l => l.map(u => card({ href: `#/artist/${u.id}`, img: art(u.profile_picture), title: u.name, sub: `${fmtNum(u.follower_count)} Follower`, round: true, play: `artist:${u.id}` })).join('');
    const plCards = l => l.map(p => card({ href: `#/playlist/${p.id}`, img: art(p.artwork), title: p.playlist_name, sub: p.user?.name || '', play: `playlist:${p.id}` })).join('');
    const show = t => {
      const r = $('#res'); viewCtx = null;
      if (t === 'all') r.innerHTML = `
        <h2 class="section">Songs</h2>${trackTable('search', data.songs.slice(0, 8), { noHead: true })}
        ${data.artists.length ? `<h2 class="section">Artists</h2><div class="row">${artistCards(data.artists.slice(0, 10))}</div>` : ''}
        ${data.playlists.length ? `<h2 class="section">Playlists</h2><div class="row">${plCards(data.playlists.slice(0, 10))}</div>` : ''}
        ${data.albums.length ? `<h2 class="section">Alben</h2><div class="row">${plCards(data.albums.slice(0, 10))}</div>` : ''}`;
      else if (t === 'songs') r.innerHTML = trackTable('search', data.songs);
      else if (t === 'artists') r.innerHTML = data.artists.length ? `<div class="grid">${artistCards(data.artists)}</div>` : '<p class="muted">Keine Artists gefunden.</p>';
      else r.innerHTML = data[t].length ? `<div class="grid">${plCards(data[t])}</div>` : '<p class="muted">Nichts gefunden.</p>';
      markPlaying();
    };
    $$('#tabs button').forEach(b => b.onclick = () => { $$('#tabs button').forEach(x => x.classList.remove('on')); b.classList.add('on'); show(b.dataset.t); });
    show('all');
  }
  $('#searchForm').onsubmit = e => { e.preventDefault(); const q = $('#searchInput').value.trim(); location.hash = q ? `#/search/${encodeURIComponent(q)}` : '#/search'; };
  $('#searchInput').addEventListener('input', e => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { const q = e.target.value.trim(); history.replaceState(null, '', q ? `#/search/${encodeURIComponent(q)}` : '#/search'); route(); }, 450);
  });
  $('#searchInput').addEventListener('focus', () => { if (!location.hash.startsWith('#/search')) location.hash = '#/search'; });

  async function vGenre(g) {
    const meta = GENRES.find(x => x[0] === g) || [g, '#7c3aed', '🎵'];
    view.innerHTML = `<div class="head"><div class="tile" style="background:${meta[1]}">${meta[2]}</div><div><div class="kind">Genre</div><h1>${esc(g)}</h1>
      <div class="muted">Die angesagtesten ${esc(g)}-Songs</div></div></div>
      <div class="actions"><button class="fab" data-play="genre:${esc(g)}">${PLAY_SVG}</button></div>
      <div class="tabs" id="tabs"><button data-t="week" class="on">Woche</button><button data-t="month">Monat</button><button data-t="allTime">Allzeit</button></div><div id="list"></div>`;
    const load = time => section($('#list'), async () => trackTable('genre', tracksOf(await api(`/tracks/trending?genre=${encodeURIComponent(g)}&time=${time}&limit=100`))));
    $$('#tabs button').forEach(b => b.onclick = () => { $$('#tabs button').forEach(x => x.classList.remove('on')); b.classList.add('on'); load(b.dataset.t); });
    load('week');
  }

  async function vArtist(id) {
    view.innerHTML = `<div class="skeleton" style="height:260px;margin-top:20px"></div>`;
    let u, tr;
    try { [u, tr] = await Promise.all([api(`/users/${id}`), api(`/users/${id}/tracks?sort=plays&limit=50`)]); }
    catch { view.innerHTML = '<div class="empty"><div class="big">😕</div><p>Artist nicht gefunden.</p></div>'; return; }
    const list = tracksOf(tr);
    view.innerHTML = `<div class="head artist"><img src="${esc(art(u.profile_picture))}" alt="" onerror="this.src='${FALLBACK_ART}'"><div>
      <div class="kind">${u.is_verified ? '✔ Verifizierter Artist' : 'Artist'}</div><h1>${esc(u.name)}</h1>
      <div class="muted">${fmtNum(u.follower_count)} Follower · ${u.track_count || list.length} Songs${u.location ? ' · ' + esc(u.location) : ''}</div></div></div>
      <div class="actions"><button class="fab" data-play="list:artist">${PLAY_SVG}</button>
        <button class="pill" id="shufArtist">🔀 Zufällig</button></div>
      ${u.bio ? `<p class="muted" style="max-width:720px">${esc(u.bio)}</p>` : ''}
      <h2 class="section">Beliebt</h2>${trackTable('artist', list)}
      <div id="artistPl"></div>`;
    $('#shufArtist').onclick = () => { setShuffle(true); playList(list, Math.floor(Math.random() * list.length)); };
    markPlaying();
    section($('#artistPl'), async () => {
      const pls = await api(`/users/${id}/playlists?limit=20`).catch(() => []);
      return pls && pls.length ? `<h2 class="section">Playlists & Alben</h2><div class="row">${pls.map(p => card({ href: `#/playlist/${p.id}`, img: art(p.artwork), title: p.playlist_name, sub: p.is_album ? 'Album' : 'Playlist', play: `playlist:${p.id}` })).join('')}</div>` : '';
    });
  }

  async function vPlaylist(id) {
    view.innerHTML = `<div class="skeleton" style="height:260px;margin-top:20px"></div>`;
    let p, tr;
    try { [p, tr] = await Promise.all([api(`/playlists/${id}`).then(d => Array.isArray(d) ? d[0] : d), api(`/playlists/${id}/tracks`)]); }
    catch { view.innerHTML = '<div class="empty"><div class="big">😕</div><p>Playlist nicht gefunden.</p></div>'; return; }
    const list = tracksOf(tr);
    view.innerHTML = `<div class="head"><img src="${esc(art(p.artwork))}" alt="" onerror="this.src='${FALLBACK_ART}'"><div>
      <div class="kind">${p.is_album ? 'Album' : 'Playlist'}</div><h1>${esc(p.playlist_name)}</h1>
      ${p.description ? `<div class="muted" style="margin-bottom:6px">${esc(p.description)}</div>` : ''}
      <div class="muted"><a href="#/artist/${esc(p.user?.id)}"><b style="color:var(--text)">${esc(p.user?.name)}</b></a> · ${list.length} Songs · ${totalDur(list)}</div></div></div>
      <div class="actions"><button class="fab" data-play="list:pl">${PLAY_SVG}</button>
        <button class="pill" id="savePl">＋ In Bibliothek speichern</button></div>
      ${trackTable('pl', list)}`;
    $('#savePl').onclick = () => { const np = createPlaylist(p.playlist_name, list.map(t => ({ ...t }))); toast('In deiner Bibliothek gespeichert'); location.hash = `#/my/${np.id}`; };
    markPlaying();
  }

  function vMyPlaylist(id) {
    const p = playlists.find(x => x.id === id);
    if (!p) { view.innerHTML = '<div class="empty"><div class="big">😕</div><p>Playlist nicht gefunden.</p></div>'; return; }
    viewCtx = { playlist: p };
    view.innerHTML = `<div class="head">${p.tracks[0] ? `<img src="${esc(p.tracks[0].art)}" alt="">` : '<div class="tile">♪</div>'}<div>
      <div class="kind">Deine Playlist</div><h1 id="plName" title="Zum Umbenennen klicken" style="cursor:text">${esc(p.name)}</h1>
      <div class="muted">${p.tracks.length} Songs · ${totalDur(p.tracks)}</div></div></div>
      <div class="actions"><button class="fab" data-play="list:my">${PLAY_SVG}</button>
        <button class="pill" id="renamePl">✎ Umbenennen</button><button class="pill" id="delPl">🗑 Löschen</button></div>
      ${trackTable('my', p.tracks, { emptyText: 'Noch leer. Such nach Songs und füge sie über „⋯“ oder Rechtsklick hinzu.' })}
      ${p.tracks.length ? '' : '<div style="text-align:center"><a class="btn" href="#/search">Songs finden</a></div>'}`;
    const rename = () => { const n = prompt('Neuer Name der Playlist:', p.name); if (n && n.trim()) { p.name = n.trim(); savePlaylists(); route(); } };
    $('#renamePl').onclick = rename; $('#plName').onclick = rename;
    $('#delPl').onclick = () => { if (confirm(`„${p.name}“ wirklich löschen?`)) { playlists = playlists.filter(x => x !== p); savePlaylists(); location.hash = '#/library'; toast('Playlist gelöscht'); } };
    markPlaying();
  }

  function vLiked() {
    view.innerHTML = `<div class="head"><div class="tile">♥</div><div><div class="kind">Playlist</div><h1>Lieblingssongs</h1>
      <div class="muted">${liked.length} Songs · ${totalDur(liked)}</div></div></div>
      <div class="actions"><button class="fab" data-play="list:liked">${PLAY_SVG}</button></div>
      ${trackTable('liked', liked, { emptyText: 'Songs, die dir gefallen, erscheinen hier. Tippe auf ♡ bei einem Song.' })}`;
    markPlaying();
  }

  async function localTracks() {
    const files = await idb.all().catch(() => []);
    return files.sort((a, b) => b.added - a.added).map(f => {
      if (!localUrls.has(f.id)) localUrls.set(f.id, URL.createObjectURL(f.blob));
      return { id: f.id, title: f.title, artist: f.artist || 'Eigene Datei', art: FALLBACK_ART, duration: f.duration || 0, genre: 'Lokal', local: true };
    });
  }
  async function addFiles(files) {
    const list = [...files].filter(f => f.type.startsWith('audio/') || /\.(mp3|m4a|aac|wav|ogg|oga|flac|opus|webm)$/i.test(f.name));
    if (!list.length) { toast('Keine Audiodateien erkannt'); return; }
    for (const f of list) {
      const base = f.name.replace(/\.[^.]+$/, '');
      const [artist, title] = base.includes(' - ') ? base.split(/ - (.+)/) : ['', base];
      const duration = await new Promise(res => { const a = new Audio(); a.preload = 'metadata'; const u = URL.createObjectURL(f);
        a.onloadedmetadata = () => { res(a.duration); URL.revokeObjectURL(u); }; a.onerror = () => res(0); a.src = u; });
      await idb.put({ id: 'local-' + uid(), title: title.trim(), artist: artist.trim(), blob: f, duration, added: Date.now() });
    }
    toast(`${list.length} Datei(en) hinzugefügt`);
    if (location.hash === '#/local') route(); else location.hash = '#/local';
  }
  $('#fileInput').onchange = e => { addFiles(e.target.files); e.target.value = ''; };

  async function vLocal() {
    const list = await localTracks();
    view.innerHTML = `<div class="head"><div class="tile" style="background:linear-gradient(135deg,#22c1c3,#3b82f6)">♪</div><div>
      <div class="kind">Lokal</div><h1>Eigene Dateien</h1><div class="muted">${list.length} Songs · bleiben privat in deinem Browser</div></div></div>
      <div class="actions">${list.length ? `<button class="fab" data-play="list:local">${PLAY_SVG}</button>` : ''}
        <button class="pill" id="addFiles">＋ Dateien hinzufügen</button></div>
      <div class="dropzone" id="drop">🎵 Ziehe MP3-, M4A-, WAV-, FLAC- oder OGG-Dateien hierher<br><span class="muted">Tipp: Dateinamen wie „Artist - Titel.mp3“ werden automatisch erkannt</span></div>
      ${trackTable('local', list, { emptyText: 'Noch keine eigenen Dateien.' })}`;
    $('#addFiles').onclick = () => $('#fileInput').click();
    const d = $('#drop');
    d.onclick = () => $('#fileInput').click();
    d.ondragover = e => { e.preventDefault(); d.classList.add('over'); };
    d.ondragleave = () => d.classList.remove('over');
    d.ondrop = e => { e.preventDefault(); d.classList.remove('over'); addFiles(e.dataTransfer.files); };
    markPlaying();
  }

  function vLibrary() {
    view.innerHTML = `<h1>Deine Bibliothek</h1>
      <div class="actions"><button class="pill" id="libNew">＋ Neue Playlist</button><button class="pill" id="libFiles">＋ Eigene Dateien</button></div>
      <div class="grid">
        ${card({ href: '#/liked', img: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><defs><linearGradient id="g"><stop stop-color="#ff5e8a"/><stop offset="1" stop-color="#8b5cf6"/></linearGradient></defs><rect width="10" height="10" fill="url(#g)"/><text x="5" y="6.8" font-size="5" text-anchor="middle" fill="white">♥</text></svg>'), title: 'Lieblingssongs', sub: `${liked.length} Songs`, play: liked.length ? 'list:liked' : '' })}
        ${card({ href: '#/local', img: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><defs><linearGradient id="g"><stop stop-color="#22c1c3"/><stop offset="1" stop-color="#3b82f6"/></linearGradient></defs><rect width="10" height="10" fill="url(#g)"/><text x="5" y="6.8" font-size="5" text-anchor="middle" fill="white">♪</text></svg>'), title: 'Eigene Dateien', sub: 'Lokal gespeichert' })}
        ${playlists.map(p => card({ href: `#/my/${p.id}`, img: p.tracks[0]?.art || FALLBACK_ART, title: p.name, sub: `Playlist · ${p.tracks.length} Songs` })).join('')}
      </div>`;
    lists.liked = liked;
    $('#libNew').onclick = () => $('#newPlaylistBtn').click();
    $('#libFiles').onclick = () => $('#fileInput').click();
  }

  /* ---------------- Router ---------------- */
  async function route() {
    const h = location.hash.slice(2) || 'home';
    const [name, ...rest] = h.split('/');
    const arg = decodeURIComponent(rest.join('/'));
    viewCtx = null;
    for (const k of Object.keys(lists)) if (k !== 'recent') delete lists[k];
    $$('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === name || (name === 'search' && a.dataset.nav === 'search')));
    if (name !== 'search') $('#main').scrollTop = 0;
    hideMenu();
    switch (name) {
      case 'search': return vSearch(arg);
      case 'charts': return vCharts();
      case 'genre': return vGenre(arg);
      case 'artist': return vArtist(arg);
      case 'playlist': return vPlaylist(arg);
      case 'my': return vMyPlaylist(arg);
      case 'liked': return vLiked();
      case 'local': return vLocal();
      case 'library': return vLibrary();
      default: return vHome();
    }
  }
  addEventListener('hashchange', route);

  // Dateien überall reinziehen
  addEventListener('dragover', e => e.preventDefault());
  addEventListener('drop', e => { e.preventDefault(); if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files); });

  renderSidePlaylists();
  route();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
