/* Musii – device chain (instrument + effects) and the live play surface */
(function (M) {
  'use strict';
  const h = M.h, T = M.Transport;
  M.state.selPad = 0;
  M.state.kbOct = 4;

  const pct = (v) => Math.round(v * 100) + '%';
  const sec = (v) => (v < 1 ? Math.round(v * 1000) + ' ms' : v.toFixed(2) + ' s');

  function synthCards(track) {
    const p = track.instrument;
    const k = (label, key, min, max, def, fmt, step) => M.knob({
      label, value: p[key], min, max, def, fmt, step,
      onChange: (v) => { p[key] = v; p.preset = p.preset && p.preset.endsWith('*') ? p.preset : (p.preset || 'Init') + '*'; M.paramChanged(); }
    });
    const waves = [{ value: 'sawtooth', label: 'Saw' }, { value: 'square', label: 'Square' }, { value: 'triangle', label: 'Triangle' }, { value: 'sine', label: 'Sine' }];
    const preset = M.select(
      Object.keys(M.SYNTH_PRESETS).map((n) => ({ value: n, label: n })).concat(p.preset && !M.SYNTH_PRESETS[p.preset] ? [{ value: p.preset, label: p.preset }] : []),
      p.preset || 'Init',
      (v) => { M.change(() => { Object.assign(track.instrument, M.deepCopy(M.SYNTH_PRESETS[v]), { preset: v }); }, { params: true }); M.renderPanel(); }, 'small');
    return [
      M.card('Synth', { extra: preset, cls: 'instr' },
        h('div', { class: 'card-col' },
          h('label', { class: 'mini-lab' }, 'Osz 1', M.select(waves, p.osc1, (v) => { M.snapshot(); p.osc1 = v; M.paramChanged(); }, 'small')),
          h('label', { class: 'mini-lab' }, 'Osz 2', M.select(waves, p.osc2, (v) => { M.snapshot(); p.osc2 = v; M.paramChanged(); }, 'small'))),
        k('Halbton 2', 'semi2', -24, 24, 0, (v) => (v > 0 ? '+' : '') + Math.round(v), 1),
        k('Verstimm.', 'detune', 0, 50, 7, (v) => Math.round(v) + ' ct'),
        k('Mix', 'mix', 0, 1, 0.4, pct),
        k('Sub', 'sub', 0, 1, 0.2, pct),
        k('Oktave', 'octave', -2, 2, 0, (v) => (v > 0 ? '+' : '') + Math.round(v), 1),
        k('Lautst.', 'gain', 0, 1, 0.55, pct)),
      M.card('Filter', { cls: 'instr' },
        k('Cutoff', 'cutoff', 0, 1, 0.65, (v) => { const f = 30 * Math.pow(2, v * 9.4); return f >= 1000 ? (f / 1000).toFixed(1) + 'k' : Math.round(f) + ''; }),
        k('Reso', 'res', 0, 1, 0.15, pct),
        k('Env', 'envAmt', 0, 1, 0.3, pct),
        k('F-Decay', 'fd', 0.01, 2, 0.3, sec)),
      M.card('Hüllkurve', { cls: 'instr' },
        k('Attack', 'a', 0.001, 2, 0.005, sec),
        k('Decay', 'd', 0.01, 2, 0.3, sec),
        k('Sustain', 's', 0, 1, 0.7, pct),
        k('Release', 'r', 0.01, 3, 0.25, sec))
    ];
  }

  function drumCard(track) {
    const pads = track.instrument.pads;
    const sel = M.state.selPad;
    const grid = h('div', { class: 'pad-sel' });
    M.DRUM_PADS.forEach((pd, i) => {
      const b = h('button', { class: 'pad-mini' + (i === sel ? ' on' : '') }, pd.name);
      b.addEventListener('pointerdown', () => { T.noteOn('dp', M.DRUM_BASE + i, 0.9); });
      b.addEventListener('click', () => { M.state.selPad = i; M.renderPanel(); });
      grid.appendChild(b);
    });
    const pp = pads[sel];
    return M.card('Drum-Kit', { cls: 'instr wide' }, grid,
      h('div', { class: 'card-col' }, h('div', { class: 'pad-title' }, M.DRUM_PADS[sel].name)),
      M.knob({ label: 'Tune', value: pp.tune, min: -12, max: 12, def: 0, bipolar: true, step: 0.5, fmt: (v) => (v > 0 ? '+' : '') + v.toFixed(1) + ' st', onChange: (v) => { pp.tune = v; M.paramChanged(); } }),
      M.knob({ label: 'Decay', value: pp.decay, min: 0.2, max: 3, def: 1, fmt: (v) => Math.round(v * 100) + '%', onChange: (v) => { pp.decay = v; M.paramChanged(); } }),
      M.knob({ label: 'Level', value: pp.level, min: 0, max: 1.2, def: 0.9, fmt: pct, onChange: (v) => { pp.level = v; M.paramChanged(); } }));
  }

  function fxCards(track) {
    const fx = track.fx;
    const tog = (obj) => (v) => { M.snapshot(); obj.on = v; M.paramChanged(); M.renderPanel(); };
    const db = (v) => (v > 0 ? '+' : '') + v.toFixed(1) + ' dB';
    const ftype = M.select([{ value: 'lowpass', label: 'Tiefpass' }, { value: 'highpass', label: 'Hochpass' }, { value: 'bandpass', label: 'Bandpass' }],
      fx.filter.type, (v) => { M.snapshot(); fx.filter.type = v; M.paramChanged(); }, 'small');
    return [
      M.card('EQ', { toggle: tog(fx.eq), on: fx.eq.on },
        M.knob({ label: 'Tiefen', value: fx.eq.low, min: -15, max: 15, def: 0, bipolar: true, fmt: db, onChange: (v) => { fx.eq.low = v; M.paramChanged(); } }),
        M.knob({ label: 'Mitten', value: fx.eq.mid, min: -15, max: 15, def: 0, bipolar: true, fmt: db, onChange: (v) => { fx.eq.mid = v; M.paramChanged(); } }),
        M.knob({ label: 'Höhen', value: fx.eq.high, min: -15, max: 15, def: 0, bipolar: true, fmt: db, onChange: (v) => { fx.eq.high = v; M.paramChanged(); } })),
      M.card('Filter', { toggle: tog(fx.filter), on: fx.filter.on, extra: ftype },
        M.knob({ label: 'Freq', value: fx.filter.cutoff, min: 0, max: 1, def: 1, fmt: (v) => { const f = 30 * Math.pow(2, v * 9.4); return f >= 1000 ? (f / 1000).toFixed(1) + 'k' : Math.round(f) + ''; }, onChange: (v) => { fx.filter.cutoff = v; M.paramChanged(); } }),
        M.knob({ label: 'Reso', value: fx.filter.res, min: 0, max: 1, def: 0.1, fmt: pct, onChange: (v) => { fx.filter.res = v; M.paramChanged(); } })),
      M.card('Sättigung', { toggle: tog(fx.drive), on: fx.drive.on },
        M.knob({ label: 'Drive', value: fx.drive.amount, min: 0, max: 1, def: 0.3, fmt: pct, onChange: (v) => { fx.drive.amount = v; M.paramChanged(); } })),
      M.card('Kompressor', { toggle: tog(fx.comp), on: fx.comp.on },
        M.knob({ label: 'Thresh.', value: fx.comp.threshold, min: -50, max: 0, def: -18, fmt: (v) => v.toFixed(0) + ' dB', onChange: (v) => { fx.comp.threshold = v; M.paramChanged(); } }),
        M.knob({ label: 'Ratio', value: fx.comp.ratio, min: 1, max: 20, def: 4, fmt: (v) => v.toFixed(1) + ':1', onChange: (v) => { fx.comp.ratio = v; M.paramChanged(); } })),
      M.card('Sends', {},
        M.knob({ label: 'Hall', value: track.mixer.sendA, min: 0, max: 1, def: 0, color: '#6f8cff', fmt: pct, onChange: (v) => { track.mixer.sendA = v; M.paramChanged(); } }),
        M.knob({ label: 'Delay', value: track.mixer.sendB, min: 0, max: 1, def: 0, color: '#3fd0c9', fmt: pct, onChange: (v) => { track.mixer.sendB = v; M.paramChanged(); } }),
        M.knob({ label: 'Pan', value: track.mixer.pan, min: -1, max: 1, def: 0, bipolar: true, fmt: (v) => (Math.abs(v) < 0.02 ? 'C' : (v < 0 ? 'L' : 'R') + Math.round(Math.abs(v) * 50)), onChange: (v) => { track.mixer.pan = v; M.paramChanged(); } }))
    ];
  }

  M.renderDevices = function (root) {
    const track = M.selectedTrack();
    if (!track) { root.appendChild(h('div', { class: 'empty-hint' }, 'Keine Spur ausgewählt')); return; }
    const row = h('div', { class: 'devices' });
    row.appendChild(h('div', { class: 'dev-track', style: { '--tc': track.color } }, track.name));
    if (track.type === 'synth') synthCards(track).forEach((c) => row.appendChild(c));
    else if (track.type === 'drums') row.appendChild(drumCard(track));
    else row.appendChild(M.card('Audio-Spur', { cls: 'instr' }, h('div', { class: 'card-note' }, 'Spielt Audio-Clips. Schalte die Spur scharf (●) und tippe in der Session auf einen leeren Slot, um mit dem Mikrofon aufzunehmen.')));
    row.appendChild(h('div', { class: 'dev-arrow' }, M.icon('arrow', 16)));
    fxCards(track).forEach((c) => row.appendChild(c));
    root.appendChild(row);
  };

  /* ---------------- play surface ---------------- */
  M.renderPlay = function (root) {
    const track = M.selectedTrack();
    if (!track) return;
    const wrap = h('div', { class: 'play' });
    const side = h('div', { class: 'play-side' },
      h('div', { class: 'dev-track', style: { '--tc': track.color } }, track.name),
      M.toggleBtn('Overdub', M.state.overdub, (v) => { M.state.overdub = v; M.emit('overdub'); }, 'overdub'),
      h('div', { class: 'card-note' }, M.state.overdub ? 'Gespielte Noten werden in den laufenden Clip dieser Spur geschrieben.' : 'Spiele live. Mit „Overdub“ nimmst du in den laufenden Clip auf.'));
    wrap.appendChild(side);

    if (track.type === 'drums') {
      const pads = h('div', { class: 'pads' });
      [4, 5, 6, 7, 0, 1, 2, 3].forEach((i) => {
        const pd = h('div', { class: 'pad', style: { '--tc': track.color } }, h('span', null, M.DRUM_PADS[i].name));
        pd.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          const r = pd.getBoundingClientRect();
          const vel = M.clamp(0.55 + (1 - (e.clientY - r.top) / r.height) * 0.45, 0.4, 1);
          pd.classList.add('hit');
          T.noteOn('pad' + e.pointerId, M.DRUM_BASE + i, vel);
          setTimeout(() => pd.classList.remove('hit'), 120);
        });
        pads.appendChild(pd);
      });
      wrap.appendChild(pads);
    } else if (track.type === 'synth') {
      const kb = h('div', { class: 'keyboard' });
      const octCtl = h('div', { class: 'oct-ctl' },
        M.iconBtn('minus', 'Oktave runter', () => { M.state.kbOct = Math.max(1, M.state.kbOct - 1); M.renderPanel(); }),
        h('span', null, 'C' + M.state.kbOct),
        M.iconBtn('plus', 'Oktave hoch', () => { M.state.kbOct = Math.min(7, M.state.kbOct + 1); M.renderPanel(); }));
      side.appendChild(octCtl);
      const start = (M.state.kbOct + 1) * 12;
      const whites = [];
      for (let p = start; p <= start + 24; p++) if (!M.isBlack(p)) whites.push(p);
      const ww = 100 / whites.length;
      whites.forEach((p, i) => {
        const k = h('div', { class: 'wkey', style: { left: (i * ww) + '%', width: ww + '%' }, 'data-p': p }, p % 12 === 0 ? h('span', null, M.noteName(p)) : null);
        kb.appendChild(k);
        if (M.isBlack(p + 1) && p + 1 <= start + 24) {
          kb.appendChild(h('div', { class: 'bkey', style: { left: ((i + 1) * ww - ww * 0.32) + '%', width: (ww * 0.64) + '%' }, 'data-p': p + 1 }));
        }
      });
      // multi-touch with glissando
      const active = new Map();
      const keyAt = (x, y) => {
        const el = document.elementFromPoint(x, y);
        return el && el.closest && el.closest('[data-p]');
      };
      const press = (id, el) => {
        const cur = active.get(id);
        if (cur && cur.el === el) return;
        if (cur) { T.noteOff('kb' + id); cur.el.classList.remove('down'); }
        if (!el) { active.delete(id); return; }
        active.set(id, { el });
        el.classList.add('down');
        T.noteOn('kb' + id, Number(el.dataset.p), 0.85);
      };
      kb.addEventListener('pointerdown', (e) => { e.preventDefault(); kb.setPointerCapture(e.pointerId); press(e.pointerId, keyAt(e.clientX, e.clientY)); });
      kb.addEventListener('pointermove', (e) => { if (active.has(e.pointerId)) press(e.pointerId, keyAt(e.clientX, e.clientY)); });
      const rel = (e) => { const cur = active.get(e.pointerId); if (cur) { T.noteOff('kb' + e.pointerId); cur.el.classList.remove('down'); active.delete(e.pointerId); } };
      kb.addEventListener('pointerup', rel); kb.addEventListener('pointercancel', rel);
      wrap.appendChild(kb);
    } else {
      wrap.appendChild(h('div', { class: 'empty-hint' }, 'Audio-Spuren werden über Aufnahme oder importierte Dateien gespielt.'));
    }
    root.appendChild(wrap);
  };
})(window.M);
