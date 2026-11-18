/* Musii – app shell: top bar, views, bottom panel, menus, persistence, startup */
(function (M) {
  'use strict';
  const h = M.h, T = M.Transport;
  M.state.follow = true;

  /* ---------- top bar ---------- */
  let ui = {};
  function buildTopbar() {
    const bar = M.$('#topbar');
    bar.innerHTML = '';
    const tabs = h('div', { class: 'seg' });
    [['session', 'Session'], ['arrange', 'Arrange'], ['mixer', 'Mixer']].forEach(([v, l]) => {
      tabs.appendChild(h('button', { class: 'seg-btn' + (M.state.view === v ? ' on' : ''), 'data-view': v, onclick: () => setView(v) }, l));
    });
    ui.play = M.iconBtn('play', 'Play', () => T.toggle(), 'play');
    ui.stop = M.iconBtn('stop', 'Stop', () => T.stop());
    ui.overdub = M.iconBtn('rec', 'Overdub (MIDI-Aufnahme)', () => { M.state.overdub = !M.state.overdub; M.emit('overdub'); }, 'rec');
    ui.metro = M.iconBtn('metro', 'Metronom', () => { M.state.project.metronome = !M.state.project.metronome; refreshTopbar(); M.emit('params'); });
    ui.loop = M.iconBtn('loop', 'Loop', () => { M.change((p) => { p.loop.on = !p.loop.on; }, { loop: true }); });
    ui.bpm = h('input', { class: 'bpm-input', type: 'number', step: '0.1', min: '40', max: '260', 'aria-label': 'Tempo' });
    ui.bpm.addEventListener('change', () => { M.snapshot(); T.setBpm(parseFloat(ui.bpm.value) || 120); });
    let tapTimes = [];
    const tap = h('button', { class: 'btn small tap', onclick: () => {
      const now = performance.now();
      tapTimes = tapTimes.filter((t) => now - t < 2500); tapTimes.push(now);
      if (tapTimes.length >= 3) {
        const d = (tapTimes[tapTimes.length - 1] - tapTimes[0]) / (tapTimes.length - 1);
        T.setBpm(60000 / d);
      }
    } }, 'TAP');
    const bpmBox = h('div', { class: 'bpm-box' },
      h('button', { class: 'bpm-step', onclick: () => T.setBpm(M.state.project.bpm - 1) }, '−'),
      ui.bpm,
      h('button', { class: 'bpm-step', onclick: () => T.setBpm(M.state.project.bpm + 1) }, '+'),
      tap);
    ui.pos = h('div', { class: 'pos' }, '1.1.1');
    ui.quant = M.select([{ value: '0', label: 'Q: aus' }, { value: '1', label: 'Q: 1/4' }, { value: '4', label: 'Q: 1 Takt' }, { value: '8', label: 'Q: 2 Takte' }],
      String(M.state.project.quant), (v) => { M.state.project.quant = Number(v); M.emit('params'); }, 'small quant');
    ui.back = h('button', { class: 'btn small back-arr', title: 'Zurück zum Arrangement', onclick: () => T.backToArrangement() }, M.icon('back', 14), ' Arr');
    bar.appendChild(h('div', { class: 'brand' }, h('span', { class: 'logo' }, h('i'), h('i'), h('i'), h('i')), 'musii'));
    bar.appendChild(tabs);
    bar.appendChild(h('div', { class: 'transport' }, ui.play, ui.stop, ui.overdub, ui.metro, ui.loop));
    bar.appendChild(bpmBox);
    bar.appendChild(ui.pos);
    bar.appendChild(ui.quant);
    bar.appendChild(h('div', { class: 'spacer' }));
    bar.appendChild(ui.back);
    bar.appendChild(M.iconBtn('undo', 'Rückgängig', () => M.undo()));
    bar.appendChild(M.iconBtn('redo', 'Wiederholen', () => M.redo()));
    bar.appendChild(M.iconBtn('menu', 'Menü', (e) => mainMenu(e)));
    refreshTopbar();
  }

  function refreshTopbar() {
    const p = M.state.project;
    if (!ui.play) return;
    ui.play.classList.toggle('on', T.playing);
    ui.overdub.classList.toggle('on', M.state.overdub);
    ui.metro.classList.toggle('on', !!p.metronome);
    ui.loop.classList.toggle('on', !!p.loop.on);
    if (document.activeElement !== ui.bpm) ui.bpm.value = p.bpm.toFixed(p.bpm % 1 ? 2 : 0);
    ui.quant.value = String(p.quant);
    ui.back.style.display = T.anyArrOff() && M.arrangementEnd(p) > 0 ? '' : 'none';
    document.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('on', b.dataset.view === M.state.view));
  }

  function setView(v) {
    if (v === 'mixer' && M.state.view !== 'mixer' && window.innerHeight < 600) { M.state.panelOpen = false; M.renderPanel(); }
    M.state.view = v;
    refreshTopbar();
    M.renderMain();
  }

  /* ---------- main view ---------- */
  M.renderMain = function () {
    const main = M.$('#main');
    const keepScroll = main.firstChild && main.firstChild.scrollLeft;
    main.innerHTML = '';
    main.dataset.view = M.state.view;
    if (M.state.view === 'session') M.renderSession(main);
    else if (M.state.view === 'arrange') M.renderArrange(main);
    else M.renderMixer(main);
    if (keepScroll && M.state.view === 'session' && main.firstChild) main.firstChild.scrollLeft = keepScroll;
  };

  /* ---------- bottom panel ---------- */
  M.openPanel = function (which) {
    M.state.panel = which;
    M.state.panelOpen = true;
    M.renderPanel();
  };
  M.renderPanel = function () {
    const panel = M.$('#panel');
    panel.classList.toggle('closed', !M.state.panelOpen);
    const tabs = M.$('#panelTabs');
    tabs.innerHTML = '';
    [['clip', 'Clip'], ['devices', 'Geräte'], ['play', 'Spielen']].forEach(([v, l]) => {
      tabs.appendChild(h('button', {
        class: 'ptab' + (M.state.panel === v && M.state.panelOpen ? ' on' : ''),
        onclick: () => { if (M.state.panel === v && M.state.panelOpen) M.state.panelOpen = false; else { M.state.panel = v; M.state.panelOpen = true; } M.renderPanel(); }
      }, l));
    });
    const t = M.selectedTrack();
    if (t) tabs.appendChild(h('span', { class: 'ptrack', style: { '--tc': t.color } }, t.name));
    tabs.appendChild(h('div', { class: 'spacer' }));
    tabs.appendChild(M.iconBtn(M.state.panelOpen ? 'chevDown' : 'chevUp', 'Panel ein-/ausklappen', () => { M.state.panelOpen = !M.state.panelOpen; M.renderPanel(); }));
    const body = M.$('#panelBody');
    if (M.state.panelH) panel.style.height = M.state.panelOpen ? M.state.panelH + 'px' : '';
    body.innerHTML = '';
    if (!M.state.panelOpen) return;
    if (M.state.panel === 'clip') M.renderEditor(body);
    else if (M.state.panel === 'devices') M.renderDevices(body);
    else M.renderPlay(body);
  };

  /* ---------- menus ---------- */
  function mainMenu(e) {
    const r = e.currentTarget ? e.currentTarget.getBoundingClientRect() : { left: e.clientX, bottom: e.clientY };
    M.menu(r.left - 200, r.bottom + 4, [
      { label: 'Neues Projekt', action: newProject },
      { label: 'Demo-Song laden', action: async () => { if (await M.confirm('Demo laden?', 'Das aktuelle Projekt wird ersetzt (vorher speichern, falls nötig).', 'Laden')) loadProject(M.demoProject()); } },
      { sep: true },
      { label: 'Speichern', action: () => saveAs(false) },
      { label: 'Speichern unter …', action: () => saveAs(true) },
      { label: 'Projekte öffnen …', action: openDialog },
      { sep: true },
      { label: 'Ableton-Projekt (.als) importieren …', action: importAlsDialog },
      { label: 'Samples verknüpfen …', action: () => M.linkSamplesDialog() },
      { label: 'Szenen ins Arrangement übertragen', action: scenesToArrangement },
      { sep: true },
      { label: 'Arrangement als WAV exportieren', action: exportWav },
      { label: 'Projektdatei exportieren (.musii)', action: exportProjectFile },
      { label: 'Projektdatei laden (.musii)', action: importProjectFile },
      { sep: true },
      { label: (M.state.follow ? '✓ ' : '') + 'Abspielkopf folgen', action: () => { M.state.follow = !M.state.follow; } },
      { label: 'Über Musii', action: about }
    ], 'Projekt: ' + M.state.project.name);
  }

  async function newProject() {
    if (!(await M.confirm('Neues Projekt?', 'Das aktuelle Projekt wird geschlossen. Nicht gespeicherte Änderungen bleiben nur in der automatischen Sicherung.', 'Neu'))) return;
    loadProject(M.newProject());
  }

  function loadProject(p, key) {
    T.stop(); T.stop();
    T.backToArrangement();
    M.state.projectKey = key || null;
    M.setProject(p);
    preloadSamples();
  }

  async function preloadSamples() {
    const ids = new Set();
    M.state.project.tracks.forEach((t) => {
      t.slots.forEach((c) => c && c.audio && c.audio.sampleId && ids.add(c.audio.sampleId));
      t.arr.forEach((it) => it.clip.audio && it.clip.audio.sampleId && ids.add(it.clip.audio.sampleId));
    });
    if (!ids.size) return;
    await Promise.all(Array.from(ids).map((id) => M.Samples.load(id, T.ctx)));
    M.renderMain(); M.renderPanel();
  }

  async function saveAs(ask) {
    const p = M.state.project;
    let key = M.state.projectKey;
    if (ask || !key) {
      const n = await M.promptText('Projekt speichern als', p.name);
      if (!n) return;
      p.name = n;
      key = 'p_' + n.toLowerCase().replace(/[^a-z0-9äöüß]+/g, '-');
    }
    try {
      await M.Store.saveProject(key, p);
      M.state.projectKey = key;
      M.toast('Projekt „' + p.name + '“ gespeichert');
    } catch (e) { M.toast('Speichern fehlgeschlagen'); }
  }

  async function openDialog() {
    const list = await M.Store.listProjects().catch(() => []);
    if (!list.length) { M.toast('Noch keine gespeicherten Projekte'); return; }
    const body = h('div', { class: 'dialog-body list' });
    list.forEach((it) => {
      const row = h('div', { class: 'list-row' },
        h('button', { class: 'list-main', onclick: async () => {
          M.closeOverlays();
          const p = await M.Store.loadProject(it.key);
          if (p) { loadProject(p, it.key); M.toast('Geöffnet: ' + p.name); }
        } }, h('b', null, it.name), h('span', null, new Date(it.savedAt).toLocaleString('de-DE'))),
        M.iconBtn('trash', 'Löschen', async () => {
          await M.Store.deleteProject(it.key); row.remove();
        }));
      body.appendChild(row);
    });
    M.dialog({ title: 'Projekte', body, buttons: [{ label: 'Schließen', value: null }] });
  }

  async function importAlsDialog() {
    const files = await M.pickFiles('.als,.zip,application/gzip,application/octet-stream,application/zip');
    if (!files.length) return;
    await importAlsBuffer(await files[0].arrayBuffer(), files[0].name);
  }

  async function importAlsBuffer(buf, name) {
    try {
      M.toast('Importiere ' + name + ' …', 4000);
      const r = await M.importAls(buf, name);
      loadProject(r.project);
      M.state.view = 'arrange'; M.state.zoom = 6; refreshTopbar(); M.renderMain();
      const nTracks = r.project.tracks.length;
      if (r.missingSamples.length) {
        const ok = await M.dialog({
          title: 'Projekt importiert',
          body: h('div', { class: 'dialog-body' },
            h('p', null, nTracks + ' Spuren, Tempo ' + r.project.bpm + ' BPM. Das Projekt verweist auf ' + r.missingSamples.length + ' Audio-Dateien, die nicht in der .als-Datei enthalten sind:'),
            h('ul', { class: 'file-list' }, r.missingSamples.slice(0, 12).map((n) => h('li', null, n))),
            h('p', null, 'Wähle die Dateien aus (z. B. aus dem Samples-Ordner des Projekts), dann werden sie automatisch zugeordnet.')),
          buttons: [{ label: 'Später', value: false }, { label: 'Dateien wählen …', value: true, primary: true }]
        });
        if (ok) M.linkSamplesDialog(true);
      } else M.toast('Importiert: ' + nTracks + ' Spuren');
    } catch (e) {
      console.error(e);
      M.dialog({ title: 'Import fehlgeschlagen', body: String(e.message || e) });
    }
  }

  M.linkSamplesDialog = async function (skipInfo) {
    const missing = M.missingSamples(M.state.project);
    if (!missing.length) { M.toast('Alle Samples sind vorhanden'); return; }
    const files = await M.pickFiles('audio/*,.wav,.aif,.aiff,.mp3,.flac,.ogg,.m4a', true);
    if (!files.length) return;
    M.toast('Lade Samples …', 5000);
    M.snapshot();
    const n = await M.linkSamples(M.state.project, files, T.ctx);
    const still = M.missingSamples(M.state.project).length;
    M.emit('change', { structure: true });
    M.toast(n + ' Clips verknüpft' + (still ? ' · ' + still + ' Dateien fehlen noch' : ''), 3500);
  };

  function scenesToArrangement() {
    const p = M.state.project;
    M.change(() => {
      let pos = M.arrangementEnd(p);
      pos = Math.ceil(pos / 4) * 4;
      p.scenes.forEach((sc, i) => {
        const lens = p.tracks.map((t) => (t.slots[i] ? t.slots[i].length : 0));
        const len = Math.max(0, ...lens);
        if (!len) return;
        p.tracks.forEach((t) => {
          const c = t.slots[i];
          if (!c) return;
          const cc = M.deepCopy(c); cc.id = 'c_' + M.uid();
          t.arr.push({ id: 'i_' + M.uid(), start: pos, dur: len, offset: 0, clip: cc });
        });
        p.markers.push({ name: sc.name, t: pos });
        pos += Math.ceil(len / 4) * 4;
      });
    }, { structure: true });
    M.state.view = 'arrange';
    T.backToArrangement();
    refreshTopbar(); M.renderMain();
    M.toast('Szenen wurden hintereinander ins Arrangement gelegt');
  }

  async function exportWav() {
    const p = M.state.project;
    if (M.arrangementEnd(p) <= 0) {
      const ok = await M.confirm('Arrangement ist leer', 'Sollen die Szenen zuerst ins Arrangement übertragen werden?', 'Übertragen');
      if (!ok) return;
      scenesToArrangement();
    }
    const missing = M.missingSamples(p).length;
    M.toast('Rendere Audio …', 10000);
    try {
      const buf = await M.renderArrangement(M.state.project);
      // peak-normalise to -0.3 dBFS if the mix would clip
      let pk = 0;
      for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > pk) pk = a; } }
      if (pk > 0.966) { const g = 0.966 / pk; for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] *= g; } }
      const wav = M.encodeWav(buf);
      M.saveFile(p.name.replace(/[^\w\- äöüÄÖÜß]+/g, '_') + '.wav', 'audio/wav', wav);
      if (missing) setTimeout(() => M.toast('Hinweis: ' + missing + ' fehlende Samples sind stumm'), 2500);
    } catch (e) { console.error(e); M.toast('Export fehlgeschlagen'); }
  }

  async function exportProjectFile() {
    const p = M.state.project;
    const enc = new TextEncoder().encode(JSON.stringify(p));
    M.saveFile(p.name.replace(/[^\w\- äöüÄÖÜß]+/g, '_') + '.musii', 'application/json', enc.buffer);
  }
  async function importProjectFile() {
    const files = await M.pickFiles('.musii,.json,application/json');
    if (!files.length) return;
    try {
      const p = JSON.parse(await files[0].text());
      if (!p.tracks) throw new Error('bad');
      loadProject(p);
    } catch (e) { M.toast('Keine gültige Projektdatei'); }
  }

  function about() {
    M.dialog({
      title: 'Musii',
      body: h('div', { class: 'dialog-body' },
        h('p', null, 'Mobile Musikproduktion: Session-Clips live starten, im Arrangement anordnen, mit Synth, Drum-Kit und Audio-Spuren produzieren.'),
        h('p', null, 'Tipps: Doppeltippen erstellt Clips · lange drücken öffnet Menüs · im Piano Roll zeichnest du mit einem Finger und scrollst mit zwei · Doppeltippen auf Regler setzt sie zurück.'),
        h('p', { class: 'muted' }, 'Version 1.0'))
    });
  }

  /* ---------- persistence ---------- */
  let saveTimer = null;
  M.autosave = function () {
    clearTimeout(saveTimer);
    return M.Store.saveProject('__autosave__', M.state.project).catch(() => {});
  };
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(M.autosave, 1500);
  }

  /* ---------- render loop ---------- */
  function frame() {
    const pos = T.playing ? T.arrPos() : T.pos;
    if (ui.pos) ui.pos.textContent = M.fmtPos(pos);
    if (M.state.view === 'session') M.updateSession();
    else if (M.state.view === 'arrange') M.updateArrange();
    else M.updateMixer();
    if (M.state.panelOpen && M.state.panel === 'clip') M.updateEditor();
    if (T.dirty) {
      T.dirty = false;
      refreshTopbar();
      if (M.state.view === 'session') {
        // re-render to show record states and new clips
        const recNow = !!T.rec;
        if (recNow !== frame.lastRec) { frame.lastRec = recNow; M.renderMain(); }
      }
      if (M.state.view === 'arrange') M.renderMain();
    }
    requestAnimationFrame(frame);
  }

  /* ---------- startup ---------- */
  function withTimeout(promise, ms) {
    return Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(null), ms))]);
  }

  async function init() {
    try { await boot(); }
    catch (e) {
      console.error(e);
      if (window.__bootFail) window.__bootFail((e && (e.stack || e.message)) || String(e));
    }
  }

  async function boot() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) throw new Error('Web Audio wird von dieser WebView nicht unterstützt. Bitte „Android System WebView“ aktualisieren.');
    let ctx;
    try { ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { ctx = new AC(); }
    const engine = new M.Engine(ctx);
    T.init(ctx, engine);

    M.on('change', (opts) => {
      engine.sync(M.state.project);
      if (opts.newProject) { buildTopbar(); }
      refreshTopbar();
      if (!opts.keepPanel) {
        M.renderMain();
        M.renderPanel();
      } else if (M.state.view === 'arrange' || M.state.view === 'session') {
        M.renderMain();
      }
      scheduleSave();
    });
    M.on('select', () => { M.renderMain(); M.renderPanel(); });
    M.on('params', () => { refreshTopbar(); scheduleSave(); });
    M.on('transport', () => { refreshTopbar(); if (M.state.view !== 'mixer') M.renderMain(); });
    M.on('tempo', () => { refreshTopbar(); scheduleSave(); });
    M.on('overdub', () => { refreshTopbar(); if (M.state.panel === 'play') M.renderPanel(); });

    // drag the panel tab bar to resize the bottom panel
    const tabsEl = M.$('#panelTabs');
    let rz = null;
    tabsEl.addEventListener('pointerdown', (e) => {
      if (e.target !== tabsEl && !e.target.classList.contains('spacer')) return;
      if (!M.state.panelOpen) return;
      rz = { y: e.clientY, h: M.$('#panel').getBoundingClientRect().height };
      tabsEl.setPointerCapture(e.pointerId);
    });
    tabsEl.addEventListener('pointermove', (e) => {
      if (!rz) return;
      const nh = M.clamp(rz.h - (e.clientY - rz.y), 120, window.innerHeight - 110);
      M.state.panelH = nh;
      M.$('#panel').style.height = nh + 'px';
    });
    const rzEnd = () => { if (rz) { rz = null; M.renderPanel(); } };
    tabsEl.addEventListener('pointerup', rzEnd);
    tabsEl.addEventListener('pointercancel', rzEnd);

    // unlock audio on first touch
    const unlock = () => { if (ctx.state !== 'running') ctx.resume(); };
    document.addEventListener('pointerdown', unlock, { capture: true });

    let p = null;
    try { p = await withTimeout(M.Store.loadProject('__autosave__'), 2500); } catch (e) { p = null; }
    try {
      M.setProject(p && p.tracks ? p : M.demoProject());
    } catch (e) {
      // a broken autosave must never block the app: start with the demo instead
      console.error(e);
      M.setProject(M.demoProject());
    }
    buildTopbar();
    preloadSamples().catch(() => {});
    window.__booted = true;
    const bootEl = document.getElementById('boot');
    if (bootEl) bootEl.remove();
    requestAnimationFrame(frame);

    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
      if (e.code === 'Space') { e.preventDefault(); T.toggle(); }
      else if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); e.shiftKey ? M.redo() : M.undo(); }
      else if (e.key === 'Tab') { e.preventDefault(); setView(M.state.view === 'session' ? 'arrange' : 'session'); }
    });
    window.addEventListener('resize', () => { M.renderPanel(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) M.autosave(); });
  }

  /* API for the Android host */
  window.MusiiApp = {
    onBack() {
      if (M.closeOverlays()) return true;
      if (M.state.panelOpen) { M.state.panelOpen = false; M.renderPanel(); return true; }
      return false;
    },
    autosave() { M.autosave(); },
    openProjectBase64(b64, name) { importAlsBuffer(M.base64ToBuf(b64), name || 'projekt.als'); },
    importAlsBuffer
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window.M);
