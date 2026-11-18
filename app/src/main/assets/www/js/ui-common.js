/* Musii – reusable controls: knob, fader, toggle, select, stepper */
(function (M) {
  'use strict';
  const h = M.h;

  /** Called after a control changed a project value: re-sync audio and schedule autosave. */
  M.paramChanged = function () {
    if (M.Transport.engine) M.Transport.engine.sync(M.state.project);
    M.emit('params');
  };

  /**
   * Rotary knob. opts: {label, value, min, max, def, step, fmt, onChange(v), bipolar}
   * Drag up/down to change, double-tap to reset.
   */
  M.knob = function (opts) {
    const min = opts.min == null ? 0 : opts.min, max = opts.max == null ? 1 : opts.max;
    let value = opts.value;
    const el = h('div', { class: 'knob' + (opts.small ? ' small' : '') });
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 40 40');
    const track = document.createElementNS(svgNS, 'path');
    const arc = document.createElementNS(svgNS, 'path');
    const dot = document.createElementNS(svgNS, 'line');
    track.setAttribute('class', 'knob-track'); arc.setAttribute('class', 'knob-arc'); dot.setAttribute('class', 'knob-dot');
    svg.appendChild(track); svg.appendChild(arc); svg.appendChild(dot);
    const valEl = h('div', { class: 'knob-val' });
    const lab = h('div', { class: 'knob-label' }, opts.label || '');
    el.appendChild(svg); el.appendChild(valEl); el.appendChild(lab);
    if (opts.color) el.style.setProperty('--kc', opts.color);

    const A0 = -135, A1 = 135;
    const pt = (a, r) => { const rad = (a - 90) * Math.PI / 180; return [20 + r * Math.cos(rad), 20 + r * Math.sin(rad)]; };
    const arcPath = (a0, a1, r) => {
      const [x0, y0] = pt(a0, r), [x1, y1] = pt(a1, r);
      const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
      return `M${x0.toFixed(2)},${y0.toFixed(2)} A${r},${r} 0 ${large} ${a1 > a0 ? 1 : 0} ${x1.toFixed(2)},${y1.toFixed(2)}`;
    };
    track.setAttribute('d', arcPath(A0, A1, 15));
    function draw() {
      const n = (value - min) / (max - min);
      const a = A0 + n * (A1 - A0);
      const from = opts.bipolar ? 0 : A0;
      arc.setAttribute('d', Math.abs(a - from) < 0.5 ? '' : arcPath(Math.min(from, a), Math.max(from, a), 15));
      const [x0, y0] = pt(a, 6), [x1, y1] = pt(a, 13);
      dot.setAttribute('x1', x0); dot.setAttribute('y1', y0); dot.setAttribute('x2', x1); dot.setAttribute('y2', y1);
      valEl.textContent = opts.fmt ? opts.fmt(value) : (Math.round(value * 100) / 100).toString();
    }
    draw();
    let startV = 0, lastTap = 0;
    M.drag(svg, {
      start: () => {
        const now = Date.now();
        if (now - lastTap < 300 && opts.def != null) {
          M.snapshot(); value = opts.def; draw(); opts.onChange(value); lastTap = 0; return false;
        }
        lastTap = now;
        startV = value; M.snapshot(); el.classList.add('active');
      },
      move: (e, dx, dy) => {
        const range = max - min;
        let v = startV + (-dy + dx * 0.3) / 160 * range;
        if (opts.step) v = Math.round(v / opts.step) * opts.step;
        v = M.clamp(v, min, max);
        if (v !== value) { value = v; draw(); opts.onChange(value); }
      },
      end: () => el.classList.remove('active')
    });
    el.set = (v) => { value = v; draw(); };
    return el;
  };

  /** Vertical fader 0..1 with meter. opts: {value, onChange, meter:true} */
  M.fader = function (opts) {
    let value = opts.value;
    const el = h('div', { class: 'fader' });
    const meterL = h('div', { class: 'meter' }, h('div', { class: 'meter-fill' }), h('div', { class: 'meter-peak' }));
    const slot = h('div', { class: 'fader-slot' });
    const cap = h('div', { class: 'fader-cap' });
    const unity = h('div', { class: 'fader-unity' });
    slot.appendChild(unity); slot.appendChild(cap);
    el.appendChild(slot); el.appendChild(meterL);
    function draw() {
      cap.style.bottom = `calc(${value * 100}% - ${value * 18}px)`;
    }
    unity.style.bottom = 'calc(80% - 14.4px + 9px)';
    draw();
    let startV = 0, lastTap = 0, hgt = 100;
    M.drag(slot, {
      start: () => {
        const now = Date.now();
        if (now - lastTap < 300) { M.snapshot(); value = 0.8; draw(); opts.onChange(value); lastTap = 0; return false; }
        lastTap = now; startV = value; hgt = slot.clientHeight - 18; M.snapshot();
      },
      move: (e, dx, dy) => {
        const v = M.clamp(startV - dy / Math.max(40, hgt), 0, 1);
        if (v !== value) { value = v; draw(); opts.onChange(value); }
      }
    });
    el.set = (v) => { value = v; draw(); };
    el.meterFill = meterL.firstChild;
    el.meterPeak = meterL.lastChild;
    el.peak = 0; el.peakHold = 0;
    el.setLevel = function (lin) {
      const db = M.gainToDb(lin);
      const n = isFinite(db) ? M.clamp((db + 60) / 66, 0, 1) : 0;
      el.meterFill.style.height = (n * 100) + '%';
      el.meterFill.classList.toggle('hot', db > -1);
      const now = performance.now();
      if (n >= el.peak || now - el.peakHold > 1200) { el.peak = n; el.peakHold = now; }
      el.meterPeak.style.bottom = (el.peak * 100) + '%';
    };
    return el;
  };

  M.toggleBtn = function (label, on, onChange, cls) {
    const b = h('button', { class: 'tbtn ' + (cls || '') + (on ? ' on' : '') }, label);
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      on = !on; b.classList.toggle('on', on); onChange(on);
    });
    b.set = (v) => { on = v; b.classList.toggle('on', on); };
    return b;
  };

  M.select = function (options, value, onChange, cls) {
    const s = h('select', { class: 'sel ' + (cls || '') });
    options.forEach((o) => {
      const opt = h('option', { value: o.value }, o.label);
      if (o.value === value) opt.selected = true;
      s.appendChild(opt);
    });
    s.addEventListener('change', () => onChange(s.value));
    return s;
  };

  M.card = function (title, opts, ...children) {
    opts = opts || {};
    const head = h('div', { class: 'card-head' });
    if (opts.toggle) {
      head.appendChild(M.toggleBtn('', opts.on, opts.toggle, 'power'));
    }
    head.appendChild(h('span', { class: 'card-title' }, title));
    if (opts.extra) head.appendChild(opts.extra);
    return h('div', { class: 'card' + (opts.on === false ? ' off' : '') + (opts.cls ? ' ' + opts.cls : '') }, head,
      h('div', { class: 'card-body' }, children));
  };

  /** SVG icons (inline, stroke-based) */
  const ICONS = {
    play: '<path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" stroke="none"/>',
    rec: '<circle cx="12" cy="12" r="6.5" fill="currentColor" stroke="none"/>',
    metro: '<path d="M8 21h8l-2.5-16h-3z"/><path d="M12 15l5-8"/>',
    loop: '<path d="M4 12a5 5 0 0 1 5-5h9l-3-3m3 3-3 3"/><path d="M20 12a5 5 0 0 1-5 5H6l3 3m-3-3 3-3"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
    redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    back: '<path d="M10 6 4 12l6 6"/><path d="M4 12h16"/>',
    chevDown: '<path d="m6 9 6 6 6-6"/>',
    chevUp: '<path d="m6 15 6-6 6 6"/>',
    zoomIn: '<circle cx="11" cy="11" r="6"/><path d="m20 20-4.5-4.5M8.5 11h5M11 8.5v5"/>',
    zoomOut: '<circle cx="11" cy="11" r="6"/><path d="m20 20-4.5-4.5M8.5 11h5"/>',
    trash: '<path d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13"/>',
    tap: '<path d="M12 3v4M5.6 5.6l2.8 2.8M18.4 5.6l-2.8 2.8"/><circle cx="12" cy="15" r="5"/>',
    arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>'
  };
  M.icon = function (name, size) {
    const span = h('span', { class: 'icon' });
    span.innerHTML = `<svg viewBox="0 0 24 24" width="${size || 20}" height="${size || 20}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
    return span;
  };
  M.iconBtn = function (name, title, onClick, cls) {
    const b = h('button', { class: 'ibtn ' + (cls || ''), title, 'aria-label': title }, M.icon(name));
    if (onClick) b.addEventListener('click', (e) => { e.stopPropagation(); onClick(e); });
    return b;
  };
})(window.M);
