/* Lucky Musii Casino – UI layer. Play money only. */
(function () {
  'use strict';
  const E = window.Engine;
  const GAMES = {}; E.games.forEach(g => { GAMES[g.id] = g; });

  const META = {
    codex: { art: ['📜', '🤠', '👑'], tags: ['Freispiele', 'Expanding', '10 Linien'], hot: 'Kult', vol: 'hoch' },
    angler: { art: ['🎣', '🐟', '🚤'], tags: ['Geld-Fische', 'Multiplikator', '10 Linien'], hot: 'Neu', vol: 'hoch' },
    sugar: { art: ['🍭', '🧁', '💣'], tags: ['Pay Anywhere', 'Kaskaden', 'Bomben bis 100x'], hot: 'Top', vol: 'sehr hoch' },
    wolf: { art: ['🐺', '🌕', '🦅'], tags: ['Hold & Spin', 'Jackpots', '20 Linien'], hot: null, vol: 'mittel' },
    inferno: { art: ['7️⃣', '🍒', '⭐'], tags: ['Klassiker', 'Risiko-Spiel', '5 Linien'], hot: null, vol: 'mittel' }
  };
  const RTP = { codex: '96', angler: '96', sugar: '96', wolf: '96', inferno: '96' };
  const BETS = [20, 40, 100, 200, 400, 1000, 2000];
  const START = 10000, REFILL = 10000, BONUS = 2500, BONUS_EVERY = 4 * 3600 * 1000;
  const KEY = 'lucky-musii-v1';

  // ---------- state ----------
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY));
      if (s && typeof s.balance === 'number' && isFinite(s.balance)) return Object.assign(defaults(), s);
    } catch (e) { /* storage unavailable */ }
    return defaults();
  }
  function defaults() { return { balance: START, lastBonus: 0, muted: false, turbo: false, betIdx: 2, stats: {} }; }
  const S = load();
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* ignore */ } }

  const R = { game: null, busy: false, autoLeft: 0, lastGrid: {}, lastVals: {}, gambleWin: 0, inFeature: false };

  // ---------- helpers ----------
  const $ = id => document.getElementById(id);
  const sleep = ms => new Promise(res => setTimeout(res, ms));
  const fmt = v => (Math.round(v * 100) / 100).toLocaleString('de-DE', { maximumFractionDigits: 2 });
  const bet = () => BETS[S.betIdx];
  const T = (normal, turbo) => (S.turbo ? turbo : normal);

  const el = {
    balance: $('balance'), wallet: $('wallet'), bonusBtn: $('bonusBtn'), soundBtn: $('soundBtn'),
    lobby: $('lobby'), game: $('game'), grid: $('gameGrid'), title: $('gameTitle'), machine: $('machine'),
    reels: $('reels'), lines: $('lines'), reelsWrap: $('reelsWrap'), featureBar: $('featureBar'),
    winMsg: $('winMsg'), winAmt: $('winAmt'), betVal: $('betVal'), betMinus: $('betMinus'), betPlus: $('betPlus'),
    spin: $('spinBtn'), auto: $('autoBtn'), autoMenu: $('autoMenu'), turbo: $('turboBtn'), gamble: $('gambleBtn'),
    back: $('backBtn'), info: $('infoBtn'), overlay: $('overlay')
  };

  // ---------- sound (WebAudio synth, starts after first interaction) ----------
  const Sound = {
    ctx: null,
    ensure() {
      if (!this.ctx) { try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { this.ctx = null; } }
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    },
    tone(freq, dur, type, vol, when) {
      if (S.muted || !this.ctx) return;
      const t = this.ctx.currentTime + (when || 0);
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(vol || 0.06, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(this.ctx.destination); o.start(t); o.stop(t + dur + 0.03);
    },
    click() { this.tone(660, 0.04, 'square', 0.025); },
    stop() { this.tone(150, 0.09, 'triangle', 0.12); this.tone(90, 0.12, 'sine', 0.08); },
    tease() { this.tone(330, 0.5, 'sawtooth', 0.03); this.tone(495, 0.5, 'sawtooth', 0.02); },
    win(x) {
      const n = x >= 10 ? [523, 659, 784, 1047, 1319, 1568] : x >= 2 ? [523, 659, 784, 1047] : [659, 784];
      n.forEach((f, i) => this.tone(f, 0.2, 'triangle', 0.07, i * 0.07));
    },
    feature() { [392, 523, 659, 784, 1047, 1319, 1568, 2093].forEach((f, i) => this.tone(f, 0.28, 'sawtooth', 0.035, i * 0.08)); },
    pop() { this.tone(700 + Math.random() * 500, 0.07, 'sine', 0.06); },
    coin() { this.tone(1568, 0.08, 'square', 0.03); this.tone(2093, 0.12, 'square', 0.03, 0.06); },
    lose() { this.tone(220, 0.3, 'sawtooth', 0.05); this.tone(160, 0.45, 'sawtooth', 0.05, 0.15); }
  };

  // ---------- wallet ----------
  function renderBalance(bump) {
    el.balance.textContent = fmt(S.balance);
    if (bump) { el.wallet.classList.remove('bump'); void el.wallet.offsetWidth; el.wallet.classList.add('bump'); }
  }
  function credit(v) { if (v > 0) { S.balance = Math.round((S.balance + v) * 100) / 100; renderBalance(true); save(); } }
  function recordWin(id, v) {
    const st = S.stats[id] || (S.stats[id] = { spins: 0, best: 0 });
    if (v > st.best) st.best = v;
    save();
  }
  function renderBonus() {
    const left = S.lastBonus + BONUS_EVERY - Date.now();
    let label;
    if (left <= 0) { label = '+' + fmt(BONUS) + ' Bonus'; el.bonusBtn.classList.add('ready'); el.bonusBtn.disabled = false; }
    else {
      const h = Math.floor(left / 3600000), m = Math.ceil((left % 3600000) / 60000);
      label = 'Bonus in ' + (h ? h + ' h ' : '') + m + ' min';
      el.bonusBtn.classList.remove('ready'); el.bonusBtn.disabled = true;
    }
    el.bonusBtn.innerHTML = `<span aria-hidden="true">🎁</span><span class="bl">${label}</span>`;
    el.bonusBtn.title = label; el.bonusBtn.setAttribute('aria-label', label);
  }
  function toast(text) {
    const t = document.createElement('div'); t.className = 'toast'; t.textContent = text;
    document.body.appendChild(t); setTimeout(() => t.remove(), 2700);
  }

  // ---------- lobby ----------
  function renderLobby() {
    el.grid.innerHTML = E.games.map(g => {
      const m = META[g.id]; const st = S.stats[g.id];
      return `<button class="card t-${g.id}" type="button" data-game="${g.id}" aria-label="${g.name} spielen">
        <div class="card-art"><span class="a2">${m.art[1]}</span><span class="a1">${m.art[0]}</span><span class="a3">${m.art[2]}</span><span class="title">${g.name}</span></div>
        <div class="card-body">
          <p>${g.tagline}</p>
          <div class="tags">${m.hot ? `<span class="tag-chip hot">${m.hot}</span>` : ''}${m.tags.map(t => `<span class="tag-chip">${t}</span>`).join('')}</div>
          <span class="record">RTP ${RTP[g.id]} % · Volatilität ${m.vol}${st && st.best ? ' · Rekord ' + fmt(st.best) : ''}</span>
        </div></button>`;
    }).join('');
  }

  // ---------- routing ----------
  function route() {
    const id = location.hash.replace('#', '');
    if (GAMES[id]) openGame(id); else showLobby();
  }
  function showLobby() {
    if (R.busy) return;
    R.autoLeft = 0; R.game = null;
    el.game.hidden = true; el.lobby.hidden = false;
    renderLobby(); window.scrollTo(0, 0);
  }
  function openGame(id) {
    const g = GAMES[id];
    R.game = g; R.gambleWin = 0;
    el.lobby.hidden = true; el.game.hidden = false;
    el.title.textContent = g.name;
    el.machine.className = 'machine t-' + id;
    el.featureBar.innerHTML = baseFeatureChips(g);
    buildReels(g);
    setMsg('Viel Glück!', '');
    renderControls();
    window.scrollTo(0, 0);
  }

  // ---------- cells ----------
  function valLabel(g, s, v) {
    if (!v) return '';
    if (g.id === 'sugar' && s === 'bomb') return `<span class="val">x${v}</span>`;
    if (typeof v === 'string') return `<span class="val jp">${v}</span>`;
    return `<span class="val">${fmt(v * bet())}</span>`;
  }
  function cellHTML(g, s, v, cls, style) {
    const d = g.symbols[s] || { t: '?' };
    let inner = d.e ? `<span class="sym">${d.e}</span>` : `<span class="sym royal r-${s}">${d.t}</span>`;
    if (d.tag) inner += `<span class="tag">${d.tag}</span>`;
    inner += valLabel(g, s, v);
    return `<div class="cell s-${s}${cls ? ' ' + cls : ''}"${style ? ` style="${style}"` : ''}>${inner}</div>`;
  }
  function emptyCellHTML(g) { return `<div class="cell empty"><span class="sym">🌑</span></div>`; }
  const symKeys = g => Object.keys(g.symbols).filter(k => k !== 'bomb');
  function randomSym(g) { const k = symKeys(g); return k[Math.floor(Math.random() * k.length)]; }
  function randomGrid(g) {
    const grid = [];
    for (let c = 0; c < g.cols; c++) { const col = []; for (let r = 0; r < g.rows; r++) col.push(randomSym(g)); grid.push(col); }
    return grid;
  }

  function buildReels(g) {
    el.reels.style.setProperty('--cols', g.cols); el.reels.style.setProperty('--rows', g.rows);
    el.reelsWrap.style.setProperty('--cols', g.cols);
    el.reels.classList.remove('has-win'); clearLines();
    let html = '';
    for (let c = 0; c < g.cols; c++) html += g.type === 'tumble' ? '<div class="reel col"></div>' : '<div class="reel"><div class="strip"></div></div>';
    el.reels.innerHTML = html;
    if (g.type === 'tumble') {
      const grid = R.lastGrid[g.id] || randomGrid(g).map(col => col.map(s => ({ s })));
      R.lastGrid[g.id] = grid;
      renderTumble(g, grid, null, false);
    } else {
      const plain = s => (s === g.scatter || s === g.wild || s === 'moon' || s === 'fish' ? (g.symbols.A ? 'A' : 'cherry') : s);
      const grid = R.lastGrid[g.id] || randomGrid(g).map(col => col.map(plain));
      R.lastGrid[g.id] = grid;
      setStatic(g, grid, R.lastVals[g.id]);
    }
  }
  function cols() { return Array.from(el.reels.children); }
  function setStatic(g, grid, vals) {
    cols().forEach((col, c) => {
      const strip = col.querySelector('.strip');
      strip.style.transition = 'none'; strip.style.transform = 'none';
      strip.innerHTML = grid[c].map((s, r) => cellHTML(g, s, vals && vals[c][r])).join('');
    });
  }
  function cellAt(c, r) {
    const col = el.reels.children[c]; if (!col) return null;
    const host = col.querySelector('.strip') || col;
    return host.children[r] || null;
  }

  // ---------- reel spin animation (line games) ----------
  async function animateReels(g, grid, vals) {
    clearWinState();
    const prev = R.lastGrid[g.id] || randomGrid(g), prevVals = R.lastVals[g.id];
    const scat = g.scatter || (g.id === 'wolf' ? 'moon' : null);
    let extra = 0; const durs = [];
    for (let c = 0; c < g.cols; c++) {
      let seen = 0;
      if (scat) for (let k = 0; k < c; k++) seen += grid[k].filter(s => s === scat).length;
      const need = g.id === 'wolf' ? 4 : 2;
      const tease = scat && c >= 2 && seen >= need && !S.turbo;
      if (tease) extra += 800;
      durs.push({ d: T(820, 330) + c * T(200, 80) + extra, tease });
    }
    Sound.click();
    const jobs = cols().map((col, c) => {
      const strip = col.querySelector('.strip');
      const fillN = T(16, 7) + c * T(4, 2) + (durs[c].tease ? 10 : 0);
      const parts = [];
      grid[c].forEach((s, r) => parts.push(cellHTML(g, s, vals && vals[c][r])));
      for (let i = 0; i < fillN; i++) parts.push(cellHTML(g, randomSym(g)));
      prev[c].forEach((s, r) => parts.push(cellHTML(g, s, prevVals && prevVals[c][r])));
      const n = parts.length;
      strip.style.transition = 'none';
      strip.innerHTML = parts.join('');
      strip.style.transform = `translateY(-${((n - g.rows) / n) * 100}%)`;
      void strip.offsetHeight;
      col.classList.add('spinning');
      strip.style.transition = `transform ${durs[c].d}ms cubic-bezier(.25,.05,.3,1)`;
      strip.style.transform = 'translateY(0)';
      if (durs[c].tease) setTimeout(() => { col.classList.add('tease'); Sound.tease(); }, durs[c].d - 900);
      return sleep(durs[c].d).then(() => {
        col.classList.remove('spinning', 'tease');
        strip.style.transition = 'none'; strip.style.transform = 'none';
        strip.innerHTML = grid[c].map((s, r) => cellHTML(g, s, vals && vals[c][r])).join('');
        col.classList.remove('bump'); void col.offsetWidth; col.classList.add('bump');
        Sound.stop();
      });
    });
    await Promise.all(jobs);
    R.lastGrid[g.id] = grid; R.lastVals[g.id] = vals || null;
  }

  // ---------- win presentation ----------
  function clearWinState() {
    el.reels.classList.remove('has-win');
    el.reels.querySelectorAll('.cell.win').forEach(c => c.classList.remove('win'));
    clearLines();
  }
  function clearLines() { el.lines.innerHTML = ''; }
  function markCells(cells) {
    el.reels.querySelectorAll('.cell.win').forEach(c => c.classList.remove('win'));
    cells.forEach(([c, r]) => { const x = cellAt(c, r); if (x) x.classList.add('win'); });
    el.reels.classList.toggle('has-win', cells.length > 0);
  }
  function drawLines(g, wins) {
    const box = el.reelsWrap.getBoundingClientRect();
    el.lines.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`);
    el.lines.innerHTML = wins.filter(w => w.kind === 'line').map(w => {
      const pts = g.lines[w.line].map((r, c) => {
        const cell = cellAt(c, r); if (!cell) return '';
        const b = cell.getBoundingClientRect();
        return `${(b.left + b.width / 2 - box.left).toFixed(1)},${(b.top + b.height / 2 - box.top).toFixed(1)}`;
      }).join(' ');
      return `<polyline points="${pts}"/>`;
    }).join('');
  }
  function symIcon(g, s) { const d = g.symbols[s]; return d ? (d.e || d.t) : s; }
  function describe(g, w) {
    const i = symIcon(g, w.sym);
    switch (w.kind) {
      case 'line': return `Linie ${w.line + 1}: ${w.count}× ${i}`;
      case 'scatter': return `${w.count}× ${i} Scatter`;
      case 'expand': return `${i} expandiert auf ${w.count} Walzen`;
      case 'collect': return `${w.count}× ${i} sammelt Fische ein${w.mult > 1 ? ' (x' + w.mult + ')' : ''}`;
      case 'cluster': return `${w.count}× ${i}`;
      default: return '';
    }
  }
  function setMsg(msg, amt) { el.winMsg.textContent = msg; el.winAmt.textContent = amt; }
  async function countUp(from, to, ms) {
    if (S.turbo || ms < 50 || to - from <= 0) { el.winAmt.textContent = fmt(to); return; }
    const t0 = performance.now();
    return new Promise(res => {
      function step(t) {
        const p = Math.min(1, (t - t0) / ms);
        el.winAmt.textContent = fmt(from + (to - from) * (1 - Math.pow(1 - p, 3)));
        if (p < 1) requestAnimationFrame(step); else res();
      }
      requestAnimationFrame(step);
    });
  }
  // shows wins, returns after presentation. `base` = amount already shown in win field
  async function presentWins(g, wins, base) {
    if (!wins.length) return base;
    const total = wins.reduce((a, w) => a + w.amount, 0);
    markCells(wins.flatMap(w => w.cells));
    drawLines(g, wins);
    Sound.win(total / bet());
    setMsg(wins.length === 1 ? describe(g, wins[0]) : `${wins.length} Gewinne`, '');
    await countUp(base, base + total, Math.min(1400, 300 + (total / bet()) * 60));
    if (wins.length > 1 && !S.turbo && R.autoLeft === 0) {
      for (const w of wins) {
        markCells(w.cells); drawLines(g, [w]);
        setMsg(describe(g, w) + ' = ' + fmt(w.amount), fmt(base + total));
        await sleep(750);
      }
      markCells(wins.flatMap(w => w.cells)); drawLines(g, wins);
      setMsg(`${wins.length} Gewinne`, fmt(base + total));
    } else {
      await sleep(T(450, 160));
    }
    return base + total;
  }
  function floater(c, r, text) {
    const cell = cellAt(c, r); if (!cell) return;
    const box = el.reelsWrap.getBoundingClientRect(), b = cell.getBoundingClientRect();
    const f = document.createElement('div'); f.className = 'floater'; f.textContent = text;
    f.style.left = (b.left + b.width / 2 - box.left) + 'px'; f.style.top = (b.top + b.height / 2 - box.top) + 'px';
    el.reelsWrap.appendChild(f); setTimeout(() => f.remove(), 1300);
  }

  // ---------- tumble game (Sugar Storm) ----------
  function renderTumble(g, grid, falls, initial) {
    const dropMs = T(420, 220);
    el.reels.style.setProperty('--dropdur', dropMs + 'ms');
    cols().forEach((col, c) => {
      col.innerHTML = grid[c].map((x, r) => {
        const f = falls ? falls[c][r] : 0;
        const d = initial ? c * T(70, 25) + (g.rows - r) * T(30, 10) : 0;
        return cellHTML(g, x.s, x.v, f ? 'drop' : '', f ? `--fall:${f};--d:${d}ms` : '');
      }).join('');
    });
    return dropMs + (initial ? g.cols * T(70, 25) + g.rows * T(30, 10) : 0);
  }
  async function playTumble(g, seq, isFs, base) {
    clearWinState();
    Sound.click();
    const allFall = seq.steps[0].grid.map(col => col.map(() => g.rows));
    await sleep(renderTumble(g, seq.steps[0].grid, allFall, true));
    Sound.stop();
    let shown = base;
    for (let i = 0; i < seq.steps.length; i++) {
      const st = seq.steps[i];
      if (!st.wins.length) break;
      shown = await presentWins(g, st.wins, shown);
      const cells = st.wins.flatMap(w => w.cells);
      cells.forEach(([c, r]) => { const x = cellAt(c, r); if (x) { x.classList.remove('win'); x.classList.add('pop'); } });
      Sound.pop();
      await sleep(T(300, 150));
      clearWinState();
      const next = seq.steps[i + 1];
      if (next) { await sleep(renderTumble(g, next.grid, st.nextFalls, false)); Sound.stop(); }
    }
    R.lastGrid[g.id] = seq.steps[seq.steps.length - 1].grid;
    if (seq.scatterWin) {
      markCells(seq.scatCells); Sound.coin();
      setMsg(`${seq.scatters}× 🍭 Scatter = ${fmt(seq.scatterWin)}`, '');
      await countUp(shown, shown + seq.scatterWin, 500);
      shown += seq.scatterWin;
      await sleep(T(700, 300));
    }
    if (isFs && seq.mult > 1) {
      markCells(seq.bombs);
      seq.bombs.forEach(([c, r]) => floater(c, r, 'x' + R.lastGrid[g.id][c][r].v));
      Sound.feature();
      setMsg(`💣 Bomben: ${fmt(seq.tumbleWin)} × ${seq.bombSum}`, '');
      await sleep(T(700, 300));
      const add = seq.tumbleWin * (seq.mult - 1);
      await countUp(shown, shown + add, 900);
      shown += add;
      await sleep(T(600, 250));
    }
    return shown;
  }

  // ---------- feature bar ----------
  function baseFeatureChips(g) {
    const lines = g.lineCount ? `<span class="fchip">${g.lineCount} Linien</span>` : '<span class="fchip">Gewinne überall · ab 8 gleichen</span>';
    const extra = {
      codex: '<span class="fchip">3× 📜 = 10 Freispiele</span>',
      angler: '<span class="fchip">3× 🛟 = Freispiele</span>',
      sugar: '<span class="fchip">4× 🍭 = 10 Freispiele</span>',
      wolf: '<span class="fchip">6× 🌕 = Hold &amp; Spin</span>',
      inferno: '<span class="fchip">⭐ zahlt überall</span>'
    }[g.id];
    return lines + extra;
  }
  function fsBar(g, fs, left, total) {
    let h = `<span class="fchip">Freispiele <b>${left}</b></span>`;
    if (g.id === 'codex') h += `<span class="fchip">Bonussymbol <span class="big">${symIcon(g, fs.expand)}</span></span>`;
    if (g.id === 'angler') {
      const inLevel = fs.level >= 3 ? 4 : fs.collected % 4;
      h += `<span class="fchip">🎣 <span class="pips">${[0, 1, 2, 3].map(i => `<i class="${i < inLevel ? 'on' : ''}"></i>`).join('')}</span></span>`;
      h += `<span class="fchip">Multi <b>x${g.multLevels[fs.level]}</b></span>`;
    }
    h += `<span class="fchip">Gewinn <b>${fmt(total)}</b></span>`;
    el.featureBar.innerHTML = h;
  }
  function holdBar(st, sumNow) {
    const n = Object.keys(st.locked).length;
    el.featureBar.innerHTML = `<span class="fchip">Respins <span class="pips">${[0, 1, 2].map(i => `<i class="${i < st.respins ? 'on' : ''}"></i>`).join('')}</span></span>
      <span class="fchip">Monde <b>${n}/15</b></span><span class="fchip">Summe <b>${fmt(sumNow)}</b></span>`;
  }

  // ---------- overlays ----------
  function overlay(html, opts) {
    opts = opts || {};
    return new Promise(res => {
      el.overlay.innerHTML = `<div class="ov-card ${opts.cls || ''}" role="dialog" aria-modal="true">${html}</div>`;
      el.overlay.hidden = false;
      let done = false;
      const finish = val => {
        if (done) return; done = true;
        el.overlay.hidden = true; el.overlay.innerHTML = ''; el.overlay.onclick = null;
        res(val);
      };
      el.overlay.onclick = e => {
        const b = e.target.closest('[data-v]');
        if (b) finish(b.getAttribute('data-v'));
        else if (opts.tapClose) finish('tap');
      };
      if (opts.auto) setTimeout(() => finish('auto'), opts.auto);
      if (opts.onOpen) opts.onOpen(el.overlay.firstChild, finish);
    });
  }
  function coinRain(n) {
    const wrap = document.createElement('div'); wrap.className = 'coin-rain';
    for (let i = 0; i < n; i++) {
      const s = document.createElement('span'); s.textContent = '🪙';
      s.style.left = Math.random() * 100 + '%';
      s.style.animationDuration = (1.6 + Math.random() * 1.8) + 's';
      s.style.animationDelay = Math.random() * 1.2 + 's';
      wrap.appendChild(s);
    }
    document.body.appendChild(wrap); setTimeout(() => wrap.remove(), 4800);
  }
  async function bigWin(amount) {
    const x = amount / bet();
    if (x < 15) return;
    const title = x >= 100 ? 'Epischer Gewinn' : x >= 50 ? 'Mega Gewinn' : x >= 25 ? 'Super Gewinn' : 'Großer Gewinn';
    Sound.feature(); coinRain(x >= 50 ? 60 : 30);
    await overlay(`<h2>${title}</h2><div class="amount" id="bwAmt">0</div><p>${fmt(x)}× dein Einsatz</p><button class="cta" data-v="ok" type="button">Einsammeln</button>`, {
      cls: 'bigwin', tapClose: true, auto: R.autoLeft ? 4200 : 0,
      onOpen(card) {
        const a = card.querySelector('#bwAmt'); const t0 = performance.now(); const ms = S.turbo ? 300 : 2200;
        (function step(t) {
          const p = Math.min(1, (t - t0) / ms); a.textContent = fmt(amount * (1 - Math.pow(1 - p, 3)));
          if (p < 1 && document.body.contains(a)) requestAnimationFrame(step);
        })(t0);
      }
    });
  }

  // ---------- free spins ----------
  async function runFreeSpins(g, feature) {
    const fs = Object.assign({}, feature);
    Sound.feature();
    if (g.id === 'codex') {
      await overlay(`<h2>${fs.spins} Freispiele</h2><p>Dein expandierendes Bonussymbol:</p><div class="picker" id="pick">❔</div><button class="cta" data-v="go" type="button" id="goBtn" hidden>Los geht's</button>`, {
        auto: R.autoLeft ? 4200 : 0,
        onOpen(card) {
          const p = card.querySelector('#pick'); const keys = ['explorer', 'mask', 'vase', 'scarab', 'A', 'K', 'Q', 'J', 'T'];
          let i = 0; const iv = setInterval(() => {
            const k = keys[i++ % keys.length]; const d = g.symbols[k];
            p.innerHTML = d.e || `<span class="royal r-${k}">${d.t}</span>`; Sound.click();
          }, 90);
          setTimeout(() => {
            clearInterval(iv); const d = g.symbols[fs.expand];
            p.innerHTML = d.e || `<span class="royal r-${fs.expand}">${d.t}</span>`; p.classList.add('done'); Sound.coin();
            const b = card.querySelector('#goBtn'); if (b) b.hidden = false;
          }, 1700);
        }
      });
    } else {
      const sub = { angler: 'Der Angler sammelt jetzt alle Geld-Fische ein.', sugar: 'Bomben multiplizieren jetzt deine Kaskaden.' }[g.id] || '';
      await overlay(`<div class="huge">${META[g.id].art[0]}</div><h2>${fs.spins} Freispiele</h2><p>${sub}</p><button class="cta" data-v="go" type="button">Los geht's</button>`, { auto: R.autoLeft ? 2600 : 0 });
    }
    el.machine.classList.add('in-fs');
    let left = fs.spins, total = 0, played = 0;
    while (left > 0 && played < 300) {
      left--; played++;
      fsBar(g, fs, left, total);
      const r = g.featureSpin(bet(), fs);
      let shown = 0;
      setMsg(`Freispiel ${played}`, '');
      if (g.type === 'tumble') {
        shown = await playTumble(g, r, true, 0);
      } else {
        await animateReels(g, r.grid, r.vals);
        const normal = r.wins.filter(w => w.kind !== 'expand' && w.kind !== 'collect');
        shown = await presentWins(g, normal, 0);
        const ex = r.wins.find(w => w.kind === 'expand');
        if (ex) {
          clearWinState();
          Sound.feature();
          for (const c of r.expanded.reels) {
            const strip = cols()[c].querySelector('.strip');
            strip.innerHTML = [0, 1, 2].map(() => cellHTML(g, r.expanded.sym, 0, 'expanded')).join('');
            R.lastGrid[g.id][c] = [r.expanded.sym, r.expanded.sym, r.expanded.sym];
            await sleep(T(260, 90));
          }
          shown = await presentWins(g, [ex], shown);
          await sleep(T(500, 150));
        }
        const col = r.wins.find(w => w.kind === 'collect');
        if (col) {
          clearWinState();
          const fishCells = col.cells.filter(([c, rr]) => r.grid[c][rr] === 'fish');
          fishCells.forEach(([c, rr]) => floater(c, rr, '+' + fmt(r.vals[c][rr] * bet() * col.mult)));
          Sound.coin();
          shown = await presentWins(g, [col], shown);
        }
        if (r.levelUp) {
          fsBar(g, fs, left + r.retrigger, total + shown);
          toast(`Multiplikator x${g.multLevels[fs.level]} und +10 Freispiele!`);
          Sound.feature();
        }
      }
      total += r.win; credit(r.win);
      if (Math.abs(shown - r.win) > 0.01) el.winAmt.textContent = fmt(r.win);
      if (r.retrigger) {
        left += r.retrigger;
        if (!r.levelUp) { toast(`+${r.retrigger} Freispiele!`); Sound.feature(); }
      }
      fsBar(g, fs, left, total);
      await sleep(T(650, 250));
    }
    el.machine.classList.remove('in-fs');
    Sound.win(total / bet());
    await overlay(`<h2>Freispiele vorbei</h2><p>Dein Gewinn</p><div class="amount">${fmt(total)}</div><button class="cta" data-v="ok" type="button">Weiter</button>`, { tapClose: true, auto: R.autoLeft ? 2500 : 0 });
    el.featureBar.innerHTML = baseFeatureChips(g);
    return total;
  }

  // ---------- hold & spin ----------
  async function runHold(g, feature) {
    const st = { locked: {}, respins: 3 };
    feature.moons.forEach(m => { st.locked[m.c + ',' + m.r] = m.v; });
    Sound.feature();
    await overlay(`<div class="huge">🌕</div><h2>Hold &amp; Spin</h2><p>${feature.moons.length} Monde bleiben stehen. Jeder neue Mond bringt 3 frische Respins.</p><button class="cta" data-v="go" type="button">Los geht's</button>`, { auto: R.autoLeft ? 2600 : 0 });
    el.machine.classList.add('in-fs');
    clearWinState();
    const sumNow = () => Object.values(st.locked).reduce((a, v) => a + g.valueOf(v), 0) * bet();
    const render = (newKeys) => {
      cols().forEach((col, c) => {
        const strip = col.querySelector('.strip');
        strip.innerHTML = [0, 1, 2].map(r => {
          const k = c + ',' + r; const v = st.locked[k];
          return v !== undefined ? cellHTML(g, 'moon', v, newKeys && newKeys.includes(k) ? 'landed' : '') : emptyCellHTML(g);
        }).join('');
      });
    };
    render();
    holdBar(st, sumNow());
    setMsg('Hold & Spin', fmt(sumNow()));
    await sleep(T(700, 300));
    while (st.respins > 0 && Object.keys(st.locked).length < 15) {
      el.reels.querySelectorAll('.cell.empty').forEach(c => c.classList.add('flick'));
      Sound.click();
      await sleep(T(850, 320));
      const added = g.holdSpin(st);
      render(added.map(a => a.c + ',' + a.r));
      if (added.length) { Sound.coin(); setMsg(`+${added.length} Mond${added.length > 1 ? 'e' : ''}! Respins wieder auf 3`, fmt(sumNow())); }
      else { Sound.stop(); setMsg(`Noch ${st.respins} Respin${st.respins === 1 ? '' : 's'}`, fmt(sumNow())); }
      holdBar(st, sumNow());
      await sleep(T(500, 200));
    }
    const res = g.holdTotal(st, bet());
    markCells(Object.keys(st.locked).map(k => k.split(',').map(Number)));
    if (res.grand) { Sound.feature(); toast('GRAND JACKPOT! Alle 15 Felder voll!'); }
    await countUp(sumNow(), res.amount, 900);
    await sleep(T(800, 300));
    el.machine.classList.remove('in-fs');
    await overlay(`<h2>${res.grand ? 'Grand Jackpot' : 'Hold & Spin'}</h2><p>${Object.keys(st.locked).length} Monde gesammelt</p><div class="amount">${fmt(res.amount)}</div><button class="cta" data-v="ok" type="button">Einsammeln</button>`, { tapClose: true, auto: R.autoLeft ? 2500 : 0 });
    credit(res.amount);
    // restore normal reels showing the moons screen
    const grid = [], vals = [];
    for (let c = 0; c < 5; c++) {
      grid.push([0, 1, 2].map(r => {
        if (st.locked[c + ',' + r] !== undefined) return 'moon';
        const s = randomSym(g);
        return s === 'moon' || s === 'wolf' ? 'A' : s;
      }));
      vals.push([0, 1, 2].map(r => st.locked[c + ',' + r] || 0));
    }
    R.lastGrid[g.id] = grid; R.lastVals[g.id] = vals; setStatic(g, grid, vals);
    clearWinState();
    el.featureBar.innerHTML = baseFeatureChips(g);
    return res.amount;
  }

  // ---------- main spin ----------
  async function spin() {
    const g = R.game;
    if (!g || R.busy) return;
    Sound.ensure();
    if (S.balance < bet()) {
      R.autoLeft = 0; renderControls();
      if (S.balance < BETS[0]) offerRefill();
      else toast('Nicht genug Münzen für diesen Einsatz. Senke den Einsatz.');
      return;
    }
    R.busy = true; R.gambleWin = 0; renderControls();
    S.balance = Math.round((S.balance - bet()) * 100) / 100; renderBalance(false);
    const st = S.stats[g.id] || (S.stats[g.id] = { spins: 0, best: 0 }); st.spins++;
    save();
    setMsg('', '');
    let roundWin = 0;
    try {
      const res = g.baseSpin(bet());
      let shown = 0;
      if (g.type === 'tumble') shown = await playTumble(g, res, false, 0);
      else { await animateReels(g, res.grid, res.vals); shown = await presentWins(g, res.wins, 0); }
      roundWin += res.win; credit(res.win);
      if (!res.win) setMsg(res.feature ? 'Bonus!' : pickNoWinLine(), '');
      if (res.feature) {
        if (res.feature.type === 'fs') {
          if (g.type !== 'tumble') markCells(findSym(res.grid, g.scatter));
          else markCells(res.scatCells);
          await sleep(T(900, 400));
          roundWin += await runFreeSpins(g, res.feature);
        } else if (res.feature.type === 'hold') {
          markCells(findSym(res.grid, 'moon'));
          await sleep(T(900, 400));
          roundWin += await runHold(g, res.feature);
        }
        setMsg('Gesamtgewinn', fmt(roundWin));
      }
      recordWin(g.id, roundWin);
      await bigWin(roundWin);
      R.gambleWin = !res.feature && roundWin > 0 && roundWin <= bet() * 50 ? roundWin : 0;
    } catch (err) {
      console.error(err);
      setMsg('Ups, da ist etwas schiefgelaufen. Bitte nochmal drehen.', '');
    }
    R.busy = false;
    renderControls();
    if (R.autoLeft > 0) {
      R.autoLeft--;
      if (R.autoLeft > 0 && S.balance >= bet() && R.game === g) { await sleep(T(450, 120)); if (R.autoLeft > 0) spin(); }
      else { R.autoLeft = 0; renderControls(); }
    }
  }
  const noWin = ['Knapp daneben!', 'Nächste Runde, nächstes Glück.', 'Die Walzen wärmen sich auf…', 'Gleich klappt es!'];
  function pickNoWinLine() { return noWin[Math.floor(Math.random() * noWin.length)]; }
  function findSym(grid, s) { const out = []; grid.forEach((col, c) => col.forEach((x, r) => { if (x === s) out.push([c, r]); })); return out; }

  function offerRefill() {
    overlay(`<div class="huge">🪙</div><h2>Münzen leer</h2><p>Kein Problem, hier sind ${fmt(REFILL)} neue Gratis-Münzen.</p><button class="cta" data-v="ok" type="button">Nachladen</button>`).then(() => {
      S.balance += REFILL; save(); renderBalance(true); Sound.coin();
    });
  }

  // ---------- gamble (red / black) ----------
  async function gamble() {
    if (R.busy || !R.gambleWin) return;
    Sound.ensure();
    R.busy = true; renderControls();
    let stake = R.gambleWin; R.gambleWin = 0;
    S.balance = Math.round((S.balance - stake) * 100) / 100; renderBalance(false); save();
    let rounds = 0; const hist = [];
    const suits = { red: ['♥', '♦'], black: ['♠', '♣'] };
    const result = await overlay(`<h2>Risiko</h2><p>Rot oder Schwarz? Richtig geraten verdoppelt deinen Gewinn.</p>
      <div class="amount" id="gStake">${fmt(stake)}</div><div class="gcard" id="gCard"></div><div class="ghistory" id="gHist"></div>
      <div class="row"><button class="cta btn-red" type="button" id="gRed">Rot</button><button class="cta btn-black" type="button" id="gBlack">Schwarz</button></div>
      <button class="cta secondary" type="button" id="gTake">Einsammeln</button>`, {
      onOpen(card, finish) {
        const cardEl = card.querySelector('#gCard'), stakeEl = card.querySelector('#gStake'), histEl = card.querySelector('#gHist');
        const btns = [card.querySelector('#gRed'), card.querySelector('#gBlack'), card.querySelector('#gTake')];
        let locked = false;
        const guess = async color => {
          if (locked) return; locked = true; btns.forEach(b => { b.disabled = true; });
          const actual = E.rnd() < 0.5 ? 'red' : 'black';
          const suit = suits[actual][Math.floor(E.rnd() * 2)];
          cardEl.className = 'gcard face ' + actual; cardEl.textContent = suit;
          hist.unshift({ suit, actual }); histEl.innerHTML = hist.slice(0, 6).map(h => `<span class="gcard-mini" style="color:${h.actual === 'red' ? '#c8102e' : '#141414'}">${h.suit}</span>`).join('');
          if (actual === color) {
            stake *= 2; rounds++; stakeEl.textContent = fmt(stake); Sound.win(2);
            await sleep(900);
            if (rounds >= 5) { finish('max'); return; }
            cardEl.className = 'gcard'; cardEl.textContent = ''; locked = false; btns.forEach(b => { b.disabled = false; });
          } else {
            stake = 0; stakeEl.textContent = '0'; Sound.lose();
            await sleep(1100); finish('lost');
          }
        };
        btns[0].onclick = e => { e.stopPropagation(); guess('red'); };
        btns[1].onclick = e => { e.stopPropagation(); guess('black'); };
        btns[2].onclick = e => { e.stopPropagation(); if (!locked) finish('take'); };
      }
    });
    if (stake > 0) { credit(stake); setMsg(result === 'max' ? 'Maximum erreicht, Gewinn gesichert' : 'Gewinn gesichert', fmt(stake)); Sound.coin(); recordWin(R.game.id, stake); }
    else setMsg('Leider verloren', '0');
    R.busy = false; renderControls();
  }

  // ---------- info / paytable ----------
  function openInfo() {
    if (R.busy) return;
    const g = R.game; const b = bet();
    let pt = '';
    if (g.type === 'tumble') {
      pt = Object.keys(g.pays).map(s => `<div class="pt-item"><span class="ps">${symIcon(g, s)}</span><dl>
        <dt>12+</dt><dd>${fmt(g.pays[s][2] * b)}</dd><dt>10–11</dt><dd>${fmt(g.pays[s][1] * b)}</dd><dt>8–9</dt><dd>${fmt(g.pays[s][0] * b)}</dd></dl></div>`).join('');
      pt += `<div class="pt-item"><span class="ps">🍭</span><dl>${Object.keys(g.scatterPays).reverse().map(n => `<dt>${n}${n === '6' ? '+' : ''}×</dt><dd>${fmt(g.scatterPays[n] * b)}</dd>`).join('')}</dl></div>`;
    } else {
      const lb = b / g.lineCount;
      pt = Object.keys(g.pays).map(s => `<div class="pt-item"><span class="ps">${g.symbols[s].e || `<span class="royal r-${s}">${g.symbols[s].t}</span>`}</span><dl>
        ${Object.keys(g.pays[s]).sort((x, y) => y - x).map(n => `<dt>${n}×</dt><dd>${fmt(g.pays[s][n] * lb)}</dd>`).join('')}</dl></div>`).join('');
      if (g.scatterPays) {
        pt += `<div class="pt-item"><span class="ps">${symIcon(g, g.scatter)}</span><dl>${Object.keys(g.scatterPays).sort((x, y) => y - x).map(n => `<dt>${n}×</dt><dd>${fmt(g.scatterPays[n] * b)}</dd>`).join('')}</dl></div>`;
      }
    }
    const extra = g.id === 'wolf' ? `<p class="meta">Mondwerte: 1x bis 25x Einsatz · MINI ${fmt(g.JACK.MINI * b)} · MAJOR ${fmt(g.JACK.MAJOR * b)} · GRAND ${fmt(g.JACK.GRAND * b)}</p>` :
      g.id === 'angler' ? `<p class="meta">Geld-Fische tragen Werte von ${fmt(2 * b)} bis ${fmt(2000 * b)}.</p>` : '';
    overlay(`<button class="ghost-btn close-x" type="button" data-v="x" aria-label="Schließen">✕</button><h2>${g.name}</h2>
      <ul>${g.info.map(t => `<li>${t}</li>`).join('')}</ul>
      <p class="meta">Gewinne beim aktuellen Einsatz von ${fmt(b)} Münzen</p>
      <div class="paytable">${pt}</div>${extra}
      <p class="meta">Simulierte Auszahlungsquote ca. ${RTP[g.id]} % · Volatilität ${META[g.id].vol}</p>`, { cls: 'modal-card', tapClose: false });
  }

  // ---------- controls ----------
  function renderControls() {
    el.betVal.textContent = fmt(bet());
    const lock = R.busy || R.autoLeft > 0;
    el.betMinus.disabled = lock || S.betIdx === 0;
    el.betPlus.disabled = lock || S.betIdx === BETS.length - 1;
    el.turbo.classList.toggle('on', S.turbo);
    el.turbo.setAttribute('aria-pressed', S.turbo ? 'true' : 'false');
    el.soundBtn.textContent = S.muted ? '🔇' : '🔊';
    el.gamble.disabled = R.busy || !R.gambleWin || R.autoLeft > 0;
    el.info.disabled = R.busy;
    el.back.disabled = R.busy;
    if (R.autoLeft > 0) {
      el.spin.classList.add('stop');
      el.spin.innerHTML = `STOP<span class="auto-count">${R.autoLeft === Infinity ? '∞' : R.autoLeft}</span>`;
      el.spin.disabled = false;
    } else {
      el.spin.classList.remove('stop'); el.spin.textContent = 'DREHEN'; el.spin.disabled = R.busy;
    }
    el.auto.classList.toggle('on', R.autoLeft > 0 || !el.autoMenu.hidden);
  }

  // ---------- events ----------
  el.grid.addEventListener('click', e => {
    const c = e.target.closest('[data-game]'); if (!c) return;
    Sound.ensure(); Sound.click();
    location.hash = c.getAttribute('data-game');
  });
  window.addEventListener('hashchange', () => { if (R.busy) return; route(); });
  el.back.addEventListener('click', () => { if (!R.busy) { R.autoLeft = 0; location.hash = 'lobby'; } });
  el.spin.addEventListener('click', () => {
    if (R.autoLeft > 0) { R.autoLeft = 0; renderControls(); return; }
    spin();
  });
  el.betMinus.addEventListener('click', () => { if (S.betIdx > 0) { S.betIdx--; Sound.click(); save(); renderControls(); refreshVals(); } });
  el.betPlus.addEventListener('click', () => { if (S.betIdx < BETS.length - 1) { S.betIdx++; Sound.click(); save(); renderControls(); refreshVals(); } });
  function refreshVals() { const g = R.game; if (g && g.type !== 'tumble' && !R.busy) setStatic(g, R.lastGrid[g.id], R.lastVals[g.id]); }
  el.turbo.addEventListener('click', () => { S.turbo = !S.turbo; save(); renderControls(); });
  el.auto.addEventListener('click', () => {
    if (R.autoLeft > 0) { R.autoLeft = 0; renderControls(); return; }
    el.autoMenu.hidden = !el.autoMenu.hidden; renderControls();
  });
  el.autoMenu.addEventListener('click', e => {
    const b = e.target.closest('[data-auto]'); if (!b) return;
    R.autoLeft = Number(b.getAttribute('data-auto'));
    el.autoMenu.hidden = true; renderControls();
    if (!R.busy) spin();
  });
  el.gamble.addEventListener('click', gamble);
  el.info.addEventListener('click', openInfo);
  el.soundBtn.addEventListener('click', () => { S.muted = !S.muted; save(); Sound.ensure(); renderControls(); });
  el.bonusBtn.addEventListener('click', () => {
    if (Date.now() - S.lastBonus < BONUS_EVERY) return;
    S.lastBonus = Date.now(); S.balance += BONUS; save(); renderBalance(true); renderBonus();
    Sound.ensure(); Sound.coin(); toast(`+${fmt(BONUS)} Bonus-Münzen! Der nächste Bonus kommt in 4 Stunden.`);
  });
  document.addEventListener('keydown', e => {
    if (e.code !== 'Space' || el.game.hidden || !el.overlay.hidden) return;
    if (e.target.closest && e.target.closest('input, textarea')) return;
    e.preventDefault();
    if (R.autoLeft > 0) { R.autoLeft = 0; renderControls(); } else spin();
  });
  window.addEventListener('resize', () => { el.lines.innerHTML = ''; });

  // ---------- boot ----------
  renderBalance(false); renderBonus(); setInterval(renderBonus, 30000);
  renderControls();
  route();
})();
