/* Musii – transport, look-ahead scheduler, clip launching, recording, export */
(function (M) {
  'use strict';

  /* ---------- clip scheduling (shared by live playback and offline export) ---------- */
  M.Sched = {
    /**
     * Schedules the part of `clip` that falls into [from, to) (global beats).
     * originG: global beat where clip-local time 0 of loop iteration 0 sits.
     * endG: hard end (notes are cut there, audio stops there).
     */
    scheduleClip(engine, track, clip, originG, from, to, endG, keyPrefix, origin, toTime, bpm, started) {
      const len = clip.length;
      if (!(len > 0) || to <= from) return;
      from = Math.max(from, originG);
      if (to <= from) return;
      const k0 = Math.floor((from - originG) / len + 1e-9);
      const k1 = Math.floor((to - originG - 1e-9) / len);
      if (clip.audio) {
        const a = clip.audio;
        if (!M.Samples.get(a.sampleId)) return;
        const warp = a.warp !== false;
        const src = warp ? (a.srcBpm || bpm) : bpm;
        const rate = warp ? bpm / src : 1;
        for (let k = k0; k <= k1; k++) {
          const key = keyPrefix + ':' + k;
          if (started.has(key)) continue;
          const base = originG + k * len;
          const startG = Math.max(base, from);
          if (startG >= to) continue;
          const endIter = Math.min(base + len, endG);
          if (endIter <= startG + 1e-6) continue;
          started.add(key);
          const local = startG - base;
          const offSec = (a.startSec || 0) + local * 60 / src;
          const durSec = (endIter - startG) * 60 / src;
          engine.playAudio(track, clip, toTime(startG), offSec, durSec, rate, { origin, key });
        }
        return;
      }
      const notes = clip.notes;
      if (!notes || !notes.length) return;
      const spb = 60 / bpm;
      for (let k = k0; k <= k1; k++) {
        const base = originG + k * len;
        for (let i = 0; i < notes.length; i++) {
          const n = notes[i];
          if (n.t >= len || n.t < 0) continue;
          const g = base + n.t;
          if (g < from || g >= to) continue;
          const d = Math.min(n.d, len - n.t, endG - g);
          if (d <= 0) continue;
          engine.playNote(track, toTime(g), n.p, n.v, d * spb);
        }
      }
    }
  };

  /* ---------- live transport ---------- */
  const LOOKAHEAD = 0.12;
  const T = M.Transport = {
    ctx: null, engine: null,
    playing: false,
    g0: 0, t0: 0, schedG: 0,
    pos: 0,               // insert marker (arrangement position where play starts)
    arrStart: 0,
    sess: {},             // trackId -> {scene, origin, launchId, queued}
    arrOff: {},           // trackId -> true when the track left the arrangement for session clips
    started: new Set(),
    rec: null,            // audio recording state
    live: new Map(),      // pointerId -> held note
    timer: null,
    dirty: false          // set when launch states changed (UI refresh)
  };

  T.init = function (ctx, engine) {
    T.ctx = ctx; T.engine = engine;
    T.timer = setInterval(T.tick, 25);
  };

  const P = () => M.state.project;
  T.bpm = () => P().bpm;
  T.gNow = function () {
    if (!T.playing) return T.pos;
    return T.g0 + (T.ctx.currentTime - T.t0) * T.bpm() / 60;
  };
  T.timeAt = (g) => T.t0 + (g - T.g0) * 60 / T.bpm();

  /** Re-anchors the beat clock (call before changing BPM while playing). */
  T.reanchor = function () {
    if (!T.playing) return;
    const g = T.gNow();
    T.t0 = T.ctx.currentTime; T.g0 = g;
  };
  T.setBpm = function (bpm) {
    bpm = M.clamp(Math.round(bpm * 100) / 100, 40, 260);
    T.reanchor();
    P().bpm = bpm;
    T.engine.sync(P());
    M.emit('tempo');
  };

  /* arrangement position mapping with loop */
  function loopActive() {
    const L = P().loop;
    return L.on && L.end - L.start >= 0.25 && T.arrStart < L.end;
  }
  T.arrSegments = function (g0, g1) {
    const L = P().loop, segs = [];
    if (!loopActive()) { segs.push({ gs: g0, ge: g1, as: g0, pass: 0, hard: Infinity }); return segs; }
    const len = L.end - L.start;
    let g = g0, guard = 0;
    while (g < g1 - 1e-9 && guard++ < 64) {
      if (g < L.end) {
        const ge = Math.min(g1, L.end);
        segs.push({ gs: g, ge, as: g, pass: 0, hard: L.end });
        g = ge; continue;
      }
      const n = Math.floor((g - L.end) / len + 1e-9);
      const ps = L.end + n * len;
      const ge = Math.min(g1, ps + len);
      segs.push({ gs: g, ge, as: L.start + (g - ps), pass: n + 1, hard: ps + len });
      g = ge;
    }
    return segs;
  };
  T.arrPos = function () {
    const g = T.gNow();
    if (!T.playing) return T.pos;
    const s = T.arrSegments(g, g + 1e-6)[0];
    return s ? s.as + (g - s.gs) : g;
  };

  function purgeKeys(prefix) {
    for (const k of Array.from(T.started)) if (k.startsWith(prefix)) T.started.delete(k);
  }

  T.tick = function () {
    if (!T.playing) return;
    const p = P();
    const bpm = p.bpm;
    const horizon = T.gNow() + LOOKAHEAD * bpm / 60;
    if (horizon <= T.schedG) { T._checkRec(); return; }
    const w0 = T.schedG, w1 = horizon;
    T.schedG = w1;
    const eng = T.engine, toTime = T.timeAt;

    // metronome
    if (p.metronome || (T.rec && T.rec.count)) {
      for (let b = Math.ceil(w0 - 1e-9); b < w1; b++) eng.click(toTime(b), b % 4 === 0);
    }

    const segs = T.arrSegments(w0, w1);
    p.tracks.forEach((track) => {
      let arrCut = w1;
      const st = T.sess[track.id];
      // ---- session ----
      if (st) {
        let cur = w0;
        if (st.queued && st.queued.g < w1) {
          const qg = Math.max(st.queued.g, w0);
          if (st.scene != null) T._schedSess(track, st, cur, qg, qg);
          eng.stopSources((r) => r.trackId === track.id && r.origin === 'sess', toTime(qg));
          purgeKeys('s:' + track.id + ':');
          if (st.queued.stop) { st.scene = null; }
          else {
            st.scene = st.queued.scene; st.origin = st.queued.g; st.launchId = M.uid();
            if (!T.arrOff[track.id]) {
              T.arrOff[track.id] = true;
              eng.stopSources((r) => r.trackId === track.id && r.origin === 'arr', toTime(qg));
              purgeKeys('a:' + track.id + ':');
              arrCut = qg;
            }
          }
          st.queued = null;
          cur = qg;
          T.dirty = true;
        }
        if (st.scene != null) {
          const clip = track.slots[st.scene];
          if (!clip) { st.scene = null; T.dirty = true; }
          else T._schedSess(track, st, cur, w1, Infinity);
        }
      }
      // ---- arrangement ----
      if (!T.arrOff[track.id] || arrCut < w1) {
        const until = T.arrOff[track.id] && arrCut < w1 ? arrCut : w1;
        segs.forEach((sg) => {
          const ge = Math.min(sg.ge, until);
          if (ge <= sg.gs) return;
          const ae = sg.as + (ge - sg.gs);
          track.arr.forEach((it) => {
            const s = it.start, e = it.start + it.dur;
            const lo = Math.max(s, sg.as), hi = Math.min(e, ae);
            if (hi <= lo) return;
            const from = sg.gs + (lo - sg.as), to = sg.gs + (hi - sg.as);
            const originG = sg.gs + (s - sg.as) - (it.offset || 0);
            const endG = Math.min(sg.gs + (e - sg.as), sg.hard);
            M.Sched.scheduleClip(eng, track, it.clip, originG, from, to, endG,
              'a:' + track.id + ':' + it.id + ':' + sg.pass, 'arr', toTime, bpm, T.started);
          });
        });
      }
    });
    T._checkRec();
  };

  T._schedSess = function (track, st, from, to, endG) {
    const clip = track.slots[st.scene];
    if (!clip) return;
    M.Sched.scheduleClip(T.engine, track, clip, st.origin, from, to, endG,
      's:' + track.id + ':' + st.launchId, 'sess', T.timeAt, T.bpm(), T.started);
  };

  /* ---------- transport controls ---------- */
  T.play = function (fromPos, deferTick) {
    if (T.ctx.state !== 'running') T.ctx.resume();
    if (T.playing) return;
    const pos = fromPos != null ? fromPos : T.pos;
    T.pos = pos;
    T.arrStart = pos;
    T.g0 = pos; T.t0 = T.ctx.currentTime + 0.06; T.schedG = pos;
    T.started.clear();
    T.playing = true;
    if (!deferTick) T.tick();
    M.emit('transport');
  };

  T.stop = function () {
    if (!T.playing) {
      T.pos = 0;           // second stop rewinds
      M.emit('transport');
      return;
    }
    if (T.rec) T.finishRecording(true);
    T.playing = false;
    T.engine.panic();
    T.sess = {};
    T.started.clear();
    T.dirty = true;
    M.emit('transport');
  };

  T.toggle = () => (T.playing ? T.stop() : T.play());

  T.seek = function (pos) {
    pos = Math.max(0, pos);
    if (!T.playing) { T.pos = pos; M.emit('transport'); return; }
    const gNow = T.gNow();
    T.engine.panic();
    T.started.clear();
    // keep session clips in phase
    for (const id in T.sess) {
      const st = T.sess[id];
      if (st.origin != null) st.origin += pos - gNow;
      if (st.queued) st.queued.g += pos - gNow;
    }
    T.pos = pos; T.arrStart = pos;
    T.g0 = pos; T.t0 = T.ctx.currentTime + 0.03; T.schedG = pos;
    T.tick();
    M.emit('transport');
  };

  T.nextQuant = function () {
    const q = P().quant;
    const base = Math.max(T.gNow(), T.schedG);
    if (!q) return base;
    return Math.ceil(base / q - 1e-6) * q;
  };

  T.launch = function (trackId, scene) {
    const track = M.track(trackId);
    if (!track || !track.slots[scene]) return;
    const wasPlaying = T.playing;
    if (!wasPlaying) T.play(T.pos, true);
    const st = T.sess[trackId] || (T.sess[trackId] = { scene: null, origin: 0, launchId: null, queued: null });
    const g = wasPlaying ? T.nextQuant() : T.g0;
    st.queued = { scene, g };
    T.dirty = true;
    T.tick();
  };

  T.stopTrack = function (trackId) {
    const st = T.sess[trackId];
    if (!st || (st.scene == null && !st.queued)) return;
    if (!T.playing) { delete T.sess[trackId]; T.dirty = true; return; }
    st.queued = { stop: true, g: T.nextQuant() };
    T.dirty = true;
  };

  T.launchScene = function (scene) {
    const p = P();
    const wasPlaying = T.playing;
    if (!wasPlaying) T.play(T.pos, true);
    const g = wasPlaying ? T.nextQuant() : T.g0;
    p.tracks.forEach((t) => {
      const st = T.sess[t.id] || (T.sess[t.id] = { scene: null, origin: 0, launchId: null, queued: null });
      if (t.slots[scene]) st.queued = { scene, g };
      else if (st.scene != null) st.queued = { stop: true, g };
    });
    T.dirty = true;
    T.tick();
  };

  T.stopAll = function () {
    P().tracks.forEach((t) => T.stopTrack(t.id));
  };

  T.backToArrangement = function () {
    const at = T.playing ? T.timeAt(T.schedG) : 0;
    for (const id in T.sess) {
      T.engine.stopSources((r) => r.trackId === id && r.origin === 'sess', at);
      purgeKeys('s:' + id + ':');
    }
    T.sess = {};
    T.arrOff = {};
    T.dirty = true;
    M.emit('transport');
  };
  T.anyArrOff = () => Object.keys(T.arrOff).length > 0;

  /** Session state for UI: 'playing' | 'queued' | 'stopping' | null, and progress 0..1 */
  T.slotState = function (trackId, scene) {
    const st = T.sess[trackId];
    if (!st) return null;
    if (st.queued && !st.queued.stop && st.queued.scene === scene) return 'queued';
    if (st.scene === scene) return st.queued ? 'stopping' : 'playing';
    return null;
  };
  T.clipProgress = function (trackId) {
    const st = T.sess[trackId];
    if (!st || st.scene == null || !T.playing) return null;
    const t = M.track(trackId);
    const clip = t && t.slots[st.scene];
    if (!clip) return null;
    const g = T.gNow() - st.origin;
    if (g < 0) return 0;
    return (g % clip.length) / clip.length;
  };
  /** Position inside the clip currently shown in the editor (beats) or null */
  T.clipPlayhead = function (trackId, clip) {
    if (!T.playing || !clip) return null;
    const st = T.sess[trackId];
    if (st && st.scene != null && M.track(trackId).slots[st.scene] === clip) {
      const g = T.gNow() - st.origin;
      return g < 0 ? null : g % clip.length;
    }
    const t = M.track(trackId);
    if (t && !T.arrOff[trackId]) {
      const a = T.arrPos();
      const it = t.arr.find((x) => x.clip === clip && a >= x.start && a < x.start + x.dur);
      if (it) return ((a - it.start + (it.offset || 0)) % clip.length + clip.length) % clip.length;
    }
    return null;
  };

  /* ---------- live playing (on-screen keys / pads) ---------- */
  T.noteOn = function (key, pitch, vel) {
    const track = M.selectedTrack();
    if (!track || track.type === 'audio') return;
    if (T.ctx.state !== 'running') T.ctx.resume();
    const handle = T.engine.playNote(track, T.ctx.currentTime + 0.005, pitch, vel, track.type === 'drums' ? 0.3 : null);
    T.live.set(key, { handle, pitch, vel, g: T.gNow(), trackId: track.id });
    if (track.type === 'drums') T.noteOff(key);
  };
  T.noteOff = function (key) {
    const n = T.live.get(key);
    if (!n) return;
    T.live.delete(key);
    if (n.handle && n.handle.release) n.handle.release(T.ctx.currentTime);
    if (!(M.state.overdub && T.playing)) return;
    const track = M.track(n.trackId);
    const st = T.sess[n.trackId];
    if (!track || !st || st.scene == null) { M.toast('Overdub: starte zuerst einen Clip auf dieser Spur'); return; }
    const clip = track.slots[st.scene];
    if (!clip || clip.audio) return;
    const len = clip.length;
    const local = (((n.g - st.origin) % len) + len) % len;
    let t = Math.round(local * 4) / 4;
    if (t >= len) t -= len;
    const d = track.type === 'drums' ? 0.25 : Math.max(0.25, Math.round((T.gNow() - n.g) * 4) / 4);
    M.change(() => {
      clip.notes = clip.notes.filter((x) => !(x.p === n.pitch && Math.abs(x.t - t) < 0.01));
      clip.notes.push({ p: n.pitch, t, d: Math.min(d, len), v: n.vel });
    }, { notes: true });
  };

  /* ---------- audio recording ---------- */
  const Rec = M.Recorder = {
    stream: null, proc: null, chunks: [], active: false,
    async ensure(ctx) {
      if (Rec.stream) return true;
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { M.toast('Aufnahme wird hier nicht unterstützt'); return false; }
      try {
        Rec.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      } catch (e) { M.toast('Kein Mikrofonzugriff'); return false; }
      const src = ctx.createMediaStreamSource(Rec.stream);
      Rec.proc = ctx.createScriptProcessor(4096, 1, 1);
      const sink = ctx.createGain(); sink.gain.value = 0;
      src.connect(Rec.proc); Rec.proc.connect(sink); sink.connect(ctx.destination);
      Rec.proc.onaudioprocess = (e) => {
        if (!Rec.active) return;
        const d = e.inputBuffer.getChannelData(0);
        Rec.chunks.push({ t: e.playbackTime - d.length / ctx.sampleRate, data: new Float32Array(d) });
      };
      return true;
    },
    start() { Rec.chunks = []; Rec.active = true; },
    take(ctx, t0, t1) {
      Rec.active = false;
      const sr = ctx.sampleRate;
      const comp = (ctx.baseLatency || 0.01) + (ctx.outputLatency || 0);
      const a = t0 + comp, n = Math.max(1, Math.round((t1 - t0) * sr));
      const out = new Float32Array(n);
      Rec.chunks.forEach((ch) => {
        for (let i = 0; i < ch.data.length; i++) {
          const idx = Math.round((ch.t + i / sr - a) * sr);
          if (idx >= 0 && idx < n) out[idx] = ch.data[i];
        }
      });
      Rec.chunks = [];
      const buf = ctx.createBuffer(1, n, sr);
      buf.getChannelData(0).set(out);
      return buf;
    }
  };

  /** Toggle recording into an empty slot of an armed audio track. */
  T.toggleRecord = async function (trackId, scene) {
    if (T.rec) {
      if (T.rec.trackId === trackId && T.rec.scene === scene) {
        T.rec.endG = Math.max(T.rec.startG + 1, Math.ceil((T.gNow() + 0.01) / 4) * 4);
        if (T.rec.endG <= T.rec.startG) T.rec.endG = T.rec.startG + 4;
        T.dirty = true;
      } else M.toast('Es läuft bereits eine Aufnahme');
      return;
    }
    const ok = await Rec.ensure(T.ctx);
    if (!ok) return;
    if (!T.playing) T.play(Math.floor(T.pos / 4) * 4);
    const startG = Math.ceil((T.gNow() + 0.05) / 4) * 4;
    T.rec = { trackId, scene, startG, endG: null };
    Rec.start();
    T.dirty = true;
    M.toast('Aufnahme startet am nächsten Takt');
  };

  T._checkRec = function () {
    const r = T.rec;
    if (!r || r.endG == null) return;
    if (T.gNow() >= r.endG + 0.15) T.finishRecording(false);
  };

  T.finishRecording = async function (abort) {
    const r = T.rec;
    if (!r) return;
    T.rec = null;
    T.dirty = true;
    const endG = r.endG != null ? r.endG : Math.max(r.startG + 4, Math.ceil(T.gNow() / 4) * 4);
    if (abort && T.gNow() < r.startG + 0.5) { Rec.active = false; M.toast('Aufnahme verworfen'); return; }
    const t0 = T.timeAt(r.startG), t1 = T.timeAt(endG);
    const buf = Rec.take(T.ctx, t0, t1);
    const wav = M.encodeWav(buf);
    const id = 's_' + M.uid();
    try { await M.Store.saveSample(id, 'Aufnahme.wav', wav); } catch (e) { /* keep in memory */ }
    M.Samples.put(id, buf);
    const track = M.track(r.trackId);
    if (!track) return;
    const clip = M.newClip('Aufnahme', endG - r.startG, track.color);
    clip.audio = { sampleId: id, sampleName: 'Aufnahme.wav', startSec: 0, srcBpm: T.bpm(), warp: true, gain: 1 };
    M.change(() => { track.slots[r.scene] = clip; }, { structure: true });
    M.state.selSlot = { trackId: track.id, scene: r.scene };
    if (T.playing && !abort) {
      const st = T.sess[track.id] || (T.sess[track.id] = { scene: null, origin: 0, launchId: null, queued: null });
      st.queued = { scene: r.scene, g: endG };
      T.arrOff[track.id] = true;
    }
    M.emit('change', { structure: true });
  };

  /* ---------- offline render ---------- */
  M.renderArrangement = async function (project) {
    const end = M.arrangementEnd(project);
    if (end <= 0) return null;
    const bpm = project.bpm, sr = 44100;
    const secs = end * 60 / bpm + 3;
    const ctx = new OfflineAudioContext(2, Math.ceil(secs * sr), sr);
    const eng = new M.Engine(ctx, { offline: true });
    eng.sync(project);
    const toTime = (g) => 0.02 + g * 60 / bpm;
    const started = new Set();
    project.tracks.forEach((t) => t.arr.forEach((it) => {
      M.Sched.scheduleClip(eng, t, it.clip, it.start - (it.offset || 0), it.start, it.start + it.dur, it.start + it.dur,
        'x:' + it.id, 'arr', toTime, bpm, started);
    }));
    return ctx.startRendering();
  };
})(window.M);
