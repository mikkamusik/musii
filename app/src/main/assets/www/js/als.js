/* Musii – importer for .als project files (gzip-compressed XML).
   Imports tempo, tracks (name, colour, volume, pan, mute), MIDI clips with notes,
   audio clips (as references to samples you pick afterwards), scenes, session clips and locators. */
(function (M) {
  'use strict';

  async function gunzip(buf) {
    const u8 = new Uint8Array(buf);
    if (!(u8[0] === 0x1f && u8[1] === 0x8b)) return new TextDecoder().decode(u8); // plain XML
    if (!window.DecompressionStream) throw new Error('Gzip wird von diesem Gerät nicht unterstützt');
    const ds = new DecompressionStream('gzip');
    const stream = new Blob([u8]).stream().pipeThrough(ds);
    return await new Response(stream).text();
  }

  /** Extracts the .als from a .zip (stored or deflate) if needed. */
  async function unzipFirstAls(buf) {
    const u8 = new Uint8Array(buf), dv = new DataView(buf);
    let off = 0;
    while (off + 30 < u8.length && dv.getUint32(off, true) === 0x04034b50) {
      const method = dv.getUint16(off + 8, true);
      let csize = dv.getUint32(off + 18, true);
      const nlen = dv.getUint16(off + 26, true), xlen = dv.getUint16(off + 28, true);
      const name = new TextDecoder().decode(u8.subarray(off + 30, off + 30 + nlen));
      const start = off + 30 + nlen + xlen;
      const flags = dv.getUint16(off + 6, true);
      if ((flags & 8) && csize === 0) {
        // size in data descriptor: search the central directory instead
        const cd = findCentral(u8, dv, name);
        if (cd) csize = cd.csize;
      }
      if (/\.als$/i.test(name) && !name.startsWith('__MACOSX')) {
        const data = u8.slice(start, start + csize);
        if (method === 0) return { name, buf: data.buffer };
        if (method === 8) {
          const ds = new DecompressionStream('deflate-raw');
          const out = await new Response(new Blob([data]).stream().pipeThrough(ds)).arrayBuffer();
          return { name, buf: out };
        }
        throw new Error('ZIP-Kompression nicht unterstützt');
      }
      off = start + csize;
    }
    throw new Error('Keine .als-Datei im ZIP gefunden');
  }
  function findCentral(u8, dv, name) {
    for (let i = u8.length - 22; i >= 0; i--) {
      if (dv.getUint32(i, true) === 0x06054b50) {
        let p = dv.getUint32(i + 16, true);
        const n = dv.getUint16(i + 10, true);
        for (let k = 0; k < n; k++) {
          const nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
          const nm = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nl));
          if (nm === name) return { csize: dv.getUint32(p + 20, true) };
          p += 46 + nl + xl + cl;
        }
        return null;
      }
    }
    return null;
  }

  const kid = (el, name) => {
    if (!el) return null;
    for (const c of el.children) if (c.tagName === name) return c;
    return null;
  };
  const path = (el, p) => p.split('/').reduce((e, n) => kid(e, n), el);
  const val = (el, p, def) => {
    const e = p ? path(el, p) : el;
    if (!e) return def;
    const v = e.getAttribute('Value');
    return v == null ? def : v;
  };
  const num = (el, p, def) => { const v = parseFloat(val(el, p, NaN)); return isNaN(v) ? def : v; };
  const bool = (el, p, def) => { const v = val(el, p, null); return v == null ? def : v === 'true'; };

  // Map the 70 colour indices onto Musii's palette by hue position
  const colorFor = (idx) => M.colorAt(Math.round((idx || 0) * 16 / 14));

  function readNotes(clipEl) {
    const notes = [];
    const kts = path(clipEl, 'Notes/KeyTracks');
    if (!kts) return notes;
    for (const kt of kts.children) {
      const key = num(kt, 'MidiKey', 60);
      const evs = kid(kt, 'Notes');
      if (!evs) continue;
      for (const n of evs.children) {
        if (n.tagName !== 'MidiNoteEvent') continue;
        if (n.getAttribute('IsEnabled') === 'false') continue;
        notes.push({
          p: key,
          t: parseFloat(n.getAttribute('Time')) || 0,
          d: Math.max(0.01, parseFloat(n.getAttribute('Duration')) || 0.25),
          v: M.clamp((parseFloat(n.getAttribute('Velocity')) || 100) / 127, 0.05, 1)
        });
      }
    }
    return notes;
  }

  /**
   * Converts a clip element into Musii form.
   * Returns {clip, offset, dur} (offset/dur used for arrangement placement).
   */
  function convertClip(el, isDrum, bpm) {
    const cs = num(el, 'CurrentStart', 0), ce = num(el, 'CurrentEnd', 4);
    const loopOn = bool(el, 'Loop/LoopOn', false);
    const ls = num(el, 'Loop/LoopStart', 0), le = num(el, 'Loop/LoopEnd', 4);
    const rel = num(el, 'Loop/StartRelative', 0);
    const name = val(el, 'Name', '') || 'Clip';
    const color = colorFor(num(el, 'Color', num(el, 'ColorIndex', 0)));
    const dur = Math.max(0.25, ce - cs);
    const clip = M.newClip(name, 4, color);
    let offset = 0;

    if (el.tagName === 'MidiClip') {
      let notes = readNotes(el);
      if (loopOn) {
        clip.length = Math.max(0.25, le - ls);
        notes = notes.filter((n) => n.t >= ls && n.t < le).map((n) => Object.assign(n, { t: n.t - ls }));
        offset = rel;
      } else {
        const content = ls + rel;
        clip.length = dur;
        notes = notes.filter((n) => n.t >= content && n.t < content + dur).map((n) => Object.assign(n, { t: n.t - content }));
      }
      if (isDrum) {
        notes.forEach((n) => { n.p = M.DRUM_BASE + drumPadFor(n.p); });
      }
      clip.notes = notes;
    } else {
      // audio
      const fr = path(el, 'SampleRef/FileRef');
      const rp = val(fr, 'RelativePath', '') || val(fr, 'Path', '') || val(fr, 'Name', '');
      const sampleName = rp.split(/[\\/]/).pop() || 'sample.wav';
      const warped = bool(el, 'IsWarped', true);
      const markers = [];
      const wm = kid(el, 'WarpMarkers');
      if (wm) for (const m of wm.children) markers.push({ s: parseFloat(m.getAttribute('SecTime')), b: parseFloat(m.getAttribute('BeatTime')) });
      let srcBpm = bpm, sec0 = 0, beat0 = 0;
      if (warped && markers.length >= 2) {
        const a = markers[0], b = markers[markers.length - 1];
        if (b.s - a.s > 0.0001) srcBpm = ((b.b - a.b) / (b.s - a.s)) * 60;
        sec0 = a.s; beat0 = a.b;
      }
      const startBeat = loopOn ? ls : ls + rel;
      clip.length = loopOn ? Math.max(0.25, le - ls) : dur;
      if (loopOn) offset = rel;
      let startSec;
      if (warped) startSec = sec0 + (startBeat - beat0) * 60 / srcBpm;
      else startSec = startBeat; // un-warped clips store seconds
      clip.audio = {
        sampleId: null, sampleName, startSec: Math.max(0, startSec),
        srcBpm: warped ? srcBpm : bpm, warp: warped,
        gain: M.clamp(num(el, 'SampleVolume', 1), 0, 2)
      };
      if (!warped) {
        // treat seconds as beats-at-project-tempo for length purposes
        clip.audio.srcBpm = bpm;
      }
    }
    return { clip, offset, dur, start: cs };
  }

  // GM-ish drum map -> 8 pads
  function drumPadFor(p) {
    const map = { 35: 0, 36: 0, 37: 7, 38: 1, 40: 1, 39: 2, 42: 3, 44: 3, 46: 4, 41: 5, 43: 5, 45: 5, 47: 6, 48: 6, 50: 6, 49: 4, 51: 4, 56: 7 };
    if (map[p] != null) return map[p];
    return ((p - 36) % 8 + 8) % 8;
  }

  M.importAls = async function (arrayBuffer, fileName) {
    let buf = arrayBuffer;
    const u8 = new Uint8Array(buf);
    if (u8[0] === 0x50 && u8[1] === 0x4b) { const z = await unzipFirstAls(buf); buf = z.buf; fileName = z.name; }
    const xmlText = await gunzip(buf);
    const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('Datei ist kein gültiges Projekt');
    const root = doc.documentElement;
    const ls = kid(root, 'LiveSet');
    if (!ls) throw new Error('Keine Projektdaten gefunden');

    const p = M.newProject();
    p.name = (fileName || 'Import').replace(/\.(als|zip)$/i, '').split('/').pop();
    const main = kid(ls, 'MainTrack') || kid(ls, 'MasterTrack');
    p.bpm = M.clamp(num(main, 'DeviceChain/Mixer/Tempo/Manual', 120), 40, 260);
    if (main) p.master.vol = M.dbToFader(M.gainToDb(num(main, 'DeviceChain/Mixer/Volume/Manual', 1)));

    const scenesEl = kid(ls, 'Scenes');
    const scenes = scenesEl ? Array.from(scenesEl.children) : [];
    p.scenes = scenes.map((s, i) => ({ id: 'sc_' + M.uid(), name: val(s, 'Name', '') || String(i + 1) }));
    while (p.scenes.length < 8) p.scenes.push({ id: 'sc_' + M.uid(), name: String(p.scenes.length + 1) });

    p.tracks = [];
    let missing = new Set();
    const tracksEl = kid(ls, 'Tracks');
    for (const tr of tracksEl ? tracksEl.children : []) {
      if (tr.tagName !== 'MidiTrack' && tr.tagName !== 'AudioTrack') continue;
      const devices = path(tr, 'DeviceChain/DeviceChain/Devices');
      const isDrum = !!(devices && Array.from(devices.children).some((d) => d.tagName === 'DrumGroupDevice'));
      const type = tr.tagName === 'AudioTrack' ? 'audio' : isDrum ? 'drums' : 'synth';
      const name = val(tr, 'Name/EffectiveName', '') || val(tr, 'Name/UserName', '') || type;
      const t = M.newTrack(type, name, colorFor(num(tr, 'Color', 0)), p.scenes.length, type === 'synth' ? guessPreset(name) : undefined);
      const mx = path(tr, 'DeviceChain/Mixer');
      t.mixer.vol = M.dbToFader(M.gainToDb(num(mx, 'Volume/Manual', 1)));
      t.mixer.pan = M.clamp(num(mx, 'Pan/Manual', 0), -1, 1);
      t.mixer.mute = !bool(mx, 'Speaker/Manual', true);

      // session clips
      const slots = path(tr, 'DeviceChain/MainSequencer/ClipSlotList');
      if (slots) {
        Array.from(slots.children).forEach((slot, i) => {
          const holder = path(slot, 'ClipSlot/Value');
          const ce = holder && holder.firstElementChild;
          if (!ce || i >= p.scenes.length) return;
          const r = convertClip(ce, isDrum, p.bpm);
          if (r.clip.audio) missing.add(r.clip.audio.sampleName);
          t.slots[i] = r.clip;
        });
      }
      // arrangement clips
      const evs = path(tr, 'DeviceChain/MainSequencer/Sample/ArrangerAutomation/Events') ||
                  path(tr, 'DeviceChain/MainSequencer/ClipTimeable/ArrangerAutomation/Events');
      if (evs) {
        for (const ce of evs.children) {
          if (ce.tagName !== 'MidiClip' && ce.tagName !== 'AudioClip') continue;
          if (bool(ce, 'Disabled', false)) continue;
          const r = convertClip(ce, isDrum, p.bpm);
          if (r.clip.audio) missing.add(r.clip.audio.sampleName);
          t.arr.push({ id: 'i_' + M.uid(), start: r.start, dur: r.dur, offset: r.offset, clip: r.clip });
        }
        t.arr.sort((a, b) => a.start - b.start);
      }
      p.tracks.push(t);
    }

    const locs = path(ls, 'Locators/Locators');
    p.markers = locs ? Array.from(locs.children).map((l) => ({ name: val(l, 'Name', ''), t: num(l, 'Time', 0) })) : [];
    const end = M.arrangementEnd(p);
    if (end > 0) p.loop = { on: false, start: 0, end: Math.min(end, 16) };
    return { project: p, missingSamples: Array.from(missing) };
  };

  function guessPreset(name) {
    const n = name.toLowerCase();
    if (/bass|sub/.test(n)) return 'Bass';
    if (/pad|string|violin|harmony|chord/.test(n)) return 'Pad';
    if (/lead|synth/.test(n)) return 'Lead';
    if (/key|piano|rhodes/.test(n)) return 'Keys';
    if (/pluck|arp/.test(n)) return 'Pluck';
    return 'Init';
  }

  /**
   * Links picked audio files to clips that reference them by file name.
   * Returns number of clips that got a sample.
   */
  M.linkSamples = async function (project, files, ctx) {
    const byName = new Map();
    for (const f of files) byName.set(f.name.toLowerCase(), f);
    const imported = new Map();
    let count = 0;
    const clips = [];
    project.tracks.forEach((t) => {
      t.slots.forEach((c) => c && c.audio && clips.push(c));
      t.arr.forEach((it) => it.clip.audio && clips.push(it.clip));
    });
    for (const c of clips) {
      const key = (c.audio.sampleName || '').toLowerCase();
      const f = byName.get(key);
      if (!f) continue;
      if (!imported.has(key)) {
        try {
          const r = await M.Samples.importBytes(f.name, await f.arrayBuffer(), ctx);
          imported.set(key, r.id);
        } catch (e) { imported.set(key, null); }
      }
      const id = imported.get(key);
      if (id) { c.audio.sampleId = id; count++; }
    }
    return count;
  };

  M.missingSamples = function (project) {
    const s = new Set();
    project.tracks.forEach((t) => {
      t.slots.forEach((c) => c && c.audio && !c.audio.sampleId && s.add(c.audio.sampleName));
      t.arr.forEach((it) => it.clip.audio && !it.clip.audio.sampleId && s.add(it.clip.audio.sampleName));
    });
    return Array.from(s);
  };
})(window.M);
