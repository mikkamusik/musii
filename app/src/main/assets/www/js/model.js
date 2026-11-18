/* Musii – project data model, factories, presets, demo song and undo history */
(function (M) {
  'use strict';

  M.SYNTH_PRESETS = {
    Init:  { osc1: 'sawtooth', osc2: 'square', semi2: 0, detune: 7, mix: 0.4, sub: 0.2, cutoff: 0.65, res: 0.15, envAmt: 0.3, a: 0.005, d: 0.3, s: 0.7, r: 0.25, fd: 0.3, gain: 0.55, octave: 0, glideOff: 0 },
    Bass:  { osc1: 'sawtooth', osc2: 'square', semi2: -12, detune: 4, mix: 0.35, sub: 0.55, cutoff: 0.36, res: 0.28, envAmt: 0.45, a: 0.003, d: 0.18, s: 0.45, r: 0.08, fd: 0.16, gain: 0.6, octave: 0 },
    Pad:   { osc1: 'sawtooth', osc2: 'sawtooth', semi2: 0, detune: 14, mix: 0.5, sub: 0.1, cutoff: 0.5, res: 0.1, envAmt: 0.2, a: 0.55, d: 1.0, s: 0.8, r: 1.3, fd: 1.2, gain: 0.38, octave: 0 },
    Pluck: { osc1: 'sawtooth', osc2: 'square', semi2: 12, detune: 5, mix: 0.3, sub: 0.0, cutoff: 0.3, res: 0.3, envAmt: 0.7, a: 0.002, d: 0.22, s: 0.0, r: 0.25, fd: 0.2, gain: 0.5, octave: 0 },
    Lead:  { osc1: 'square', osc2: 'sawtooth', semi2: 0, detune: 9, mix: 0.5, sub: 0.15, cutoff: 0.6, res: 0.25, envAmt: 0.3, a: 0.01, d: 0.3, s: 0.7, r: 0.2, fd: 0.3, gain: 0.45, octave: 0 },
    Keys:  { osc1: 'triangle', osc2: 'sine', semi2: 12, detune: 3, mix: 0.35, sub: 0.0, cutoff: 0.72, res: 0.05, envAmt: 0.15, a: 0.004, d: 0.8, s: 0.3, r: 0.4, fd: 0.6, gain: 0.6, octave: 0 }
  };

  M.DRUM_PADS = [
    { name: 'Kick', kind: 'kick' },
    { name: 'Snare', kind: 'snare' },
    { name: 'Clap', kind: 'clap' },
    { name: 'Hat zu', kind: 'chh' },
    { name: 'Hat offen', kind: 'ohh' },
    { name: 'Tom tief', kind: 'tomlo' },
    { name: 'Tom hoch', kind: 'tomhi' },
    { name: 'Rim', kind: 'rim' }
  ];
  M.DRUM_BASE = 36; // pad i plays pitch 36 + i

  M.defaultInstrument = function (type, preset) {
    if (type === 'synth') return Object.assign({ preset: preset || 'Init' }, M.deepCopy(M.SYNTH_PRESETS[preset || 'Init']));
    if (type === 'drums') return { pads: M.DRUM_PADS.map(() => ({ tune: 0, decay: 1, level: 0.9 })) };
    return {};
  };

  M.defaultFx = () => ({
    eq: { on: false, low: 0, mid: 0, high: 0 },
    filter: { on: false, type: 'lowpass', cutoff: 1, res: 0.1 },
    drive: { on: false, amount: 0.3 },
    comp: { on: false, threshold: -18, ratio: 4 }
  });

  M.newTrack = function (type, name, color, numScenes, preset) {
    return {
      id: 't_' + M.uid(),
      name: name || (type === 'drums' ? 'Drums' : type === 'audio' ? 'Audio' : 'Synth'),
      type,
      color: color || M.colorAt(Math.floor(Math.random() * 16)),
      instrument: M.defaultInstrument(type, preset),
      mixer: { vol: 0.8, pan: 0, mute: false, solo: false, arm: false, sendA: 0, sendB: 0 },
      fx: M.defaultFx(),
      slots: new Array(numScenes).fill(null),
      arr: []
    };
  };

  M.newClip = function (name, length, color) {
    return { id: 'c_' + M.uid(), name: name || 'Clip', color: color || '#888', length: length || 4, notes: [], audio: null };
  };

  M.newProject = function () {
    const p = {
      version: 1,
      name: 'Neues Projekt',
      bpm: 120,
      scenes: [],
      tracks: [],
      markers: [],
      returns: { a: { size: 0.55, vol: 0.8 }, b: { time: 0.75, feedback: 0.35, vol: 0.7 } },
      master: { vol: 0.8 },
      loop: { on: false, start: 0, end: 16 },
      quant: 4,
      metronome: false
    };
    for (let i = 0; i < 8; i++) p.scenes.push({ id: 'sc_' + M.uid(), name: String(i + 1) });
    p.tracks.push(M.newTrack('drums', 'Drums', M.COLORS[1], 8));
    p.tracks.push(M.newTrack('synth', 'Synth', M.COLORS[7], 8, 'Init'));
    p.tracks.push(M.newTrack('audio', 'Audio', M.COLORS[10], 8));
    return p;
  };

  /* ---------- demo song (original material) ---------- */
  function drumClip(name, bars, pattern, color) {
    // pattern: {padIndex: 'x...x...' string of 16 per bar, X = accent}
    const c = M.newClip(name, bars * 4, color);
    for (const pad in pattern) {
      const str = pattern[pad];
      for (let i = 0; i < str.length; i++) {
        const ch = str[i];
        if (ch === '.' || ch === ' ') continue;
        c.notes.push({ p: M.DRUM_BASE + Number(pad), t: i * 0.25, d: 0.25, v: ch === 'X' ? 1 : ch === 'o' ? 0.55 : 0.8 });
      }
    }
    return c;
  }

  M.demoProject = function () {
    const p = M.newProject();
    p.name = 'Demo – Nachtfahrt';
    p.bpm = 124;
    p.scenes = ['Intro', 'Groove', 'Peak', 'Break', 'Outro', '6', '7', '8'].map((n) => ({ id: 'sc_' + M.uid(), name: n }));
    const drums = M.newTrack('drums', 'Drums', M.COLORS[1], 8);
    const bass = M.newTrack('synth', 'Bass', M.COLORS[8], 8, 'Bass');
    const chords = M.newTrack('synth', 'Chords', M.COLORS[6], 8, 'Pad');
    const arp = M.newTrack('synth', 'Arp', M.COLORS[11], 8, 'Pluck');
    const audio = M.newTrack('audio', 'Vocals', M.COLORS[3], 8);
    chords.mixer.sendA = 0.35; arp.mixer.sendB = 0.3; arp.mixer.sendA = 0.2; arp.mixer.vol = 0.7;
    bass.mixer.vol = 0.76; chords.mixer.vol = 0.66;

    const four = 'X...X...X...X...';
    drums.slots[0] = drumClip('Intro', 1, { 0: four, 3: '..x...x...x...x.' }, M.COLORS[1]);
    drums.slots[1] = drumClip('Beat A', 1, { 0: four, 2: '....x.......x...', 3: '..x...x...x...x.', 7: '...........o....' }, M.COLORS[1]);
    drums.slots[2] = drumClip('Beat B', 2, {
      0: four + four, 2: '....x.......x.......x.......x..o',
      3: 'oxo.oxo.oxo.oxo.oxo.oxo.oxo.oxoo', 4: '..x...x...x...x...x...x...x.....', 7: '...o.......o.......o.....o.o....'
    }, M.COLORS[0]);
    drums.slots[3] = drumClip('Hats', 1, { 3: '..x...x...x...x.', 4: '..............x.' }, M.COLORS[1]);
    drums.slots[4] = drumClip('Fill', 1, { 0: 'X.......X.......', 1: '....x.x.xxxxXXXX', 5: '..........o.o...', 6: '........o.o.....' }, M.COLORS[2]);

    // A minor: Am | F | C | G
    const roots = [33, 29, 36, 31];
    const chordsN = [[57, 60, 64], [53, 57, 60], [55, 60, 64], [55, 59, 62]];
    const bassA = M.newClip('Offbeat', 16, M.COLORS[8]);
    const bassB = M.newClip('Rollend', 16, M.COLORS[9]);
    roots.forEach((r, bar) => {
      for (let i = 0; i < 4; i++) bassA.notes.push({ p: r + 12, t: bar * 4 + i + 0.5, d: 0.4, v: 0.85 });
      for (let i = 0; i < 16; i++) {
        if (i % 4 === 0) continue;
        bassB.notes.push({ p: r + (i % 4 === 2 ? 24 : 12), t: bar * 4 + i * 0.25, d: 0.2, v: i % 4 === 2 ? 0.9 : 0.7 });
      }
    });
    const pad = M.newClip('Akkorde', 16, M.COLORS[6]);
    const stabs = M.newClip('Stabs', 16, M.COLORS[5]);
    chordsN.forEach((ch, bar) => ch.forEach((n) => {
      pad.notes.push({ p: n, t: bar * 4, d: 3.9, v: 0.7 });
      [0, 1.5, 3].forEach((o) => stabs.notes.push({ p: n + 12, t: bar * 4 + o, d: 0.3, v: 0.75 }));
    }));
    const arpA = M.newClip('Arp', 16, M.COLORS[11]);
    const arpB = M.newClip('Arp hoch', 16, M.COLORS[10]);
    chordsN.forEach((ch, bar) => {
      const seq = [ch[0] + 12, ch[1] + 12, ch[2] + 12, ch[1] + 12];
      for (let i = 0; i < 16; i++) {
        arpA.notes.push({ p: seq[i % 4], t: bar * 4 + i * 0.25, d: 0.2, v: i % 4 === 0 ? 0.9 : 0.65 });
        arpB.notes.push({ p: seq[(i * 3) % 4] + 12, t: bar * 4 + i * 0.25, d: 0.18, v: i % 2 ? 0.6 : 0.85 });
      }
    });

    chords.slots[0] = pad;
    bass.slots[1] = bassA; chords.slots[1] = M.deepCopy(pad); chords.slots[1].id = 'c_' + M.uid();
    bass.slots[2] = bassB; chords.slots[2] = stabs; arp.slots[2] = arpA;
    chords.slots[3] = M.deepCopy(pad); chords.slots[3].id = 'c_' + M.uid(); arp.slots[3] = arpB;
    bass.slots[4] = M.deepCopy(bassA); bass.slots[4].id = 'c_' + M.uid();

    p.tracks = [drums, bass, chords, arp, audio];
    p.loop = { on: false, start: 0, end: 16 };
    return p;
  };

  /* ---------- state + history ---------- */
  M.state = {
    project: null,
    view: 'session',          // session | arrange | mixer
    panel: 'clip',            // clip | devices | play
    panelOpen: true,
    selTrack: null,           // track id
    selSlot: null,            // {trackId, scene} or null
    selArr: null,             // {trackId, itemId}
    overdub: false,
    zoom: 24,                 // px per beat in arrangement
    projectKey: null
  };

  const undoStack = [], redoStack = [];
  let lastSnap = null;

  M.track = (id) => M.state.project.tracks.find((t) => t.id === id) || null;
  M.selectedTrack = () => M.track(M.state.selTrack) || M.state.project.tracks[0] || null;

  /** Call before mutating the project to make the change undoable. */
  M.snapshot = function () {
    undoStack.push(JSON.stringify(M.state.project));
    if (undoStack.length > 60) undoStack.shift();
    redoStack.length = 0;
  };
  /** Mutate + notify. */
  M.change = function (fn, opts) {
    M.snapshot();
    fn(M.state.project);
    M.emit('change', opts || {});
  };
  M.undo = function () {
    if (!undoStack.length) { M.toast('Nichts rückgängig zu machen'); return; }
    redoStack.push(JSON.stringify(M.state.project));
    M.state.project = JSON.parse(undoStack.pop());
    M.emit('change', { structure: true });
  };
  M.redo = function () {
    if (!redoStack.length) return;
    undoStack.push(JSON.stringify(M.state.project));
    M.state.project = JSON.parse(redoStack.pop());
    M.emit('change', { structure: true });
  };
  M.clearHistory = () => { undoStack.length = 0; redoStack.length = 0; lastSnap = null; };

  M.setProject = function (p) {
    // fill gaps from older / imported data
    const base = M.newProject();
    for (const k in base) if (p[k] === undefined) p[k] = base[k];
    p.tracks.forEach((t) => {
      t.fx = Object.assign(M.defaultFx(), t.fx || {});
      t.mixer = Object.assign({ vol: 0.8, pan: 0, mute: false, solo: false, arm: false, sendA: 0, sendB: 0 }, t.mixer || {});
      if (!t.instrument || (t.type === 'drums' && !t.instrument.pads)) t.instrument = M.defaultInstrument(t.type);
      while (t.slots.length < p.scenes.length) t.slots.push(null);
      t.arr = t.arr || [];
    });
    M.state.project = p;
    M.state.selTrack = p.tracks[0] ? p.tracks[0].id : null;
    M.state.selSlot = null;
    M.state.selArr = null;
    M.clearHistory();
    M.emit('change', { structure: true, newProject: true });
  };

  /** End of arrangement content in beats */
  M.arrangementEnd = function (p) {
    let end = 0;
    (p || M.state.project).tracks.forEach((t) => t.arr.forEach((it) => { end = Math.max(end, it.start + it.dur); }));
    return end;
  };
})(window.M);
