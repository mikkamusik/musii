/* Musii – shared helpers */
window.M = window.M || {};
(function (M) {
  'use strict';

  M.h = function (tag, attrs, ...children) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'style' && typeof v === 'object') {
          for (const sk in v) {
            if (v[sk] == null) continue;
            if (sk.startsWith('--')) el.style.setProperty(sk, v[sk]); else el.style[sk] = v[sk];
          }
        }
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k === 'html') el.innerHTML = v;
        else if (k === 'value') el.value = v;
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const c of children.flat(Infinity)) {
      if (c == null || c === false) continue;
      el.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
    }
    return el;
  };

  M.$ = (sel, root) => (root || document).querySelector(sel);
  M.uid = () => Math.random().toString(36).slice(2, 10);
  M.clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  M.deepCopy = (o) => JSON.parse(JSON.stringify(o));

  M.COLORS = [
    '#ff6f61', '#ff9f43', '#ffc542', '#e6e65c', '#9be15d', '#4cd38a',
    '#3fd0c9', '#45b5f0', '#6f8cff', '#9a7bff', '#c77dff', '#ff7ac6',
    '#d0a37a', '#a4b0be', '#7bd3a8', '#f5b0cb'
  ];
  M.colorAt = (i) => M.COLORS[((i % M.COLORS.length) + M.COLORS.length) % M.COLORS.length];

  const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  M.noteName = (p) => NAMES[p % 12] + (Math.floor(p / 12) - 1);
  M.isBlack = (p) => [1, 3, 6, 8, 10].includes(p % 12);
  M.mtof = (p) => 440 * Math.pow(2, (p - 69) / 12);

  /* Fader position (0..1) <-> dB. 0.8 is unity, 1.0 is +6 dB. */
  M.faderToDb = (pos) => {
    if (pos <= 0.001) return -Infinity;
    if (pos >= 0.8) return (pos - 0.8) * 30;
    return (pos - 0.8) * 75;
  };
  M.dbToFader = (db) => {
    if (!isFinite(db)) return 0;
    if (db >= 0) return M.clamp(0.8 + db / 30, 0, 1);
    return M.clamp(0.8 + db / 75, 0, 1);
  };
  M.dbToGain = (db) => (isFinite(db) ? Math.pow(10, db / 20) : 0);
  M.gainToDb = (g) => (g <= 0 ? -Infinity : 20 * Math.log10(g));
  M.faderToGain = (pos) => M.dbToGain(M.faderToDb(pos));
  M.fmtDb = (db) => (isFinite(db) ? (db > 0 ? '+' : '') + db.toFixed(1) + ' dB' : '-∞ dB');

  /** Formats a beat position as bar.beat.sixteenth */
  M.fmtPos = (beat) => {
    const b = Math.max(0, beat);
    const bar = Math.floor(b / 4) + 1;
    const bt = Math.floor(b % 4) + 1;
    const six = Math.floor((b % 1) * 4) + 1;
    return bar + '.' + bt + '.' + six;
  };
  M.fmtLen = (beats) => {
    const bars = Math.floor(beats / 4), rest = beats - bars * 4;
    if (rest === 0) return bars + (bars === 1 ? ' Takt' : ' Takte');
    return bars + '.' + rest.toFixed(rest % 1 ? 2 : 0);
  };

  /* ---------- toast / menus / dialogs ---------- */
  let toastTimer = null;
  M.toast = function (msg, ms) {
    let el = M.$('#toast');
    if (!el) { el = M.h('div', { id: 'toast' }); document.body.appendChild(el); }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), ms || 2200);
  };

  M.closeOverlays = function () {
    const ov = document.querySelectorAll('.overlay');
    ov.forEach((o) => o.remove());
    return ov.length > 0;
  };

  /** Context menu. items: [{label, action, danger, disabled, sep}] */
  M.menu = function (x, y, items, title) {
    M.closeOverlays();
    const ov = M.h('div', { class: 'overlay menu-overlay' });
    const box = M.h('div', { class: 'menu' });
    if (title) box.appendChild(M.h('div', { class: 'menu-title' }, title));
    for (const it of items) {
      if (!it) continue;
      if (it.sep) { box.appendChild(M.h('div', { class: 'menu-sep' })); continue; }
      const b = M.h('button', {
        class: 'menu-item' + (it.danger ? ' danger' : '') + (it.checked ? ' checked' : ''),
        disabled: it.disabled
      }, it.label);
      b.addEventListener('click', (e) => { e.stopPropagation(); ov.remove(); it.action && it.action(); });
      box.appendChild(b);
    }
    ov.appendChild(box);
    ov.addEventListener('pointerdown', (e) => { if (e.target === ov) ov.remove(); });
    document.body.appendChild(ov);
    const r = box.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    box.style.left = M.clamp(x, 6, vw - r.width - 6) + 'px';
    box.style.top = M.clamp(y, 6, vh - r.height - 6) + 'px';
    return ov;
  };

  M.dialog = function ({ title, body, buttons }) {
    return new Promise((resolve) => {
      M.closeOverlays();
      const ov = M.h('div', { class: 'overlay dialog-overlay' });
      const box = M.h('div', { class: 'dialog' });
      if (title) box.appendChild(M.h('div', { class: 'dialog-title' }, title));
      if (body) box.appendChild(typeof body === 'string' ? M.h('div', { class: 'dialog-body' }, body) : body);
      const row = M.h('div', { class: 'dialog-buttons' });
      (buttons || [{ label: 'OK', value: true, primary: true }]).forEach((b) => {
        row.appendChild(M.h('button', {
          class: 'btn' + (b.primary ? ' primary' : '') + (b.danger ? ' danger' : ''),
          onclick: () => { ov.remove(); resolve(typeof b.value === 'function' ? b.value() : b.value); }
        }, b.label));
      });
      box.appendChild(row);
      ov.appendChild(box);
      ov.addEventListener('pointerdown', (e) => { if (e.target === ov) { ov.remove(); resolve(null); } });
      document.body.appendChild(ov);
      const inp = box.querySelector('input');
      if (inp) setTimeout(() => { inp.focus(); inp.select && inp.select(); }, 50);
    });
  };

  M.promptText = function (title, value) {
    const inp = M.h('input', { class: 'text-input', type: 'text', value: value || '' });
    const p = M.dialog({
      title,
      body: M.h('div', { class: 'dialog-body' }, inp),
      buttons: [
        { label: 'Abbrechen', value: null },
        { label: 'OK', value: () => inp.value, primary: true }
      ]
    });
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { const ov = inp.closest('.overlay'); ov && ov.querySelector('.btn.primary').click(); }
    });
    return p;
  };

  M.confirm = (title, text, okLabel) => M.dialog({
    title, body: text,
    buttons: [{ label: 'Abbrechen', value: false }, { label: okLabel || 'OK', value: true, primary: true, danger: true }]
  });

  M.colorPicker = function (x, y, onPick) {
    M.closeOverlays();
    const ov = M.h('div', { class: 'overlay menu-overlay' });
    const box = M.h('div', { class: 'menu color-grid' });
    M.COLORS.forEach((c) => box.appendChild(M.h('button', {
      class: 'swatch', style: { background: c },
      onclick: () => { ov.remove(); onPick(c); }
    })));
    ov.appendChild(box);
    ov.addEventListener('pointerdown', (e) => { if (e.target === ov) ov.remove(); });
    document.body.appendChild(ov);
    const r = box.getBoundingClientRect();
    box.style.left = M.clamp(x, 6, window.innerWidth - r.width - 6) + 'px';
    box.style.top = M.clamp(y, 6, window.innerHeight - r.height - 6) + 'px';
  };

  /**
   * Tap / double-tap / long-press on one element.
   * handlers: {tap(e), dbl(e), long(e)}
   */
  M.gestures = function (el, handlers) {
    let timer = null, sx = 0, sy = 0, longFired = false, lastTap = 0, down = false, tapTimer = null;
    el.addEventListener('pointerdown', (e) => {
      if (e.button && e.button !== 0) return;
      down = true; longFired = false; sx = e.clientX; sy = e.clientY;
      clearTimeout(timer);
      if (handlers.long) {
        timer = setTimeout(() => { if (down) { longFired = true; handlers.long(e); } }, 480);
      }
    });
    el.addEventListener('pointermove', (e) => {
      if (Math.abs(e.clientX - sx) > 10 || Math.abs(e.clientY - sy) > 10) clearTimeout(timer);
    });
    const end = (e, cancel) => {
      clearTimeout(timer);
      if (!down) return;
      down = false;
      if (cancel || longFired) return;
      if (Math.abs(e.clientX - sx) > 10 || Math.abs(e.clientY - sy) > 10) return;
      const now = Date.now();
      if (handlers.dbl && now - lastTap < 320) {
        clearTimeout(tapTimer); lastTap = 0; handlers.dbl(e); return;
      }
      lastTap = now;
      if (handlers.tap) {
        if (handlers.dbl && handlers.delayTap) {
          tapTimer = setTimeout(() => handlers.tap(e), 300);
        } else handlers.tap(e);
      }
    };
    el.addEventListener('pointerup', (e) => end(e, false));
    el.addEventListener('pointercancel', (e) => end(e, true));
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (handlers.long && !longFired) { clearTimeout(timer); longFired = true; handlers.long(e); }
    });
  };

  /** Pointer drag helper with capture. cb: {start(e), move(e, dx, dy), end(e, dx, dy)} */
  M.drag = function (el, cb) {
    el.addEventListener('pointerdown', (e) => {
      if (e.button && e.button !== 0) return;
      const sx = e.clientX, sy = e.clientY;
      if (cb.start && cb.start(e) === false) return;
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      const mv = (ev) => cb.move && cb.move(ev, ev.clientX - sx, ev.clientY - sy);
      const up = (ev) => {
        el.removeEventListener('pointermove', mv);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', up);
        cb.end && cb.end(ev, ev.clientX - sx, ev.clientY - sy);
      };
      el.addEventListener('pointermove', mv);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    });
  };

  /* ---------- files ---------- */
  M.pickFiles = function (accept, multiple) {
    return new Promise((resolve) => {
      const inp = M.h('input', { type: 'file', accept: accept || '', style: { display: 'none' } });
      if (multiple) inp.multiple = true;
      inp.addEventListener('change', () => { resolve(Array.from(inp.files || [])); inp.remove(); });
      document.body.appendChild(inp);
      inp.click();
    });
  };

  M.bufToBase64 = function (buf) {
    const bytes = new Uint8Array(buf);
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(bin);
  };
  M.base64ToBuf = function (b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.buffer;
  };

  M.isAndroid = () => !!(window.MusiiAndroid && window.MusiiAndroid.isAndroid && window.MusiiAndroid.isAndroid());

  /** Saves a file: Android Downloads folder in the app, browser download otherwise. */
  M.saveFile = function (name, mime, arrayBuffer) {
    if (M.isAndroid()) {
      const loc = window.MusiiAndroid.saveFile(name, mime, M.bufToBase64(arrayBuffer));
      if (!loc) M.toast('Speichern fehlgeschlagen');
      return loc;
    }
    if (window.MUSII_WEB) {
      M.toast('Export ist nur in der Android-App möglich', 3500);
      return '';
    }
    const blob = new Blob([arrayBuffer], { type: mime });
    const a = M.h('a', { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    M.toast('Gespeichert: ' + name);
    return name;
  };

  /** 16-bit PCM WAV encoder */
  M.encodeWav = function (buffer) {
    const ch = Math.min(2, buffer.numberOfChannels), sr = buffer.sampleRate, len = buffer.length;
    const data = new ArrayBuffer(44 + len * ch * 2);
    const v = new DataView(data);
    const ws = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    ws(0, 'RIFF'); v.setUint32(4, 36 + len * ch * 2, true); ws(8, 'WAVE');
    ws(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true);
    ws(36, 'data'); v.setUint32(40, len * ch * 2, true);
    const chans = [];
    for (let c = 0; c < ch; c++) chans.push(buffer.getChannelData(c));
    let o = 44;
    for (let i = 0; i < len; i++) {
      for (let c = 0; c < ch; c++) {
        const s = M.clamp(chans[c][i], -1, 1);
        v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        o += 2;
      }
    }
    return data;
  };

  /* tiny event bus */
  const listeners = {};
  M.on = (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); };
  M.emit = (ev, ...a) => { (listeners[ev] || []).forEach((fn) => fn(...a)); };
})(window.M);
