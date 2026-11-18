/* Musii – audio engine: instruments, per-track channel strips, return effects, master bus.
   Works on a live AudioContext and on an OfflineAudioContext (for WAV export). */
(function (M) {
  'use strict';

  const cutoffHz = (n) => 30 * Math.pow(2, n * 9.4);

  function makeDriveCurve(amount) {
    const n = 2048, curve = new Float32Array(n);
    const k = amount * 40 + 0.0001;
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * (1 + k)) / Math.tanh(1 + k);
    }
    return curve;
  }

  function makeImpulse(ctx, seconds) {
    const sr = ctx.sampleRate, len = Math.max(1, Math.floor(sr * seconds));
    const buf = ctx.createBuffer(2, len, sr);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        const white = Math.random() * 2 - 1;
        lp = lp + (white - lp) * (0.6 - t * 0.45); // darker tail
        d[i] = lp * Math.pow(1 - t, 2.6) * (i < sr * 0.004 ? i / (sr * 0.004) : 1);
      }
    }
    return buf;
  }

  class Engine {
    constructor(ctx, opts) {
      this.ctx = ctx;
      this.offline = !!(opts && opts.offline);
      this.nodes = new Map();       // trackId -> strip
      this.voices = new Set();      // live synth voices (for panic)
      this.sources = [];            // {src, trackId, origin, key}
      this.chokes = new Map();      // trackId -> open hat gain node
      this.noise = null;
      this._buildMaster();
    }

    _buildMaster() {
      const c = this.ctx;
      this.masterIn = c.createGain();
      this.limiter = c.createDynamicsCompressor();
      this.limiter.threshold.value = -4; this.limiter.knee.value = 0; this.limiter.ratio.value = 20;
      this.limiter.attack.value = 0.002; this.limiter.release.value = 0.12;
      this.masterGain = c.createGain();
      this.masterMeter = c.createAnalyser(); this.masterMeter.fftSize = 512;
      // master fader -> limiter -> soft clipper -> out
      this.clipper = c.createWaveShaper();
      const n = 1024, curve = new Float32Array(n);
      for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; curve[i] = Math.abs(x) < 0.8 ? x : Math.sign(x) * (0.8 + 0.2 * Math.tanh((Math.abs(x) - 0.8) / 0.2)); }
      this.clipper.curve = curve;
      this.masterIn.connect(this.masterGain); this.masterGain.connect(this.limiter);
      this.limiter.connect(this.clipper);
      this.clipper.connect(this.masterMeter); this.clipper.connect(c.destination);

      // Return A – reverb
      this.retA = { input: c.createGain(), conv: c.createConvolver(), out: c.createGain(), meter: c.createAnalyser(), size: -1 };
      this.retA.meter.fftSize = 512;
      this.retA.input.connect(this.retA.conv); this.retA.conv.connect(this.retA.out);
      this.retA.out.connect(this.retA.meter); this.retA.out.connect(this.masterIn);
      // Return B – tempo delay
      const b = this.retB = {
        input: c.createGain(), delay: c.createDelay(4), fb: c.createGain(), tone: c.createBiquadFilter(),
        out: c.createGain(), meter: c.createAnalyser()
      };
      b.meter.fftSize = 512;
      b.tone.type = 'lowpass'; b.tone.frequency.value = 4200;
      b.input.connect(b.delay); b.delay.connect(b.tone); b.tone.connect(b.fb); b.fb.connect(b.delay);
      b.tone.connect(b.out); b.out.connect(b.meter); b.out.connect(this.masterIn);

      // Metronome
      this.clickGain = c.createGain(); this.clickGain.gain.value = 0.5; this.clickGain.connect(c.destination);
    }

    noiseBuffer() {
      if (!this.noise) {
        const len = this.ctx.sampleRate;
        this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      }
      return this.noise;
    }

    _strip(track) {
      const c = this.ctx;
      const s = {
        input: c.createGain(),
        low: c.createBiquadFilter(), mid: c.createBiquadFilter(), high: c.createBiquadFilter(),
        filter: c.createBiquadFilter(), drive: c.createWaveShaper(), comp: c.createDynamicsCompressor(),
        fader: c.createGain(), pan: c.createStereoPanner(), meter: c.createAnalyser(),
        sendA: c.createGain(), sendB: c.createGain(), driveAmt: -1
      };
      s.low.type = 'lowshelf'; s.low.frequency.value = 220;
      s.mid.type = 'peaking'; s.mid.frequency.value = 1200; s.mid.Q.value = 0.8;
      s.high.type = 'highshelf'; s.high.frequency.value = 5000;
      s.meter.fftSize = 512;
      s.input.connect(s.low); s.low.connect(s.mid); s.mid.connect(s.high); s.high.connect(s.filter);
      s.filter.connect(s.drive); s.drive.connect(s.comp); s.comp.connect(s.fader); s.fader.connect(s.pan);
      s.pan.connect(s.meter); s.pan.connect(this.masterIn);
      s.pan.connect(s.sendA); s.sendA.connect(this.retA.input);
      s.pan.connect(s.sendB); s.sendB.connect(this.retB.input);
      return s;
    }

    /** Make the node graph match the project and apply all parameters. */
    sync(project) {
      const ids = new Set(project.tracks.map((t) => t.id));
      for (const [id, s] of this.nodes) {
        if (!ids.has(id)) { try { s.pan.disconnect(); s.input.disconnect(); } catch (e) { /* ignore */ } this.nodes.delete(id); }
      }
      const anySolo = project.tracks.some((t) => t.mixer.solo);
      const now = this.ctx.currentTime;
      const set = (param, v) => { if (this.offline) param.value = v; else param.setTargetAtTime(v, now, 0.015); };
      project.tracks.forEach((t) => {
        let s = this.nodes.get(t.id);
        if (!s) { s = this._strip(t); this.nodes.set(t.id, s); }
        const fx = t.fx, m = t.mixer;
        set(s.low.gain, fx.eq.on ? fx.eq.low : 0);
        set(s.mid.gain, fx.eq.on ? fx.eq.mid : 0);
        set(s.high.gain, fx.eq.on ? fx.eq.high : 0);
        s.filter.type = fx.filter.on ? fx.filter.type : 'allpass';
        if (fx.filter.on) {
          set(s.filter.frequency, fx.filter.type === 'highpass' ? cutoffHz(fx.filter.cutoff * 0.75) : cutoffHz(fx.filter.cutoff));
          set(s.filter.Q, 0.5 + fx.filter.res * 18);
        } else { s.filter.frequency.value = 1000; s.filter.Q.value = 0.0001; }
        const amt = fx.drive.on ? fx.drive.amount : 0;
        if (amt !== s.driveAmt) { s.drive.curve = amt > 0 ? makeDriveCurve(amt) : null; s.driveAmt = amt; }
        s.comp.threshold.value = fx.comp.on ? fx.comp.threshold : 0;
        s.comp.ratio.value = fx.comp.on ? fx.comp.ratio : 1;
        s.comp.knee.value = fx.comp.on ? 6 : 0;
        const audible = !m.mute && (!anySolo || m.solo);
        const g = audible ? M.faderToGain(m.vol) * (fx.comp.on ? 1 + (-fx.comp.threshold / 40) : 1) : 0;
        set(s.fader.gain, g);
        set(s.pan.pan, m.pan);
        set(s.sendA.gain, m.sendA);
        set(s.sendB.gain, m.sendB);
      });
      // returns
      const ra = project.returns.a, rb = project.returns.b;
      if (Math.abs(ra.size - this.retA.size) > 0.001) {
        this.retA.conv.buffer = makeImpulse(this.ctx, 0.6 + ra.size * 4.4);
        this.retA.size = ra.size;
      }
      set(this.retA.out.gain, M.faderToGain(ra.vol));
      set(this.retB.delay.delayTime, M.clamp(rb.time * 60 / project.bpm, 0.01, 3.9));
      set(this.retB.fb.gain, rb.feedback);
      set(this.retB.out.gain, M.faderToGain(rb.vol));
      set(this.masterGain.gain, M.faderToGain(project.master.vol));
    }

    strip(trackId) { return this.nodes.get(trackId); }

    level(analyser) {
      if (!this._buf) this._buf = new Float32Array(512);
      analyser.getFloatTimeDomainData(this._buf);
      let pk = 0;
      for (let i = 0; i < this._buf.length; i++) { const a = Math.abs(this._buf[i]); if (a > pk) pk = a; }
      return pk;
    }

    /* ---------------- instruments ---------------- */

    /**
     * Plays a note on a track. dur in seconds, or null for a held note.
     * Returns a handle with release(time) for held notes.
     */
    playNote(track, time, pitch, vel, dur) {
      const s = this.nodes.get(track.id);
      if (!s) return null;
      if (track.type === 'synth') return this._synth(track.instrument, s.input, time, pitch, vel, dur);
      if (track.type === 'drums') return this._drum(track, s.input, time, pitch, vel);
      return null;
    }

    _synth(p, dest, t, pitch, vel, dur) {
      const c = this.ctx;
      const f = M.mtof(pitch + (p.octave || 0) * 12);
      const o1 = c.createOscillator(), o2 = c.createOscillator(), sub = c.createOscillator();
      o1.type = p.osc1; o2.type = p.osc2; sub.type = 'sine';
      o1.frequency.value = f;
      o2.frequency.value = f * Math.pow(2, (p.semi2 || 0) / 12);
      o2.detune.value = p.detune || 0;
      o1.detune.value = -(p.detune || 0) * 0.3;
      sub.frequency.value = f / 2;
      const g1 = c.createGain(), g2 = c.createGain(), gs = c.createGain();
      g1.gain.value = 1 - p.mix; g2.gain.value = p.mix; gs.gain.value = p.sub;
      const filt = c.createBiquadFilter();
      filt.type = 'lowpass';
      filt.Q.value = 0.7 + p.res * 16;
      const amp = c.createGain();
      o1.connect(g1); o2.connect(g2); sub.connect(gs);
      g1.connect(filt); g2.connect(filt); gs.connect(filt);
      filt.connect(amp); amp.connect(dest);

      const base = cutoffHz(p.cutoff);
      const peak = Math.min(20000, cutoffHz(Math.min(1, p.cutoff + p.envAmt * (0.4 + vel * 0.6))));
      const fd = Math.max(0.01, p.fd);
      filt.frequency.setValueAtTime(base, t);
      filt.frequency.linearRampToValueAtTime(peak, t + Math.max(0.002, p.a * 0.5));
      filt.frequency.setTargetAtTime(base + (peak - base) * p.s * 0.5, t + p.a * 0.5, fd / 3);

      const level = p.gain * (0.25 + vel * 0.75) * 0.5;
      const a = Math.max(0.002, p.a), d = Math.max(0.01, p.d), r = Math.max(0.01, p.r);
      amp.gain.setValueAtTime(0, t);
      amp.gain.linearRampToValueAtTime(level, t + a);
      amp.gain.setTargetAtTime(level * p.s, t + a, d / 3);
      const oscs = [o1, o2, sub];
      oscs.forEach((o) => o.start(t));
      const voice = {
        amp, oscs, end: Infinity,
        release: (rt) => {
          rt = Math.max(rt, c.currentTime);
          amp.gain.cancelScheduledValues(rt);
          // hold the current value then fade (setTargetAtTime from wherever we are)
          amp.gain.setTargetAtTime(0, rt, r / 4);
          const stopAt = rt + r * 1.6 + 0.05;
          oscs.forEach((o) => { try { o.stop(stopAt); } catch (e) { /* already */ } });
          voice.end = stopAt;
        }
      };
      if (!this.offline) {
        this.voices.add(voice);
        o1.onended = () => { this.voices.delete(voice); try { amp.disconnect(); } catch (e) { /* ignore */ } };
      }
      if (dur != null) voice.release(t + Math.max(0.01, dur));
      return voice;
    }

    _drum(track, dest, t, pitch, vel) {
      const idx = pitch - M.DRUM_BASE;
      const def = M.DRUM_PADS[idx];
      if (!def) return null;
      const pp = track.instrument.pads[idx] || { tune: 0, decay: 1, level: 0.9 };
      const c = this.ctx;
      const tune = Math.pow(2, (pp.tune || 0) / 12);
      const dec = pp.decay || 1;
      const out = c.createGain();
      out.gain.value = (pp.level == null ? 0.9 : pp.level) * (0.3 + vel * 0.7);
      out.connect(dest);
      const noiseSrc = () => { const n = c.createBufferSource(); n.buffer = this.noiseBuffer(); return n; };
      const env = (g, peak, decay, at) => {
        g.gain.setValueAtTime(0.0001, at);
        g.gain.exponentialRampToValueAtTime(peak, at + 0.002);
        g.gain.exponentialRampToValueAtTime(0.0001, at + decay);
      };
      const kill = (nodes, at) => nodes.forEach((n) => { n.start(t); n.stop(at); });

      switch (def.kind) {
        case 'kick': {
          const o = c.createOscillator(), g = c.createGain();
          o.type = 'sine';
          o.frequency.setValueAtTime(160 * tune, t);
          o.frequency.exponentialRampToValueAtTime(48 * tune, t + 0.07);
          o.frequency.exponentialRampToValueAtTime(40 * tune, t + 0.4 * dec);
          env(g, 1.1, 0.45 * dec, t);
          const click = c.createOscillator(), cg = c.createGain();
          click.type = 'square'; click.frequency.value = 1400 * tune;
          env(cg, 0.12, 0.012, t);
          o.connect(g); g.connect(out); click.connect(cg); cg.connect(out);
          kill([o, click], t + 0.5 * dec + 0.05);
          break;
        }
        case 'snare': {
          const n = noiseSrc(), bp = c.createBiquadFilter(), ng = c.createGain();
          bp.type = 'highpass'; bp.frequency.value = 1500 * tune;
          env(ng, 0.7, 0.2 * dec, t);
          const o = c.createOscillator(), og = c.createGain();
          o.type = 'triangle'; o.frequency.setValueAtTime(220 * tune, t); o.frequency.exponentialRampToValueAtTime(160 * tune, t + 0.05);
          env(og, 0.6, 0.1 * dec, t);
          n.connect(bp); bp.connect(ng); ng.connect(out); o.connect(og); og.connect(out);
          kill([n, o], t + 0.3 * dec);
          break;
        }
        case 'clap': {
          const n = noiseSrc(), bp = c.createBiquadFilter(), g = c.createGain();
          bp.type = 'bandpass'; bp.frequency.value = 1300 * tune; bp.Q.value = 1.2;
          g.gain.setValueAtTime(0.0001, t);
          [0, 0.011, 0.022].forEach((o) => {
            g.gain.setValueAtTime(0.9, t + o);
            g.gain.exponentialRampToValueAtTime(0.1, t + o + 0.009);
          });
          g.gain.setValueAtTime(0.8, t + 0.033);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 0.033 + 0.22 * dec);
          n.connect(bp); bp.connect(g); g.connect(out);
          kill([n], t + 0.3 * dec + 0.05);
          break;
        }
        case 'chh':
        case 'ohh': {
          const open = def.kind === 'ohh';
          const prev = this.chokes.get(track.id);
          if (prev && prev.t <= t) { try { prev.g.gain.cancelScheduledValues(t); prev.g.gain.setTargetAtTime(0.0001, t, 0.008); } catch (e) { /* ignore */ } }
          const n = noiseSrc(), hp = c.createBiquadFilter(), bp = c.createBiquadFilter(), g = c.createGain();
          hp.type = 'highpass'; hp.frequency.value = 7000 * tune;
          bp.type = 'peaking'; bp.frequency.value = 10000 * tune; bp.gain.value = 6;
          const d = (open ? 0.38 : 0.055) * dec;
          env(g, open ? 0.45 : 0.5, d, t);
          n.connect(hp); hp.connect(bp); bp.connect(g); g.connect(out);
          kill([n], t + d + 0.05);
          if (open) this.chokes.set(track.id, { g, t }); else this.chokes.delete(track.id);
          break;
        }
        case 'tomlo':
        case 'tomhi': {
          const f = (def.kind === 'tomlo' ? 110 : 180) * tune;
          const o = c.createOscillator(), g = c.createGain();
          o.type = 'sine';
          o.frequency.setValueAtTime(f * 1.6, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.06);
          env(g, 0.9, 0.35 * dec, t);
          o.connect(g); g.connect(out);
          kill([o], t + 0.4 * dec);
          break;
        }
        case 'rim': {
          const o = c.createOscillator(), bp = c.createBiquadFilter(), g = c.createGain();
          o.type = 'square'; o.frequency.value = 820 * tune;
          bp.type = 'bandpass'; bp.frequency.value = 1700 * tune; bp.Q.value = 4;
          env(g, 0.7, 0.04 * dec, t);
          o.connect(bp); bp.connect(g); g.connect(out);
          kill([o], t + 0.08 * dec);
          break;
        }
      }
      return null;
    }

    /** Starts an audio clip region. Returns the source node. */
    playAudio(track, clip, when, offsetSec, durSec, rate, meta) {
      const buf = M.Samples.get(clip.audio && clip.audio.sampleId);
      const s = this.nodes.get(track.id);
      if (!buf || !s) return null;
      if (offsetSec >= buf.duration) return null;
      const c = this.ctx;
      const src = c.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = rate;
      const g = c.createGain();
      const gain = clip.audio.gain == null ? 1 : clip.audio.gain;
      // tiny fades to avoid clicks
      g.gain.setValueAtTime(0, when);
      g.gain.linearRampToValueAtTime(gain, when + 0.004);
      const endT = when + durSec / rate;
      g.gain.setValueAtTime(gain, Math.max(when + 0.004, endT - 0.006));
      g.gain.linearRampToValueAtTime(0, endT);
      src.connect(g); g.connect(s.input);
      src.start(Math.max(when, c.currentTime), Math.max(0, offsetSec), Math.max(0.001, durSec));
      if (!this.offline) {
        const rec = Object.assign({ src, gain: g, trackId: track.id }, meta || {});
        this.sources.push(rec);
        src.onended = () => { const i = this.sources.indexOf(rec); if (i >= 0) this.sources.splice(i, 1); try { g.disconnect(); } catch (e) { /* ignore */ } };
      }
      return src;
    }

    /** Stop audio sources matching a filter at time t. */
    stopSources(filter, t) {
      const at = Math.max(t || 0, this.ctx.currentTime);
      this.sources.forEach((r) => {
        if (filter(r)) {
          try {
            r.gain.gain.cancelScheduledValues(at);
            r.gain.gain.setTargetAtTime(0, at, 0.004);
            r.src.stop(at + 0.03);
          } catch (e) { /* ignore */ }
        }
      });
    }

    panic() {
      const now = this.ctx.currentTime;
      this.voices.forEach((v) => {
        try {
          v.amp.gain.cancelScheduledValues(now);
          v.amp.gain.setTargetAtTime(0, now, 0.01);
          v.oscs.forEach((o) => o.stop(now + 0.08));
        } catch (e) { /* ignore */ }
      });
      this.voices.clear();
      this.stopSources(() => true, now);
    }

    click(time, accent) {
      const c = this.ctx, o = c.createOscillator(), g = c.createGain();
      o.type = 'square';
      o.frequency.value = accent ? 1760 : 1180;
      g.gain.setValueAtTime(0.0001, time);
      g.gain.exponentialRampToValueAtTime(accent ? 0.5 : 0.3, time + 0.001);
      g.gain.exponentialRampToValueAtTime(0.0001, time + 0.04);
      o.connect(g); g.connect(this.clickGain);
      o.start(time); o.stop(time + 0.05);
    }
  }

  M.Engine = Engine;
})(window.M);
