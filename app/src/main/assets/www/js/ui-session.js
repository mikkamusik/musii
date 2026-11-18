/* Musii – Session view: clip launcher grid */
(function (M) {
  'use strict';
  const h = M.h, T = M.Transport;

  M.clipboard = null;

  function selectSlot(trackId, scene) {
    M.state.selTrack = trackId;
    M.state.selSlot = { trackId, scene };
    M.state.selArr = null;
    M.emit('select');
  }

  M.createClipAt = function (track, scene) {
    if (track.type === 'audio') { M.importAudioToSlot(track, scene); return; }
    M.change(() => {
      const c = M.newClip(track.type === 'drums' ? 'Beat' : 'Clip', 4, track.color);
      track.slots[scene] = c;
    }, { structure: true });
    selectSlot(track.id, scene);
    M.openPanel('clip');
  };

  M.importAudioToSlot = async function (track, scene) {
    const files = await M.pickFiles('audio/*,.wav,.mp3,.ogg,.m4a,.flac,.aif,.aiff');
    if (!files.length) return;
    const f = files[0];
    try {
      M.toast('Lade ' + f.name + ' …');
      const r = await M.Samples.importBytes(f.name, await f.arrayBuffer(), T.ctx);
      const bpm = M.state.project.bpm;
      const beats = Math.max(1, Math.round(r.buffer.duration * bpm / 60));
      const clip = M.newClip(f.name.replace(/\.[^.]+$/, ''), beats, track.color);
      clip.audio = { sampleId: r.id, sampleName: f.name, startSec: 0, srcBpm: bpm, warp: true, gain: 1 };
      M.change(() => { track.slots[scene] = clip; }, { structure: true });
      selectSlot(track.id, scene);
      M.openPanel('clip');
    } catch (e) {
      M.toast('Audio konnte nicht gelesen werden');
    }
  };

  function clipMenu(e, track, scene) {
    const clip = track.slots[scene];
    const p = M.state.project;
    M.menu(e.clientX, e.clientY, [
      { label: 'Bearbeiten', action: () => { selectSlot(track.id, scene); M.openPanel('clip'); } },
      { label: 'Umbenennen', action: async () => { const n = await M.promptText('Clip umbenennen', clip.name); if (n != null) M.change(() => { clip.name = n; }, { structure: true }); } },
      { label: 'Farbe', action: () => M.colorPicker(e.clientX, e.clientY, (c) => M.change(() => { clip.color = c; }, { structure: true })) },
      { label: 'Duplizieren', action: () => {
        let target = -1;
        for (let i = scene + 1; i < p.scenes.length; i++) if (!track.slots[i]) { target = i; break; }
        M.change(() => {
          if (target < 0) { M.addSceneRaw(p.scenes.length); target = p.scenes.length - 1; }
          const c = M.deepCopy(clip); c.id = 'c_' + M.uid(); track.slots[target] = c;
        }, { structure: true });
      } },
      { label: 'Kopieren', action: () => { M.clipboard = { type: track.type, clip: M.deepCopy(clip) }; M.toast('Clip kopiert'); } },
      { label: 'Ins Arrangement (am Ende)', action: () => {
        M.change(() => {
          const end = track.arr.reduce((m, it) => Math.max(m, it.start + it.dur), 0);
          const c = M.deepCopy(clip); c.id = 'c_' + M.uid();
          track.arr.push({ id: 'i_' + M.uid(), start: Math.ceil(end / 4) * 4, dur: clip.length, offset: 0, clip: c });
        }, { structure: true });
        M.toast('Im Arrangement eingefügt');
      } },
      { sep: true },
      { label: 'Löschen', danger: true, action: () => {
        if (T.slotState(track.id, scene)) T.stopTrack(track.id);
        M.change(() => { track.slots[scene] = null; }, { structure: true });
      } }
    ], clip.name);
  }

  function emptyMenu(e, track, scene) {
    const items = [];
    if (track.type !== 'audio') items.push({ label: 'Neuer MIDI-Clip', action: () => M.createClipAt(track, scene) });
    else items.push({ label: 'Audio-Datei importieren', action: () => M.importAudioToSlot(track, scene) });
    items.push({
      label: 'Einfügen', disabled: !M.clipboard || (M.clipboard.type === 'audio') !== (track.type === 'audio'),
      action: () => M.change(() => { const c = M.deepCopy(M.clipboard.clip); c.id = 'c_' + M.uid(); track.slots[scene] = c; }, { structure: true })
    });
    M.menu(e.clientX, e.clientY, items);
  }

  M.trackMenu = function (e, track) {
    const p = M.state.project;
    const idx = p.tracks.indexOf(track);
    M.menu(e.clientX, e.clientY, [
      { label: 'Umbenennen', action: async () => { const n = await M.promptText('Spur umbenennen', track.name); if (n) M.change(() => { track.name = n; }, { structure: true }); } },
      { label: 'Farbe', action: () => M.colorPicker(e.clientX, e.clientY, (c) => M.change(() => { track.color = c; }, { structure: true })) },
      { label: 'Duplizieren', action: () => M.change(() => {
        const t = M.deepCopy(track); t.id = 't_' + M.uid(); t.name = track.name + ' 2';
        t.slots.forEach((c) => c && (c.id = 'c_' + M.uid()));
        t.arr.forEach((it) => { it.id = 'i_' + M.uid(); it.clip.id = 'c_' + M.uid(); });
        p.tracks.splice(idx + 1, 0, t);
      }, { structure: true }) },
      { label: 'Nach links', disabled: idx === 0, action: () => M.change(() => { p.tracks.splice(idx, 1); p.tracks.splice(idx - 1, 0, track); }, { structure: true }) },
      { label: 'Nach rechts', disabled: idx === p.tracks.length - 1, action: () => M.change(() => { p.tracks.splice(idx, 1); p.tracks.splice(idx + 1, 0, track); }, { structure: true }) },
      { sep: true },
      { label: 'Spur löschen', danger: true, action: async () => {
        if (await M.confirm('Spur löschen?', '„' + track.name + '“ und alle Clips werden entfernt.', 'Löschen')) {
          T.stopTrack(track.id);
          M.change(() => { p.tracks.splice(idx, 1); }, { structure: true });
          if (M.state.selTrack === track.id) M.state.selTrack = p.tracks[0] && p.tracks[0].id;
        }
      } }
    ], track.name);
  };

  M.addSceneRaw = function (at) {
    const p = M.state.project;
    p.scenes.splice(at, 0, { id: 'sc_' + M.uid(), name: String(p.scenes.length + 1) });
    p.tracks.forEach((t) => t.slots.splice(at, 0, null));
  };

  function sceneMenu(e, i) {
    const p = M.state.project, sc = p.scenes[i];
    M.menu(e.clientX, e.clientY, [
      { label: 'Umbenennen', action: async () => { const n = await M.promptText('Szene umbenennen', sc.name); if (n != null) M.change(() => { sc.name = n; }, { structure: true }); } },
      { label: 'Szene darunter einfügen', action: () => M.change(() => M.addSceneRaw(i + 1), { structure: true }) },
      { label: 'Duplizieren', action: () => M.change(() => {
        M.addSceneRaw(i + 1);
        p.scenes[i + 1].name = sc.name + ' 2';
        p.tracks.forEach((t) => { if (t.slots[i]) { const c = M.deepCopy(t.slots[i]); c.id = 'c_' + M.uid(); t.slots[i + 1] = c; } });
      }, { structure: true }) },
      { sep: true },
      { label: 'Szene löschen', danger: true, disabled: p.scenes.length <= 1, action: () => M.change(() => {
        p.scenes.splice(i, 1); p.tracks.forEach((t) => t.slots.splice(i, 1));
      }, { structure: true }) }
    ], sc.name);
  }

  M.addTrackMenu = function (e) {
    const p = M.state.project;
    const add = (type, preset, name) => {
      M.change(() => {
        const t = M.newTrack(type, name, M.colorAt(p.tracks.length * 3 + 1), p.scenes.length, preset);
        p.tracks.push(t);
        M.state.selTrack = t.id;
      }, { structure: true });
    };
    M.menu(e.clientX, e.clientY, [
      { label: 'Drum-Spur', action: () => add('drums', null, 'Drums') },
      { label: 'Synth – Bass', action: () => add('synth', 'Bass', 'Bass') },
      { label: 'Synth – Pad', action: () => add('synth', 'Pad', 'Pad') },
      { label: 'Synth – Lead', action: () => add('synth', 'Lead', 'Lead') },
      { label: 'Synth – Pluck', action: () => add('synth', 'Pluck', 'Pluck') },
      { label: 'Synth – Keys', action: () => add('synth', 'Keys', 'Keys') },
      { label: 'Audio-Spur', action: () => add('audio', null, 'Audio') }
    ], 'Neue Spur');
  };

  M.renderSession = function (root) {
    const p = M.state.project;
    const grid = h('div', { class: 'session' });

    p.tracks.forEach((track) => {
      const col = h('div', { class: 'col' + (M.state.selTrack === track.id ? ' sel' : ''), 'data-track': track.id });
      const head = h('div', { class: 'col-head', style: { '--tc': track.color } },
        h('span', { class: 'col-name' }, track.name),
        h('span', { class: 'col-type' }, track.type === 'drums' ? 'DRM' : track.type === 'audio' ? 'AUD' : 'SYN'));
      M.gestures(head, {
        tap: () => { M.state.selTrack = track.id; M.emit('select'); },
        dbl: () => { M.state.selTrack = track.id; M.openPanel('devices'); },
        long: (e) => M.trackMenu(e, track)
      });
      col.appendChild(head);

      p.scenes.forEach((sc, i) => {
        const clip = track.slots[i];
        const isSel = M.state.selSlot && M.state.selSlot.trackId === track.id && M.state.selSlot.scene === i;
        const slot = h('div', { class: 'slot' + (isSel ? ' sel' : ''), 'data-track': track.id, 'data-scene': i });
        if (clip) {
          const missing = clip.audio && !clip.audio.sampleId;
          const c = h('div', { class: 'clip' + (missing ? ' missing' : ''), style: { '--cc': clip.color || track.color } },
            h('span', { class: 'clip-play' }, M.icon('play', 14)),
            h('span', { class: 'clip-name' }, clip.name),
            h('div', { class: 'clip-prog' }));
          slot.appendChild(c);
          M.gestures(slot, {
            tap: () => {
              selectSlot(track.id, i);
              T.launch(track.id, i);
            },
            dbl: () => { selectSlot(track.id, i); M.openPanel('clip'); },
            long: (e) => clipMenu(e, track, i)
          });
        } else {
          const recHere = T.rec && T.rec.trackId === track.id && T.rec.scene === i;
          if (track.type === 'audio' && track.mixer.arm) {
            slot.appendChild(h('div', { class: 'slot-rec' + (recHere ? ' recording' : '') }, M.icon('rec', 14)));
          } else {
            slot.appendChild(h('div', { class: 'slot-empty' }));
          }
          M.gestures(slot, {
            tap: () => {
              if (track.type === 'audio' && track.mixer.arm) { T.toggleRecord(track.id, i); selectSlot(track.id, i); return; }
              selectSlot(track.id, i);
            },
            dbl: () => M.createClipAt(track, i),
            long: (e) => emptyMenu(e, track, i)
          });
        }
        col.appendChild(slot);
      });

      const foot = h('div', { class: 'col-foot' },
        M.iconBtn('stop', 'Spur stoppen', () => T.stopTrack(track.id), 'stop-btn'),
        M.toggleBtn('M', track.mixer.mute, (v) => { M.snapshot(); track.mixer.mute = v; M.paramChanged(); }, 'mute'),
        M.toggleBtn('S', track.mixer.solo, (v) => { M.snapshot(); track.mixer.solo = v; M.paramChanged(); }, 'solo'),
        track.type === 'audio'
          ? M.toggleBtn('●', track.mixer.arm, (v) => { M.snapshot(); track.mixer.arm = v; M.emit('change', { structure: true }); }, 'arm')
          : null);
      col.appendChild(foot);
      grid.appendChild(col);
    });

    // scene column
    const sc = h('div', { class: 'col scenes' });
    sc.appendChild(h('div', { class: 'col-head scene-head' }, h('span', { class: 'col-name' }, 'Szenen')));
    p.scenes.forEach((s, i) => {
      const b = h('div', { class: 'slot scene-slot' },
        h('div', { class: 'scene-btn' }, M.icon('play', 12), h('span', null, s.name)));
      M.gestures(b, { tap: () => T.launchScene(i), long: (e) => sceneMenu(e, i) });
      sc.appendChild(b);
    });
    sc.appendChild(h('div', { class: 'col-foot' },
      h('button', { class: 'btn small', onclick: () => T.stopAll() }, M.icon('stop', 12), ' Alle'),
      M.iconBtn('plus', 'Szene hinzufügen', () => M.change(() => M.addSceneRaw(p.scenes.length), { structure: true }))));
    grid.appendChild(sc);

    const add = h('div', { class: 'col add-col' },
      h('button', { class: 'add-track', onclick: (e) => M.addTrackMenu(e) }, M.icon('plus', 22), h('span', null, 'Spur')));
    grid.appendChild(add);

    root.appendChild(grid);
    M.updateSession();
  };

  /** Cheap per-frame update of clip states. */
  M.updateSession = function () {
    const grid = M.$('.session');
    if (!grid) return;
    grid.querySelectorAll('.slot[data-track]').forEach((slot) => {
      const tid = slot.dataset.track, sc = Number(slot.dataset.scene);
      const clip = slot.querySelector('.clip');
      const rec = slot.querySelector('.slot-rec');
      if (rec) {
        const r = T.rec;
        rec.classList.toggle('recording', !!(r && r.trackId === tid && r.scene === sc));
        rec.classList.toggle('waiting', !!(r && r.trackId === tid && r.scene === sc && T.gNow() < r.startG));
      }
      if (!clip) return;
      const st = T.slotState(tid, sc);
      clip.classList.toggle('playing', st === 'playing' || st === 'stopping');
      clip.classList.toggle('queued', st === 'queued');
      const prog = clip.querySelector('.clip-prog');
      if (st === 'playing' || st === 'stopping') {
        const pr = T.clipProgress(tid);
        prog.style.transform = `scaleX(${pr == null ? 0 : pr})`;
      } else prog.style.transform = 'scaleX(0)';
    });
  };
})(window.M);
