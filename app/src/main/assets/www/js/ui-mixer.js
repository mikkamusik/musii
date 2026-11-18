/* Musii – Mixer view: channel strips, returns and master */
(function (M) {
  'use strict';
  const h = M.h, T = M.Transport;
  const meters = [];   // {fader, get()}

  function strip({ name, color, sel, onSel, mixer, kind, extra, meterNode }) {
    const el = h('div', { class: 'strip' + (sel ? ' sel' : '') + (kind ? ' ' + kind : ''), style: { '--tc': color } });
    const head = h('div', { class: 'strip-name' }, name);
    if (onSel) M.gestures(head, onSel);
    el.appendChild(head);
    const knobs = h('div', { class: 'strip-knobs' });
    (extra || []).forEach((k) => knobs.appendChild(k));
    el.appendChild(knobs);
    const db = h('div', { class: 'strip-db' }, M.fmtDb(M.faderToDb(mixer.vol)));
    const fader = M.fader({
      value: mixer.vol,
      onChange: (v) => { mixer.vol = v; db.textContent = M.fmtDb(M.faderToDb(v)); M.paramChanged(); }
    });
    el.appendChild(fader);
    el.appendChild(db);
    meters.push({ fader, node: meterNode });
    return el;
  }

  M.renderMixer = function (root) {
    const p = M.state.project;
    const eng = T.engine;
    meters.length = 0;
    const wrap = h('div', { class: 'mixer' });

    p.tracks.forEach((track) => {
      const m = track.mixer;
      const extra = [
        M.knob({ label: 'Pan', value: m.pan, min: -1, max: 1, def: 0, bipolar: true, small: true,
          fmt: (v) => (Math.abs(v) < 0.02 ? 'C' : (v < 0 ? 'L' : 'R') + Math.round(Math.abs(v) * 50)),
          onChange: (v) => { m.pan = v; M.paramChanged(); } }),
        M.knob({ label: 'Hall', value: m.sendA, min: 0, max: 1, def: 0, small: true, color: '#6f8cff',
          fmt: (v) => Math.round(v * 100) + '%', onChange: (v) => { m.sendA = v; M.paramChanged(); } }),
        M.knob({ label: 'Delay', value: m.sendB, min: 0, max: 1, def: 0, small: true, color: '#3fd0c9',
          fmt: (v) => Math.round(v * 100) + '%', onChange: (v) => { m.sendB = v; M.paramChanged(); } }),
        h('div', { class: 'strip-btns' },
          M.toggleBtn('M', m.mute, (v) => { M.snapshot(); m.mute = v; M.paramChanged(); }, 'mute'),
          M.toggleBtn('S', m.solo, (v) => { M.snapshot(); m.solo = v; M.paramChanged(); }, 'solo'),
          track.type === 'audio' ? M.toggleBtn('●', m.arm, (v) => { M.snapshot(); m.arm = v; M.emit('change', {}); }, 'arm') : null)
      ];
      const s = eng.strip(track.id);
      wrap.appendChild(strip({
        name: track.name, color: track.color, sel: M.state.selTrack === track.id, mixer: m, extra,
        meterNode: s && s.meter,
        onSel: { tap: () => { M.state.selTrack = track.id; M.emit('select'); }, dbl: () => { M.state.selTrack = track.id; M.openPanel('devices'); }, long: (e) => M.trackMenu(e, track) }
      }));
    });

    wrap.appendChild(h('div', { class: 'strip-gap' }));
    const ra = p.returns.a, rb = p.returns.b;
    wrap.appendChild(strip({
      name: 'A · Hall', color: '#6f8cff', mixer: ra, kind: 'ret', meterNode: eng.retA.meter,
      extra: [M.knob({ label: 'Größe', value: ra.size, min: 0, max: 1, def: 0.55, small: true, color: '#6f8cff',
        fmt: (v) => (0.6 + v * 4.4).toFixed(1) + 's', onChange: (v) => { ra.size = Math.round(v * 50) / 50; M.paramChanged(); } })]
    }));
    const times = [0.25, 0.5, 0.75, 1, 1.5, 2];
    const tnames = { 0.25: '1/16', 0.5: '1/8', 0.75: '3/16', 1: '1/4', 1.5: '3/8', 2: '1/2' };
    wrap.appendChild(strip({
      name: 'B · Delay', color: '#3fd0c9', mixer: rb, kind: 'ret', meterNode: eng.retB.meter,
      extra: [
        M.knob({ label: 'Zeit', value: times.indexOf(rb.time) < 0 ? 2 : times.indexOf(rb.time), min: 0, max: 5, step: 1, def: 2, small: true, color: '#3fd0c9',
          fmt: (v) => tnames[times[Math.round(v)]], onChange: (v) => { rb.time = times[Math.round(v)]; M.paramChanged(); } }),
        M.knob({ label: 'Feedb.', value: rb.feedback, min: 0, max: 0.9, def: 0.35, small: true, color: '#3fd0c9',
          fmt: (v) => Math.round(v * 100) + '%', onChange: (v) => { rb.feedback = v; M.paramChanged(); } })
      ]
    }));
    wrap.appendChild(strip({ name: 'Master', color: '#ffb347', mixer: p.master, kind: 'master', meterNode: eng.masterMeter }));
    root.appendChild(wrap);
  };

  M.updateMixer = function () {
    const eng = T.engine;
    meters.forEach((m) => { if (m.node && m.fader.isConnected) m.fader.setLevel(eng.level(m.node)); });
  };
})(window.M);
