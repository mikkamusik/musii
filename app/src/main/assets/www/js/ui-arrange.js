/* Musii – Arrangement view: timeline with clips, markers, loop brace and playhead */
(function (M) {
  'use strict';
  const h = M.h, T = M.Transport;
  const LANE_H = 54, HEAD_W = 118, RULER_H = 34;

  function selectItem(track, it) {
    M.state.selTrack = track.id;
    M.state.selArr = { trackId: track.id, itemId: it.id };
    M.state.selSlot = null;
    M.emit('select');
  }

  function snapUnit() {
    const z = M.state.zoom;
    return z >= 40 ? 0.25 : z >= 18 ? 1 : 4;
  }
  const snap = (b, u) => Math.round(b / u) * u;

  /** Draws a clip preview into a canvas (notes or waveform). */
  M.drawClipPreview = function (cv, clip, itemDur, offset, color) {
    const w = cv.width, ht = cv.height, ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, w, ht);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    const dur = itemDur || clip.length;
    const pxPerBeat = w / dur;
    if (clip.audio) {
      const buf = M.Samples.get(clip.audio.sampleId);
      if (!buf) return;
      const a = clip.audio;
      const src = a.warp !== false ? (a.srcBpm || M.state.project.bpm) : M.state.project.bpm;
      const data = buf.getChannelData(0);
      const sr = buf.sampleRate;
      const mid = ht / 2;
      ctx.beginPath();
      for (let x = 0; x < w; x++) {
        const beat = x / pxPerBeat + (offset || 0);
        const local = ((beat % clip.length) + clip.length) % clip.length;
        const s0 = Math.floor(((a.startSec || 0) + local * 60 / src) * sr);
        const s1 = s0 + Math.max(1, Math.floor((60 / src) * sr / pxPerBeat));
        let pk = 0;
        for (let i = s0; i < s1 && i < data.length; i += Math.max(1, Math.floor((s1 - s0) / 32))) {
          const v = Math.abs(data[i] || 0); if (v > pk) pk = v;
        }
        const y = pk * mid * 0.95;
        ctx.moveTo(x + 0.5, mid - y); ctx.lineTo(x + 0.5, mid + y);
      }
      ctx.lineWidth = 1;
      ctx.stroke();
      return;
    }
    const notes = clip.notes || [];
    if (!notes.length) return;
    let lo = 127, hi = 0;
    notes.forEach((n) => { lo = Math.min(lo, n.p); hi = Math.max(hi, n.p); });
    lo -= 1; hi += 1;
    const rowH = Math.max(1.5, Math.min(5, ht / (hi - lo + 1)));
    const usedH = rowH * (hi - lo + 1);
    const y0 = (ht - usedH) / 2;
    const reps = Math.ceil((dur + (offset || 0)) / clip.length) + 1;
    for (let k = 0; k < reps; k++) {
      notes.forEach((n) => {
        const b = k * clip.length + n.t - (offset || 0);
        if (b + n.d < 0 || b >= dur) return;
        const x = b * pxPerBeat, wd = Math.max(1.5, n.d * pxPerBeat - 1);
        const y = y0 + (hi - n.p) * rowH;
        ctx.fillRect(x, y, wd, Math.max(1, rowH - 0.5));
      });
    }
  };

  function itemMenu(e, track, it) {
    const p = M.state.project;
    M.menu(e.clientX, e.clientY, [
      { label: 'Bearbeiten', action: () => { selectItem(track, it); M.openPanel('clip'); } },
      { label: 'Umbenennen', action: async () => { const n = await M.promptText('Clip umbenennen', it.clip.name); if (n != null) M.change(() => { it.clip.name = n; }, { structure: true }); } },
      { label: 'Farbe', action: () => M.colorPicker(e.clientX, e.clientY, (c) => M.change(() => { it.clip.color = c; }, { structure: true })) },
      { label: 'Duplizieren (dahinter)', action: () => M.change(() => {
        const n = M.deepCopy(it); n.id = 'i_' + M.uid(); n.clip.id = 'c_' + M.uid(); n.start = it.start + it.dur;
        track.arr.push(n);
      }, { structure: true }) },
      { label: 'Am Abspielkopf teilen', disabled: !(T.arrPos() > it.start && T.arrPos() < it.start + it.dur), action: () => M.change(() => {
        const cut = snap(T.arrPos(), 0.25);
        const right = M.deepCopy(it); right.id = 'i_' + M.uid(); right.clip.id = 'c_' + M.uid();
        right.start = cut; right.dur = it.start + it.dur - cut; right.offset = (it.offset || 0) + (cut - it.start);
        it.dur = cut - it.start;
        track.arr.push(right);
      }, { structure: true }) },
      { label: 'In Session-Slot kopieren', action: () => {
        let idx = track.slots.findIndex((s) => !s);
        M.change(() => {
          if (idx < 0) { M.addSceneRaw(p.scenes.length); idx = p.scenes.length - 1; }
          const c = M.deepCopy(it.clip); c.id = 'c_' + M.uid(); track.slots[idx] = c;
        }, { structure: true });
        M.toast('In Szene ' + (idx + 1) + ' kopiert');
      } },
      { sep: true },
      { label: 'Löschen', danger: true, action: () => M.change(() => { track.arr = track.arr.filter((x) => x !== it); }, { structure: true }) }
    ], it.clip.name);
  }

  M.renderArrange = function (root) {
    const p = M.state.project;
    const z = M.state.zoom;
    const end = Math.max(M.arrangementEnd(p) + 32, 128, (p.loop.end || 0) + 16);
    const totalW = Math.ceil(end) * z;

    const wrap = h('div', { class: 'arr' });
    const scroller = h('div', { class: 'arr-scroll' });
    const content = h('div', { class: 'arr-content', style: { width: (HEAD_W + totalW) + 'px' } });

    // ---- ruler row ----
    const corner = h('div', { class: 'arr-corner', style: { width: HEAD_W + 'px', height: RULER_H + 'px' } },
      M.iconBtn('zoomOut', 'Verkleinern', () => { M.state.zoom = Math.max(3, z / 1.5); M.renderMain(); }),
      M.iconBtn('zoomIn', 'Vergrößern', () => { M.state.zoom = Math.min(120, z * 1.5); M.renderMain(); }));
    const ruler = h('div', { class: 'ruler', style: { width: totalW + 'px', height: RULER_H + 'px' } });
    const barStep = z >= 12 ? 1 : z >= 6 ? 2 : z >= 3.5 ? 4 : 8;
    for (let bar = 0; bar * 4 < end; bar += barStep) {
      ruler.appendChild(h('div', { class: 'tick', style: { left: (bar * 4 * z) + 'px' } }, String(bar + 1)));
    }
    (p.markers || []).forEach((mk) => {
      ruler.appendChild(h('div', { class: 'marker', style: { left: (mk.t * z) + 'px' }, title: mk.name }, mk.name));
    });
    const loopEl = h('div', { class: 'loop-brace' + (p.loop.on ? ' on' : ''), style: { left: (p.loop.start * z) + 'px', width: ((p.loop.end - p.loop.start) * z) + 'px' } });
    ruler.appendChild(loopEl);
    // ruler interaction: tap = seek, drag on lower half = set loop
    let dragLoop = null;
    M.drag(ruler, {
      start: (e) => {
        const r = ruler.getBoundingClientRect();
        const b = (e.clientX - r.left) / z;
        dragLoop = { b0: snap(b, 1), lower: e.clientY - r.top > RULER_H / 2, moved: false };
      },
      move: (e, dx) => {
        if (!dragLoop || !dragLoop.lower || Math.abs(dx) < 8) return;
        dragLoop.moved = true;
        const r = ruler.getBoundingClientRect();
        const b = snap((e.clientX - r.left) / z, snapUnit() < 1 ? 1 : snapUnit());
        const s = Math.max(0, Math.min(dragLoop.b0, b)), en = Math.max(dragLoop.b0, b);
        if (en - s >= 1) {
          p.loop.start = s; p.loop.end = en; p.loop.on = true;
          loopEl.style.left = (s * z) + 'px'; loopEl.style.width = ((en - s) * z) + 'px'; loopEl.classList.add('on');
        }
      },
      end: (e) => {
        if (dragLoop && !dragLoop.moved) {
          const r = ruler.getBoundingClientRect();
          T.seek(snap((e.clientX - r.left) / z, snapUnit()));
        } else if (dragLoop && dragLoop.moved) { M.emit('change', { loop: true }); }
        dragLoop = null;
      }
    });
    content.appendChild(h('div', { class: 'arr-row ruler-row' }, corner, ruler));

    // ---- lanes ----
    p.tracks.forEach((track) => {
      const head = h('div', { class: 'arr-head' + (M.state.selTrack === track.id ? ' sel' : ''), style: { width: HEAD_W + 'px', height: LANE_H + 'px', '--tc': track.color } },
        h('div', { class: 'arr-name' }, track.name),
        h('div', { class: 'arr-btns' },
          M.toggleBtn('M', track.mixer.mute, (v) => { M.snapshot(); track.mixer.mute = v; M.paramChanged(); }, 'mute'),
          M.toggleBtn('S', track.mixer.solo, (v) => { M.snapshot(); track.mixer.solo = v; M.paramChanged(); }, 'solo')));
      M.gestures(head, {
        tap: () => { M.state.selTrack = track.id; M.emit('select'); },
        long: (e) => M.trackMenu(e, track)
      });
      const lane = h('div', { class: 'lane' + (T.arrOff[track.id] ? ' off' : ''), style: { width: totalW + 'px', height: LANE_H + 'px', backgroundSize: (4 * z) + 'px 100%' } });
      M.gestures(lane, {
        dbl: (e) => {
          if (e.target !== lane || track.type === 'audio') return;
          const r = lane.getBoundingClientRect();
          const b = Math.floor((e.clientX - r.left) / z / 4) * 4;
          let item;
          M.change(() => {
            const c = M.newClip(track.type === 'drums' ? 'Beat' : 'Clip', 4, track.color);
            item = { id: 'i_' + M.uid(), start: b, dur: 4, offset: 0, clip: c };
            track.arr.push(item);
          }, { structure: true });
          selectItem(track, item);
          M.openPanel('clip');
        }
      });

      track.arr.forEach((it) => {
        const sel = M.state.selArr && M.state.selArr.itemId === it.id;
        const missing = it.clip.audio && !it.clip.audio.sampleId;
        const w = Math.max(4, it.dur * z);
        const el = h('div', {
          class: 'aclip' + (sel ? ' sel' : '') + (missing ? ' missing' : ''),
          style: { left: (it.start * z) + 'px', width: w + 'px', '--cc': it.clip.color || track.color }
        });
        el.appendChild(h('div', { class: 'aclip-name' }, it.clip.name + (missing ? ' (Sample fehlt)' : '')));
        const cv = h('canvas', { class: 'aclip-cv' });
        cv.width = Math.min(4000, Math.ceil(w)); cv.height = LANE_H - 18;
        el.appendChild(cv);
        M.drawClipPreview(cv, it.clip, it.dur, it.offset || 0);
        // loop markers
        if (it.clip.length < it.dur - 0.01 && it.clip.length * z > 6) {
          for (let b = it.clip.length - (it.offset || 0); b < it.dur; b += it.clip.length) {
            if (b > 0) el.appendChild(h('div', { class: 'aclip-loop', style: { left: (b * z) + 'px' } }));
          }
        }
        const handle = h('div', { class: 'aclip-resize' });
        el.appendChild(handle);

        // move
        let st = null;
        M.drag(el, {
          start: (e) => {
            if (e.target === handle) return false;
            st = { start: it.start, moved: false, track, lanes: null, t0: Date.now() };
          },
          move: (e, dx, dy) => {
            if (!st) return;
            if (!st.moved && Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
            if (!st.moved) { M.snapshot(); st.moved = true; el.classList.add('dragging'); }
            const ns = Math.max(0, snap(st.start + dx / z, snapUnit()));
            it.start = ns;
            el.style.left = (ns * z) + 'px';
            const dl = Math.round(dy / LANE_H);
            el.style.transform = `translateY(${dl * LANE_H}px)`;
            st.dl = dl;
          },
          end: (e) => {
            if (!st) return;
            el.classList.remove('dragging');
            el.style.transform = '';
            if (st.moved) {
              if (st.dl) {
                const tracks = M.state.project.tracks;
                const ti = tracks.indexOf(track) + st.dl;
                const dest = tracks[ti];
                if (dest && (dest.type === 'audio') === (track.type === 'audio')) {
                  track.arr = track.arr.filter((x) => x !== it);
                  dest.arr.push(it);
                  M.state.selArr = { trackId: dest.id, itemId: it.id };
                  M.state.selTrack = dest.id;
                }
              }
              M.emit('change', { structure: true });
            } else if (Date.now() - st.t0 < 450) {
              const now = Date.now();
              if (el._lastTap && now - el._lastTap < 320) { selectItem(track, it); M.openPanel('clip'); }
              else { selectItem(track, it); }
              el._lastTap = now;
            }
            st = null;
          }
        });
        // long press menu
        let lpTimer = null, lx = 0, ly = 0;
        el.addEventListener('pointerdown', (e) => { lx = e.clientX; ly = e.clientY; clearTimeout(lpTimer); lpTimer = setTimeout(() => { if (st && !st.moved) { st = null; itemMenu(e, track, it); } }, 520); });
        el.addEventListener('pointermove', (e) => { if (Math.abs(e.clientX - lx) > 8 || Math.abs(e.clientY - ly) > 8) clearTimeout(lpTimer); });
        el.addEventListener('pointerup', () => clearTimeout(lpTimer));
        el.addEventListener('contextmenu', (e) => { e.preventDefault(); itemMenu(e, track, it); });

        // resize
        let rs = null;
        M.drag(handle, {
          start: () => { rs = { dur: it.dur }; M.snapshot(); },
          move: (e, dx) => {
            const nd = Math.max(snapUnit(), snap(rs.dur + dx / z, snapUnit()));
            it.dur = nd;
            el.style.width = (nd * z) + 'px';
          },
          end: () => { rs = null; M.emit('change', { structure: true }); }
        });
        lane.appendChild(el);
      });
      content.appendChild(h('div', { class: 'arr-row' }, head, lane));
    });

    const addRow = h('div', { class: 'arr-row' },
      h('div', { class: 'arr-head add', style: { width: HEAD_W + 'px', height: '44px' } },
        h('button', { class: 'btn small', onclick: (e) => M.addTrackMenu(e) }, M.icon('plus', 14), ' Spur')));
    content.appendChild(addRow);

    const playhead = h('div', { class: 'playhead', style: { left: HEAD_W + 'px' } });
    content.appendChild(playhead);
    scroller.appendChild(content);
    wrap.appendChild(scroller);
    root.appendChild(wrap);
    if (M.state.arrScroll) { scroller.scrollLeft = M.state.arrScroll.x; scroller.scrollTop = M.state.arrScroll.y; }
    scroller.addEventListener('scroll', () => { M.state.arrScroll = { x: scroller.scrollLeft, y: scroller.scrollTop }; });
    M.updateArrange();
  };

  M.updateArrange = function () {
    const ph = M.$('.arr .playhead');
    if (!ph) return;
    const pos = T.playing ? T.arrPos() : T.pos;
    ph.style.transform = `translateX(${pos * M.state.zoom}px)`;
    if (T.playing && M.state.follow) {
      const sc = M.$('.arr-scroll');
      const x = pos * M.state.zoom;
      if (x > sc.scrollLeft + sc.clientWidth - HEAD_W - 40 || x < sc.scrollLeft) sc.scrollLeft = Math.max(0, x - 60);
    }
  };
})(window.M);
