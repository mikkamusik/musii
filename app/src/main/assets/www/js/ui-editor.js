/* Musii – clip editor: piano roll (synth), step sequencer (drums), sample editor (audio) */
(function (M) {
  'use strict';
  const h = M.h, T = M.Transport;
  const KEY_W = 46, ROW_H = 16, LO = 24, HI = 108;

  M.state.grid = 0.25;
  M.state.newVel = 0.8;

  /** Currently edited clip: {track, clip, item?} */
  M.currentClip = function () {
    const s = M.state;
    if (s.selArr) {
      const t = M.track(s.selArr.trackId);
      const it = t && t.arr.find((x) => x.id === s.selArr.itemId);
      if (it) return { track: t, clip: it.clip, item: it };
    }
    if (s.selSlot) {
      const t = M.track(s.selSlot.trackId);
      const c = t && t.slots[s.selSlot.scene];
      if (c) return { track: t, clip: c };
      if (t) return { track: t, clip: null, scene: s.selSlot.scene };
    }
    return null;
  };

  function toolbar(cur) {
    const { track, clip, item } = cur;
    const bar = h('div', { class: 'ed-bar' });
    const nameBtn = h('button', { class: 'ed-name', style: { '--cc': clip.color || track.color } }, clip.name);
    nameBtn.addEventListener('click', async () => {
      const n = await M.promptText('Clip umbenennen', clip.name);
      if (n != null) M.change(() => { clip.name = n; }, { structure: true });
    });
    bar.appendChild(nameBtn);
    bar.appendChild(h('span', { class: 'ed-sub' }, track.name + (item ? ' · Arrangement ' + M.fmtPos(item.start) : '')));

    const lenGroup = h('div', { class: 'ed-group' },
      h('span', { class: 'ed-lab' }, 'Länge'),
      M.iconBtn('minus', 'Kürzer', () => setLen(clip.length <= 4 ? Math.max(1, clip.length - 1) : clip.length - 4)),
      h('span', { class: 'ed-val' }, M.fmtLen(clip.length)),
      M.iconBtn('plus', 'Länger', () => setLen(clip.length < 4 ? clip.length + 1 : clip.length + 4)));
    function setLen(n) {
      M.change(() => {
        clip.length = n;
        if (item && item.dur < n) item.dur = n;
      }, { structure: true });
    }
    bar.appendChild(lenGroup);

    if (!clip.audio) {
      bar.appendChild(h('button', {
        class: 'btn small', title: 'Inhalt verdoppeln',
        onclick: () => M.change(() => {
          const L = clip.length;
          clip.notes = clip.notes.concat(clip.notes.filter((n) => n.t < L).map((n) => Object.assign({}, n, { t: n.t + L })));
          clip.length = L * 2;
          if (item && item.dur < clip.length) item.dur = clip.length;
        }, { structure: true })
      }, '×2'));
      if (track.type === 'synth') {
        bar.appendChild(M.select([
          { value: '1', label: '1/4' }, { value: '0.5', label: '1/8' }, { value: '0.25', label: '1/16' }, { value: '0.125', label: '1/32' }
        ], String(M.state.grid), (v) => { M.state.grid = Number(v); M.renderPanel(); }, 'small'));
        bar.appendChild(h('button', {
          class: 'btn small', onclick: () => M.change(() => {
            const g = M.state.grid;
            clip.notes.forEach((n) => { n.t = Math.round(n.t / g) * g; n.d = Math.max(g, Math.round(n.d / g) * g); });
          }, { notes: true })
        }, 'Quant.'));
        bar.appendChild(h('div', { class: 'ed-group' },
          h('button', { class: 'btn small', onclick: () => transpose(-12) }, '−8va'),
          h('button', { class: 'btn small', onclick: () => transpose(-1) }, '−1'),
          h('button', { class: 'btn small', onclick: () => transpose(1) }, '+1'),
          h('button', { class: 'btn small', onclick: () => transpose(12) }, '+8va')));
      }
      bar.appendChild(M.iconBtn('trash', 'Alle Noten löschen', () => M.change(() => { clip.notes = []; }, { notes: true })));
    }
    function transpose(d) {
      M.change(() => clip.notes.forEach((n) => { n.p = M.clamp(n.p + d, 0, 127); }), { notes: true });
    }
    return bar;
  }

  M.renderEditor = function (root) {
    const cur = M.currentClip();
    if (!cur) {
      root.appendChild(h('div', { class: 'empty-hint' }, 'Wähle einen Clip in der Session- oder Arrangement-Ansicht. Doppeltippen auf einen leeren Slot erstellt einen neuen Clip.'));
      return;
    }
    if (!cur.clip) {
      const t = cur.track;
      root.appendChild(h('div', { class: 'empty-hint' },
        h('div', null, 'Leerer Slot auf „' + t.name + '“'),
        h('div', { class: 'row-gap' },
          t.type !== 'audio'
            ? h('button', { class: 'btn primary', onclick: () => M.createClipAt(t, cur.scene) }, M.icon('plus', 14), ' MIDI-Clip erstellen')
            : h('button', { class: 'btn primary', onclick: () => M.importAudioToSlot(t, cur.scene) }, M.icon('plus', 14), ' Audio importieren'),
          t.type === 'audio' ? h('span', { class: 'ed-sub' }, 'oder Spur scharf schalten (●) und auf den Slot tippen, um aufzunehmen') : null)));
      return;
    }
    root.appendChild(toolbar(cur));
    const body = h('div', { class: 'ed-body' });
    root.appendChild(body);
    if (cur.clip.audio) renderAudio(body, cur);
    else if (cur.track.type === 'drums') renderSteps(body, cur);
    else renderPianoRoll(body, cur);
  };

  /* ---------------- piano roll ---------------- */
  let roll = null;   // live state for playhead drawing

  function renderPianoRoll(root, cur) {
    const { track, clip } = cur;
    const scroller = h('div', { class: 'roll-scroll' });
    const inner = h('div', { class: 'roll-inner' });
    const len = clip.length;
    const avail = Math.max(300, (root.clientWidth || window.innerWidth) - KEY_W - 10);
    let beatW = Math.max(20, Math.min(90, avail / Math.min(len, 16)));
    if (len * beatW > 7000) beatW = 7000 / len;
    const W = Math.ceil(len * beatW), H = (HI - LO + 1) * ROW_H;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const keys = h('canvas', { class: 'roll-keys', style: { width: KEY_W + 'px', height: H + 'px' } });
    keys.width = KEY_W * dpr; keys.height = H * dpr;
    const cv = h('canvas', { class: 'roll-grid', style: { width: W + 'px', height: H + 'px' } });
    cv.width = W * dpr; cv.height = H * dpr;
    inner.appendChild(keys); inner.appendChild(cv);
    scroller.appendChild(inner);
    root.appendChild(scroller);

    const pY = (p) => (HI - p) * ROW_H;
    const yP = (y) => HI - Math.floor(y / ROW_H);

    function drawKeys() {
      const c = keys.getContext('2d');
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      for (let p = HI; p >= LO; p--) {
        const y = pY(p);
        c.fillStyle = M.isBlack(p) ? '#23262d' : '#d9dbe0';
        c.fillRect(0, y, KEY_W, ROW_H - 1);
        if (p % 12 === 0) {
          c.fillStyle = '#16181d'; c.font = '10px system-ui'; c.textBaseline = 'middle';
          c.fillText(M.noteName(p), 4, y + ROW_H / 2);
        }
      }
    }
    function draw(playhead) {
      const c = cv.getContext('2d');
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.fillStyle = '#1b1d23'; c.fillRect(0, 0, W, H);
      for (let p = HI; p >= LO; p--) {
        if (M.isBlack(p)) { c.fillStyle = '#17191e'; c.fillRect(0, pY(p), W, ROW_H); }
        if (p % 12 === 0) { c.fillStyle = '#2c3038'; c.fillRect(0, pY(p) + ROW_H - 1, W, 1); }
      }
      const g = M.state.grid;
      for (let b = 0; b <= len + 1e-6; b += g) {
        const x = Math.round(b * beatW) + 0.5;
        c.fillStyle = b % 4 === 0 ? '#4a4f5a' : b % 1 === 0 ? '#323640' : '#25282f';
        c.fillRect(x, 0, 1, H);
      }
      const col = clip.color || track.color;
      clip.notes.forEach((n) => {
        const x = n.t * beatW, y = pY(n.p), w = Math.max(3, n.d * beatW - 1);
        c.globalAlpha = 0.45 + n.v * 0.55;
        c.fillStyle = col;
        c.fillRect(x + 0.5, y + 1, w, ROW_H - 2);
        c.globalAlpha = 1;
        c.strokeStyle = 'rgba(0,0,0,0.6)';
        c.strokeRect(x + 0.5, y + 1.5, w, ROW_H - 3);
        if (w > 8) { c.fillStyle = 'rgba(0,0,0,0.35)'; c.fillRect(x + w - 3, y + 3, 2, ROW_H - 6); }
      });
      if (playhead != null) {
        c.fillStyle = '#ffb347';
        c.fillRect(Math.round(playhead * beatW), 0, 2, H);
      }
    }
    drawKeys(); draw(null);
    roll = { draw, clip, track, last: null, canvas: cv };

    // keys: tap to preview
    keys.addEventListener('pointerdown', (e) => {
      const r = keys.getBoundingClientRect();
      const p = yP(e.clientY - r.top);
      T.noteOn('k' + e.pointerId, p, 0.8);
      const up = () => { T.noteOff('k' + e.pointerId); window.removeEventListener('pointerup', up); };
      window.addEventListener('pointerup', up);
    });

    // grid editing: one finger edits, two fingers scroll
    const pointers = new Map();
    let op = null, pan = null;
    const hit = (bx, p) => {
      for (let i = clip.notes.length - 1; i >= 0; i--) {
        const n = clip.notes[i];
        if (n.p === p && bx >= n.t && bx <= n.t + Math.max(n.d, 0.12)) return n;
      }
      return null;
    };
    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        if (op && op.snap) { clip.notes = JSON.parse(op.snap); draw(); }   // cancel edit
        op = null;
        const pts = Array.from(pointers.values());
        pan = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2, sl: scroller.scrollLeft, st: scroller.scrollTop };
        return;
      }
      if (pointers.size > 2) return;
      const r = cv.getBoundingClientRect();
      const bx = (e.clientX - r.left) / beatW, p = yP(e.clientY - r.top);
      const g = M.state.grid;
      const snapStr = JSON.stringify(clip.notes);
      const n = hit(bx, p);
      if (n) {
        const nearEnd = (n.t + n.d - bx) * beatW < 14 && n.d * beatW > 18;
        op = { type: nearEnd ? 'resize' : 'move', note: n, t0: n.t, p0: n.p, d0: n.d, bx0: bx, py0: p, moved: false, snap: snapStr };
        if (!nearEnd) T.noteOn('pr', n.p, n.v);
      } else {
        const t = Math.max(0, Math.floor(bx / g) * g);
        if (t >= len || p < LO || p > HI) return;
        const note = { p, t, d: Math.min(g * (g < 0.25 ? 2 : 1), len - t), v: M.state.newVel };
        if (track.type === 'synth' && g <= 0.25) note.d = Math.min(0.25, len - t);
        clip.notes.push(note);
        op = { type: 'new', note, t0: t, p0: p, d0: note.d, bx0: bx, py0: p, moved: false, snap: snapStr };
        T.noteOn('pr', p, note.v);
        draw();
      }
    });
    cv.addEventListener('pointermove', (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pan && pointers.size >= 2) {
        const pts = Array.from(pointers.values());
        const cx = (pts[0].x + pts[1].x) / 2, cy = (pts[0].y + pts[1].y) / 2;
        scroller.scrollLeft = pan.sl - (cx - pan.x);
        scroller.scrollTop = pan.st - (cy - pan.y);
        return;
      }
      if (!op) return;
      const r = cv.getBoundingClientRect();
      const bx = (e.clientX - r.left) / beatW, p = M.clamp(yP(e.clientY - r.top), LO, HI);
      const g = M.state.grid;
      const n = op.note;
      if (op.type === 'resize' || (op.type === 'new' && p === op.py0 && Math.abs(bx - op.bx0) * beatW > 6 && !op.movedPitch)) {
        const end = Math.max(n.t + g, Math.round(bx / g) * g);
        n.d = Math.min(end - n.t, len - n.t);
        op.moved = true;
      } else {
        const dt = Math.round((bx - op.bx0) / g) * g;
        const nt = M.clamp(op.t0 + dt, 0, len - g);
        if (nt !== n.t || p !== n.p) {
          if (p !== n.p) { T.noteOff('pr'); T.noteOn('pr', p, n.v); op.movedPitch = true; }
          n.t = nt; n.p = p; op.moved = true;
        }
      }
      draw();
    });
    const end = (e) => {
      pointers.delete(e.pointerId);
      T.noteOff('pr');
      if (pan) { if (pointers.size === 0) pan = null; return; }
      if (!op) return;
      const o = op; op = null;
      if (o.type === 'move' && !o.moved) {
        // tap on a note deletes it
        clip.notes = clip.notes.filter((x) => x !== o.note);
      }
      const after = JSON.stringify(clip.notes);
      clip.notes = JSON.parse(o.snap);
      if (after !== o.snap) M.change(() => { clip.notes = JSON.parse(after); }, { notes: true });
      else draw();
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);

    // initial scroll: centre around the notes, or C3–C5
    requestAnimationFrame(() => {
      let center = 60;
      if (clip.notes.length) center = Math.round(clip.notes.reduce((s, n) => s + n.p, 0) / clip.notes.length);
      scroller.scrollTop = Math.max(0, pY(center) - scroller.clientHeight / 2);
    });
  }

  /* ---------------- step sequencer ---------------- */
  function renderSteps(root, cur) {
    const { track, clip } = cur;
    const steps = Math.round(clip.length * 4);
    const wrap = h('div', { class: 'steps' });
    const labels = h('div', { class: 'steps-labels' });
    const gridEl = h('div', { class: 'steps-grid' });
    const scroll = h('div', { class: 'steps-scroll' }, gridEl);
    const cells = [];
    M.DRUM_PADS.forEach((pad, i) => {
      const pitch = M.DRUM_BASE + i;
      const lab = h('button', { class: 'step-lab' }, pad.name);
      lab.addEventListener('pointerdown', () => T.noteOn('lab', pitch, 0.9));
      labels.appendChild(lab);
      const row = h('div', { class: 'step-row' });
      for (let s = 0; s < steps; s++) {
        const t = s / 4;
        const cell = h('button', { class: 'step' + (s % 4 === 0 ? ' beat' : '') + (Math.floor(s / 16) % 2 ? ' alt' : '') });
        const note = clip.notes.find((n) => n.p === pitch && Math.abs(n.t - t) < 0.01);
        if (note) { cell.classList.add('on'); cell.style.setProperty('--v', note.v); if (note.v > 0.95) cell.classList.add('acc'); }
        cell.addEventListener('click', () => {
          const ex = clip.notes.find((n) => n.p === pitch && Math.abs(n.t - t) < 0.01);
          M.change(() => {
            if (ex) clip.notes = clip.notes.filter((n) => n !== ex);
            else clip.notes.push({ p: pitch, t, d: 0.25, v: 0.8 });
          }, { notes: true, keepPanel: true });
          if (!ex) T.noteOn('st', pitch, 0.8);
          cell.classList.toggle('on', !ex);
          cell.classList.remove('acc');
          cell.style.setProperty('--v', 0.8);
        });
        M.gestures(cell, {
          long: () => {
            // cycle velocity: soft -> normal -> accent
            const ex = clip.notes.find((n) => n.p === pitch && Math.abs(n.t - t) < 0.01);
            M.change(() => {
              if (!ex) clip.notes.push({ p: pitch, t, d: 0.25, v: 1 });
              else ex.v = ex.v > 0.95 ? 0.5 : ex.v < 0.6 ? 0.8 : 1;
            }, { notes: true, keepPanel: true });
            const n = clip.notes.find((x) => x.p === pitch && Math.abs(x.t - t) < 0.01);
            cell.classList.add('on'); cell.classList.toggle('acc', n.v > 0.95); cell.style.setProperty('--v', n.v);
            M.toast('Velocity ' + Math.round(n.v * 127));
          }
        });
        row.appendChild(cell);
        cells.push(cell);
      }
      gridEl.appendChild(row);
    });
    const ph = h('div', { class: 'steps-ph' });
    gridEl.appendChild(ph);
    wrap.appendChild(labels); wrap.appendChild(scroll);
    root.appendChild(wrap);
    roll = { stepsPh: ph, clip, track, steps };
  }

  /* ---------------- audio clip ---------------- */
  function renderAudio(root, cur) {
    const { track, clip, item } = cur;
    const a = clip.audio;
    const wrap = h('div', { class: 'audio-ed' });
    const buf = M.Samples.get(a.sampleId);
    const cvWrap = h('div', { class: 'wave-wrap', style: { '--cc': clip.color || track.color } });
    const cv = h('canvas', { class: 'wave' });
    cvWrap.appendChild(cv);
    const ph = h('div', { class: 'wave-ph' });
    cvWrap.appendChild(ph);
    wrap.appendChild(cvWrap);
    const side = h('div', { class: 'audio-side' });
    if (!buf) {
      side.appendChild(h('div', { class: 'warn' }, 'Sample fehlt: ' + (a.sampleName || '?')));
      side.appendChild(h('button', { class: 'btn primary', onclick: () => M.linkSamplesDialog() }, 'Samples verknüpfen …'));
    } else {
      side.appendChild(h('div', { class: 'ed-sub' }, (a.sampleName || 'Sample') + ' · ' + buf.duration.toFixed(2) + ' s'));
    }
    const knobs = h('div', { class: 'knob-row' },
      M.knob({ label: 'Gain', value: M.gainToDb(a.gain || 1) > -40 ? M.gainToDb(a.gain || 1) : -40, min: -40, max: 12, def: 0,
        fmt: (v) => (v > 0 ? '+' : '') + v.toFixed(1) + ' dB', onChange: (v) => { a.gain = M.dbToGain(v); M.paramChanged(); } }),
      M.knob({ label: 'Start', value: a.startSec || 0, min: 0, max: Math.max(1, buf ? buf.duration : 10), def: 0,
        fmt: (v) => v.toFixed(2) + ' s', onChange: (v) => { a.startSec = v; M.paramChanged(); drawW(); } }));
    side.appendChild(knobs);
    side.appendChild(h('div', { class: 'row-gap' },
      M.toggleBtn('Warp', a.warp !== false, (v) => { M.snapshot(); a.warp = v; M.paramChanged(); M.renderPanel(); }),
      h('span', { class: 'ed-lab' }, 'Original-BPM'),
      h('button', { class: 'btn small', onclick: () => setBpm(a.srcBpm / 2) }, '÷2'),
      h('input', {
        class: 'num-input', type: 'number', step: '0.01', value: (a.srcBpm || M.state.project.bpm).toFixed(2),
        onchange: (e) => setBpm(parseFloat(e.target.value))
      }),
      h('button', { class: 'btn small', onclick: () => setBpm(a.srcBpm * 2) }, '×2')));
    side.appendChild(h('div', { class: 'row-gap' },
      h('button', { class: 'btn small', onclick: () => fitLen() }, 'Länge an Sample anpassen'),
      h('button', { class: 'btn small', onclick: () => M.replaceSample(clip) }, 'Sample ersetzen …')));
    wrap.appendChild(side);
    root.appendChild(wrap);

    function setBpm(v) {
      if (!(v > 20 && v < 400)) return;
      M.change(() => { a.srcBpm = Math.round(v * 100) / 100; }, { structure: true });
    }
    function fitLen() {
      if (!buf) return;
      const src = a.warp !== false ? a.srcBpm : M.state.project.bpm;
      const beats = Math.max(1, Math.round((buf.duration - (a.startSec || 0)) * src / 60));
      M.change(() => { clip.length = beats; if (item) item.dur = Math.max(item.dur, beats); }, { structure: true });
    }
    function drawW() {
      const w = cvWrap.clientWidth || 600, ht = cvWrap.clientHeight || 120;
      cv.width = w; cv.height = ht;
      M.drawClipPreview(cv, clip, clip.length, 0);
      const c = cv.getContext('2d');
      c.fillStyle = 'rgba(0,0,0,0.25)';
      for (let b = 4; b < clip.length; b += 4) c.fillRect(Math.round(b / clip.length * w), 0, 1, ht);
    }
    requestAnimationFrame(drawW);
    roll = { wavePh: ph, clip, track, waveW: () => cvWrap.clientWidth };
  }

  M.replaceSample = async function (clip) {
    const files = await M.pickFiles('audio/*,.wav,.mp3,.ogg,.m4a,.flac,.aif,.aiff');
    if (!files.length) return;
    try {
      const r = await M.Samples.importBytes(files[0].name, await files[0].arrayBuffer(), T.ctx);
      M.change(() => { clip.audio.sampleId = r.id; clip.audio.sampleName = files[0].name; }, { structure: true });
    } catch (e) { M.toast('Audio konnte nicht gelesen werden'); }
  };

  /** Per-frame playhead in the editor */
  M.updateEditor = function () {
    if (!roll || !roll.clip) return;
    const pos = T.clipPlayhead(roll.track.id, roll.clip);
    if (roll.draw) {
      if (!roll.canvas.isConnected) { roll = null; return; }
      const key = pos == null ? null : Math.round(pos * 64) / 64;
      if (key !== roll.last) { roll.last = key; roll.draw(pos); }
    } else if (roll.stepsPh) {
      if (pos == null) { roll.stepsPh.style.display = 'none'; return; }
      roll.stepsPh.style.display = 'block';
      roll.stepsPh.style.transform = `translateX(${Math.floor(pos * 4) * 30}px)`;
    } else if (roll.wavePh) {
      if (pos == null) { roll.wavePh.style.display = 'none'; return; }
      roll.wavePh.style.display = 'block';
      roll.wavePh.style.transform = `translateX(${pos / roll.clip.length * roll.waveW()}px)`;
    }
  };
})(window.M);
