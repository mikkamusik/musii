/* Lucky Musii Casino – game engine (play money only).
 * Pure logic, no DOM. Works in the browser (window.Engine) and in Node (module.exports).
 */
(function (root) {
  'use strict';

  // ---------- RNG ----------
  const buf = new Uint32Array(1);
  const cryptoObj = (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.getRandomValues) ? globalThis.crypto : null;
  function rnd() {
    if (cryptoObj) { cryptoObj.getRandomValues(buf); return buf[0] / 4294967296; }
    return Math.random();
  }
  function table(obj) {
    const keys = Object.keys(obj); let tot = 0;
    const cum = keys.map(k => (tot += obj[k]));
    return { keys, cum, tot };
  }
  function pick(t) {
    const x = rnd() * t.tot;
    for (let i = 0; i < t.cum.length; i++) if (x < t.cum[i]) return t.keys[i];
    return t.keys[t.keys.length - 1];
  }
  const round2 = v => Math.round(v * 100) / 100;

  // ---------- Paylines (row index per column) ----------
  const LINES20 = [
    [1, 1, 1, 1, 1], [0, 0, 0, 0, 0], [2, 2, 2, 2, 2], [0, 1, 2, 1, 0], [2, 1, 0, 1, 2],
    [1, 0, 0, 0, 1], [1, 2, 2, 2, 1], [0, 0, 1, 2, 2], [2, 2, 1, 0, 0], [1, 0, 1, 2, 1],
    [0, 1, 1, 1, 0], [2, 1, 1, 1, 2], [0, 1, 0, 1, 0], [2, 1, 2, 1, 2], [1, 0, 1, 0, 1],
    [1, 1, 0, 1, 1], [1, 1, 2, 1, 1], [0, 0, 2, 0, 0], [2, 2, 0, 2, 2], [0, 2, 0, 2, 0]
  ];

  // Build a cols x rows grid from per-reel weight tables.
  // `unique` = symbols that may appear at most once per reel (scatters).
  function spinGrid(reelTables, rows, unique) {
    return reelTables.map(t => {
      const col = [];
      for (let r = 0; r < rows; r++) {
        let s = pick(t), guard = 0;
        while (unique && unique.includes(s) && col.includes(s) && guard++ < 20) s = pick(t);
        col.push(s);
      }
      return col;
    });
  }

  function evalLines(grid, lines, pays, wild, lineBet) {
    const wins = [];
    lines.forEach((line, li) => {
      const syms = line.map((r, c) => grid[c][r]);
      let base = null;
      for (const s of syms) { if (s !== wild) { base = s; break; } }
      let best = null;
      if (base && pays[base]) {
        let n = 0; while (n < syms.length && (syms[n] === base || syms[n] === wild)) n++;
        const p = pays[base][n] || 0;
        if (p) best = { sym: base, count: n, mult: p };
      }
      if (wild && pays[wild]) {
        let n = 0; while (n < syms.length && syms[n] === wild) n++;
        const p = pays[wild][n] || 0;
        if (p && (!best || p > best.mult)) best = { sym: wild, count: n, mult: p };
      }
      if (best) {
        wins.push({
          kind: 'line', line: li, sym: best.sym, count: best.count,
          cells: line.slice(0, best.count).map((r, c) => [c, r]),
          amount: round2(best.mult * lineBet)
        });
      }
    });
    return wins;
  }

  function findCells(grid, sym) {
    const cells = [];
    grid.forEach((col, c) => col.forEach((s, r) => { if (s === sym) cells.push([c, r]); }));
    return cells;
  }
  const sum = (arr, f) => arr.reduce((a, x) => a + (f ? f(x) : x), 0);

  // =====================================================================
  // 1) PHARAOH'S CODEX – book style: wild+scatter, free spins w/ expanding symbol
  // =====================================================================
  const codex = (function () {
    const BOOK = 'book';
    const pays = {
      explorer: { 2: 10, 3: 100, 4: 1000, 5: 5000 },
      mask: { 2: 5, 3: 40, 4: 400, 5: 2000 },
      vase: { 2: 5, 3: 30, 4: 100, 5: 750 },
      scarab: { 2: 5, 3: 30, 4: 100, 5: 750 },
      A: { 3: 5, 4: 40, 5: 150 }, K: { 3: 5, 4: 40, 5: 150 },
      Q: { 3: 5, 4: 25, 5: 100 }, J: { 3: 5, 4: 25, 5: 100 }, T: { 3: 5, 4: 25, 5: 100 }
    };
    const scatterPays = { 3: 2, 4: 20, 5: 200 };
    const w = { explorer: 3, mask: 4, vase: 6, scarab: 6, A: 10.5, K: 10.5, Q: 12.5, J: 12.5, T: 12.5, book: 2.45 };
    const reels = [0, 1, 2, 3, 4].map(() => table(w));
    const lines = LINES20.slice(0, 10);
    const expandable = ['explorer', 'mask', 'vase', 'scarab', 'A', 'K', 'Q', 'J', 'T'];
    const minExpand = s => (pays[s][2] ? 2 : 3);

    function evaluate(grid, bet, expand) {
      const lineBet = bet / 10;
      const wins = evalLines(grid, lines, pays, BOOK, lineBet);
      const bookCells = findCells(grid, BOOK);
      const bookReels = new Set(bookCells.map(c => c[0])).size;
      if (scatterPays[bookReels]) wins.push({ kind: 'scatter', sym: BOOK, count: bookReels, cells: bookCells, amount: round2(scatterPays[bookReels] * bet) });
      let expanded = null;
      if (expand) {
        const reelsWith = [];
        grid.forEach((col, c) => { if (col.includes(expand)) reelsWith.push(c); });
        const k = reelsWith.length;
        if (k >= minExpand(expand) && pays[expand][k]) {
          const cells = [];
          reelsWith.forEach(c => { for (let r = 0; r < 3; r++) cells.push([c, r]); });
          const amount = round2(pays[expand][k] * lineBet * 10);
          expanded = { reels: reelsWith, sym: expand };
          wins.push({ kind: 'expand', sym: expand, count: k, cells, amount });
        }
      }
      return { wins, win: round2(sum(wins, x => x.amount)), books: bookReels, expanded };
    }

    return {
      id: 'codex', name: "Pharaoh's Codex", cols: 5, rows: 3, type: 'lines', lineCount: 10,
      tagline: 'Expandierendes Symbol in den Freispielen',
      symbols: {
        explorer: { e: '🤠', label: 'Forscher' }, mask: { e: '👑', label: 'Pharao' }, vase: { e: '🏺', label: 'Vase' },
        scarab: { e: '🪲', label: 'Skarabäus' }, book: { e: '📜', label: 'Codex', tag: 'WILD' },
        A: { t: 'A' }, K: { t: 'K' }, Q: { t: 'Q' }, J: { t: 'J' }, T: { t: '10' }
      },
      pays, scatterPays, lines, wild: BOOK, scatter: BOOK,
      info: [
        'Der Codex 📜 ist Wild und Scatter zugleich.',
        '3 oder mehr Codex irgendwo = 10 Freispiele.',
        'Vor den Freispielen wird ein Bonussymbol gezogen. Es expandiert über die ganze Walze und zahlt auf allen 10 Linien, auch auf nicht benachbarten Walzen.',
        'Freispiele können erneut ausgelöst werden.'
      ],
      baseSpin(bet) {
        const grid = spinGrid(reels, 3, [BOOK]);
        const ev = evaluate(grid, bet, null);
        const feature = ev.books >= 3 ? { type: 'fs', spins: 10, expand: expandable[Math.floor(rnd() * expandable.length)] } : null;
        return { grid, wins: ev.wins, win: ev.win, feature };
      },
      featureSpin(bet, fs) {
        const grid = spinGrid(reels, 3, [BOOK]);
        const ev = evaluate(grid, bet, fs.expand);
        const retrigger = ev.books >= 3 ? 10 : 0;
        return { grid, wins: ev.wins, win: ev.win, retrigger, expanded: ev.expanded };
      }
    };
  })();

  // =====================================================================
  // 2) ANGLER'S FORTUNE – fishing: money fish collected by angler wilds in free spins
  // =====================================================================
  const angler = (function () {
    const WILD = 'angler', SCAT = 'buoy', FISH = 'fish';
    const pays = {
      angler: { 2: 2, 3: 20, 4: 200, 5: 2000 },
      boat: { 2: 2, 3: 20, 4: 100, 5: 1000 },
      rod: { 3: 15, 4: 75, 5: 500 },
      frog: { 3: 10, 4: 50, 5: 200 },
      fish: { 3: 10, 4: 50, 5: 200 },
      A: { 3: 5, 4: 20, 5: 100 }, K: { 3: 5, 4: 20, 5: 100 },
      Q: { 3: 5, 4: 10, 5: 50 }, J: { 3: 5, 4: 10, 5: 50 }, T: { 3: 5, 4: 10, 5: 50 }
    };
    const scatterPays = { 3: 2, 4: 20, 5: 200 };
    const baseW = { angler: 4, boat: 4, rod: 5, frog: 7, fish: 8, A: 7, K: 7, Q: 8, J: 8, T: 8, buoy: 2.28 };
    const fsW = Object.assign({}, baseW, { angler: 0.95, buoy: 1.2, fish: 10 });
    const baseReels = [0, 1, 2, 3, 4].map(() => table(baseW));
    const fsReels = [0, 1, 2, 3, 4].map(() => table(fsW));
    const fishVals = table({ 2: 40, 3: 25, 4: 15, 5: 12, 10: 8, 15: 4, 20: 3, 25: 2, 50: 1, 250: 0.05, 2000: 0.003 });
    const lines = LINES20.slice(0, 10);
    const multLevels = [1, 2, 3, 10];

    function fishValues(grid) {
      return grid.map(col => col.map(s => (s === FISH ? Number(pick(fishVals)) : 0)));
    }
    return {
      id: 'angler', name: "Angler's Fortune", cols: 5, rows: 3, type: 'lines', lineCount: 10,
      tagline: 'Angler sammelt die Geld-Fische ein',
      symbols: {
        angler: { e: '🎣', label: 'Angler', tag: 'WILD' }, buoy: { e: '🛟', label: 'Bonus', tag: 'SCATTER' },
        fish: { e: '🐟', label: 'Geld-Fisch' }, boat: { e: '🚤', label: 'Boot' }, rod: { e: '🪝', label: 'Haken' }, frog: { e: '🐸', label: 'Frosch' },
        A: { t: 'A' }, K: { t: 'K' }, Q: { t: 'Q' }, J: { t: 'J' }, T: { t: '10' }
      },
      pays, scatterPays, lines, wild: WILD, scatter: SCAT, multLevels,
      info: [
        '3, 4 oder 5 Rettungsringe 🛟 = 10, 15 oder 20 Freispiele.',
        'In den Freispielen erscheint der Angler 🎣 als Wild. Jeder Angler sammelt den Wert aller Geld-Fische 🐟 auf dem Bildschirm ein.',
        'Alle 4 gesammelten Angler gibt es +10 Freispiele und einen höheren Multiplikator für eingesammelte Fische: x2, x3, x10.',
        'Fischwerte sind ein Vielfaches des Einsatzes (bis zu 2000x).'
      ],
      baseSpin(bet) {
        const grid = spinGrid(baseReels, 3, [SCAT]);
        const vals = fishValues(grid);
        const wins = evalLines(grid, lines, pays, WILD, bet / 10);
        const sc = findCells(grid, SCAT);
        if (scatterPays[sc.length]) wins.push({ kind: 'scatter', sym: SCAT, count: sc.length, cells: sc, amount: round2(scatterPays[sc.length] * bet) });
        const feature = sc.length >= 3 ? { type: 'fs', spins: { 3: 10, 4: 15, 5: 20 }[sc.length], collected: 0, level: 0 } : null;
        return { grid, vals, wins, win: round2(sum(wins, x => x.amount)), feature };
      },
      featureSpin(bet, fs) {
        const grid = spinGrid(fsReels, 3, [SCAT]);
        const vals = fishValues(grid);
        const wins = evalLines(grid, lines, pays, WILD, bet / 10);
        const sc = findCells(grid, SCAT);
        if (scatterPays[sc.length]) wins.push({ kind: 'scatter', sym: SCAT, count: sc.length, cells: sc, amount: round2(scatterPays[sc.length] * bet) });
        const wildCells = findCells(grid, WILD);
        const fishCells = findCells(grid, FISH);
        const mult = multLevels[fs.level];
        if (wildCells.length && fishCells.length) {
          const fishSum = sum(fishCells, ([c, r]) => vals[c][r]);
          wins.push({ kind: 'collect', sym: WILD, count: wildCells.length, cells: wildCells.concat(fishCells), mult, amount: round2(fishSum * bet * wildCells.length * mult) });
        }
        let retrigger = 0, levelUp = false;
        const before = fs.collected;
        const after = before + wildCells.length;
        // every 4 collected anglers => +10 spins and next multiplier (max level 3)
        let crossings = Math.floor(after / 4) - Math.floor(before / 4);
        while (crossings-- > 0 && fs.level < 3) { fs.level++; retrigger += 10; levelUp = true; }
        fs.collected = after;
        if (sc.length >= 3) retrigger += 5;
        return { grid, vals, wins, win: round2(sum(wins, x => x.amount)), retrigger, levelUp };
      }
    };
  })();

  // =====================================================================
  // 3) SUGAR STORM – 6x5 pay anywhere, tumbles, multiplier bombs in free spins
  // =====================================================================
  const sugar = (function () {
    const SCAT = 'lolly', BOMB = 'bomb';
    const pays = { // [8-9, 10-11, 12+] x total bet
      heart: [10, 25, 50], cupcake: [2.5, 10, 25], donut: [2, 5, 15], choco: [1.5, 2, 12],
      melon: [1, 1.5, 10], grape: [0.8, 1.2, 8], apple: [0.5, 1, 5], peach: [0.4, 0.9, 4], banana: [0.25, 0.75, 2]
    };
    Object.keys(pays).forEach(k => { pays[k] = pays[k].map(v => round2(v * 1.7)); });
    const scatterPays = { 4: 3, 5: 5, 6: 100 };
    const baseW = { heart: 3, cupcake: 4, donut: 5, choco: 6, melon: 8, grape: 9, apple: 10, peach: 11, banana: 14, lolly: 1.3 };
    const fsW = Object.assign({}, baseW, { bomb: 7, lolly: 0.55, peach: 13, banana: 18.5 });
    const baseT = table(baseW), fsT = table(fsW);
    const bombVals = table({ 2: 30, 3: 22, 4: 15, 5: 12, 6: 8, 8: 6, 10: 5, 12: 3, 15: 2.2, 20: 1.5, 25: 1, 50: 0.4, 100: 0.12 });
    const COLS = 6, ROWS = 5;

    function newCell(t, isFs) {
      const s = pick(t);
      return s === BOMB ? { s, v: Number(pick(bombVals)) } : { s };
    }
    function fill(t) {
      const g = [];
      for (let c = 0; c < COLS; c++) { const col = []; for (let r = 0; r < ROWS; r++) col.push(newCell(t)); g.push(col); }
      return g;
    }
    function payFor(sym, n) { const p = pays[sym]; if (!p || n < 8) return 0; return n >= 12 ? p[2] : n >= 10 ? p[1] : p[0]; }

    // Run a whole tumble sequence. Returns steps for animation.
    function sequence(bet, t, isFs) {
      let grid = fill(t);
      const steps = [];
      let seqWin = 0;
      for (let guard = 0; guard < 50; guard++) {
        const counts = {};
        grid.forEach(col => col.forEach(x => { counts[x.s] = (counts[x.s] || 0) + 1; }));
        const wins = [];
        Object.keys(pays).forEach(sym => {
          const n = counts[sym] || 0; const p = payFor(sym, n);
          if (p) wins.push({ kind: 'cluster', sym, count: n, cells: findCellsObj(grid, sym), amount: round2(p * bet) });
        });
        const stepWin = round2(sum(wins, x => x.amount));
        steps.push({ grid: cloneGrid(grid), wins, win: stepWin });
        if (!wins.length) break;
        seqWin = round2(seqWin + stepWin);
        // tumble: remove winning symbols, drop remaining down, fill top
        const remove = new Set(wins.map(w => w.sym));
        const next = [], falls = [];
        for (let c = 0; c < COLS; c++) {
          const kept = grid[c].filter(x => !remove.has(x.s));
          const missing = ROWS - kept.length;
          const fresh = []; for (let i = 0; i < missing; i++) fresh.push(newCell(t));
          const col = fresh.concat(kept);
          // fall distance per final cell
          const fcol = [];
          for (let r = 0; r < ROWS; r++) {
            if (r < missing) fcol.push(missing); // new symbols drop in from above
            else {
              const keptIdx = r - missing; // index in kept array
              // find original row of that kept symbol
              let seen = -1, orig = 0;
              for (let rr = 0; rr < ROWS; rr++) { if (!remove.has(grid[c][rr].s)) { seen++; if (seen === keptIdx) { orig = rr; break; } } }
              fcol.push(r - orig);
            }
          }
          next.push(col); falls.push(fcol);
        }
        grid = next;
        steps[steps.length - 1].nextFalls = falls;
      }
      const final = grid;
      const scat = findCellsObj(final, SCAT);
      const bombs = findCellsObj(final, BOMB);
      const bombSum = sum(bombs, ([c, r]) => final[c][r].v);
      let mult = 1;
      if (isFs && seqWin > 0 && bombSum > 0) mult = bombSum;
      const scatterWin = scatterPays[Math.min(scat.length, 6)] && scat.length >= 4 ? round2(scatterPays[Math.min(scat.length, 6)] * bet) : 0;
      return { steps, tumbleWin: seqWin, mult, bombs, bombSum, scatCells: scat, scatters: scat.length, scatterWin, win: round2(seqWin * mult + scatterWin) };
    }
    function findCellsObj(grid, sym) {
      const cells = [];
      grid.forEach((col, c) => col.forEach((x, r) => { if (x.s === sym) cells.push([c, r]); }));
      return cells;
    }
    function cloneGrid(g) { return g.map(col => col.map(x => Object.assign({}, x))); }

    return {
      id: 'sugar', name: 'Sugar Storm', cols: COLS, rows: ROWS, type: 'tumble',
      tagline: 'Gewinne überall, Kaskaden & Bomben bis 100x',
      symbols: {
        heart: { e: '🍬', label: 'Bonbon' }, cupcake: { e: '🧁', label: 'Cupcake' }, donut: { e: '🍩', label: 'Donut' },
        choco: { e: '🍫', label: 'Schoko' }, melon: { e: '🍉', label: 'Melone' }, grape: { e: '🍇', label: 'Trauben' },
        apple: { e: '🍏', label: 'Apfel' }, peach: { e: '🍑', label: 'Pfirsich' }, banana: { e: '🍌', label: 'Banane' },
        lolly: { e: '🍭', label: 'Lolli', tag: 'SCATTER' }, bomb: { e: '💣', label: 'Multiplikator' }
      },
      pays, scatterPays,
      info: [
        'Gewinne überall: 8 oder mehr gleiche Symbole irgendwo auf dem 6x5-Feld zahlen.',
        'Gewinnsymbole platzen, neue fallen nach (Kaskade), solange es weitere Gewinne gibt.',
        '4 oder mehr Lollis 🍭 = 10 Freispiele (3+ in den Freispielen: +5).',
        'In den Freispielen fallen Bomben 💣 mit 2x bis 100x. Am Ende einer Kaskade werden alle Bombenwerte addiert und mit dem Gewinn multipliziert.'
      ],
      baseSpin(bet) {
        const seq = sequence(bet, baseT, false);
        seq.feature = seq.scatters >= 4 ? { type: 'fs', spins: 10 } : null;
        return seq;
      },
      featureSpin(bet) {
        const seq = sequence(bet, fsT, true);
        seq.retrigger = seq.scatters >= 3 ? 5 : 0;
        return seq;
      }
    };
  })();

  // =====================================================================
  // 4) MOON WOLF – 20 lines, Hold & Spin with moon coins & jackpots
  // =====================================================================
  const wolf = (function () {
    const WILD = 'wolf', MOON = 'moon';
    const pays = {
      wolf: { 3: 50, 4: 200, 5: 1000 },
      bison: { 3: 25, 4: 100, 5: 500 }, eagle: { 3: 20, 4: 80, 5: 300 }, horse: { 3: 15, 4: 60, 5: 200 }, deer: { 3: 10, 4: 40, 5: 150 },
      A: { 3: 5, 4: 20, 5: 100 }, K: { 3: 5, 4: 20, 5: 80 }, Q: { 3: 5, 4: 15, 5: 60 }, J: { 3: 4, 4: 10, 5: 50 }, T: { 3: 4, 4: 10, 5: 50 }
    };
    Object.keys(pays).forEach(k => { Object.keys(pays[k]).forEach(n => { pays[k][n] *= 4; }); });
    const outer = { bison: 4, eagle: 5, horse: 6, deer: 7, A: 10, K: 10, Q: 11, J: 12, T: 12, moon: 10.5 };
    const inner = Object.assign({}, outer, { wolf: 3 });
    const reels = [table(outer), table(inner), table(inner), table(inner), table(outer)];
    const JACK = { MINI: 20, MAJOR: 100, GRAND: 1000 };
    const moonVals = table({ 1: 30, 2: 24, 3: 16, 4: 10, 5: 8, 8: 5, 10: 4, 15: 2, 25: 1, MINI: 0.8, MAJOR: 0.12 });
    const lines = LINES20;
    const respinP = 0.087; // chance per empty cell per respin

    function moonValue() { const v = pick(moonVals); return isNaN(Number(v)) ? v : Number(v); }
    function valueOf(v) { return typeof v === 'number' ? v : JACK[v]; }

    return {
      id: 'wolf', name: 'Moon Wolf', cols: 5, rows: 3, type: 'lines', lineCount: 20,
      tagline: 'Hold & Spin mit Mond-Jackpots',
      symbols: {
        wolf: { e: '🐺', label: 'Wolf', tag: 'WILD' }, moon: { e: '🌕', label: 'Mond' },
        bison: { e: '🦬', label: 'Bison' }, eagle: { e: '🦅', label: 'Adler' }, horse: { e: '🐎', label: 'Mustang' }, deer: { e: '🦌', label: 'Hirsch' },
        A: { t: 'A' }, K: { t: 'K' }, Q: { t: 'Q' }, J: { t: 'J' }, T: { t: '10' }
      },
      pays, lines, wild: WILD, JACK,
      info: [
        'Der Wolf 🐺 ist Wild auf den Walzen 2, 3 und 4.',
        '6 oder mehr Monde 🌕 starten Hold & Spin: Monde bleiben stehen, du hast 3 Respins.',
        'Jeder neue Mond setzt die Respins wieder auf 3.',
        'Am Ende werden alle Mondwerte ausgezahlt. Jackpots: MINI 20x, MAJOR 100x, alle 15 Felder = GRAND 1000x.'
      ],
      valueOf,
      baseSpin(bet) {
        const grid = spinGrid(reels, 3, null);
        const vals = grid.map(col => col.map(s => (s === MOON ? moonValue() : 0)));
        const wins = evalLines(grid, lines, pays, WILD, bet / 20);
        const moons = findCells(grid, MOON);
        const feature = moons.length >= 6 ? { type: 'hold', moons: moons.map(([c, r]) => ({ c, r, v: vals[c][r] })) } : null;
        return { grid, vals, wins, win: round2(sum(wins, x => x.amount)), feature };
      },
      // one respin of hold & spin. state: {locked: {key: v}, respins}
      holdSpin(state) {
        const added = [];
        for (let c = 0; c < 5; c++) for (let r = 0; r < 3; r++) {
          const k = c + ',' + r;
          if (state.locked[k] === undefined && rnd() < respinP) { const v = moonValue(); state.locked[k] = v; added.push({ c, r, v }); }
        }
        state.respins = added.length ? 3 : state.respins - 1;
        return added;
      },
      holdTotal(state, bet) {
        const keys = Object.keys(state.locked);
        let tot = sum(keys, k => valueOf(state.locked[k]));
        const grand = keys.length === 15;
        if (grand) tot += JACK.GRAND;
        return { amount: round2(tot * bet), grand };
      }
    };
  })();

  // =====================================================================
  // 5) INFERNO 7 – classic 5 line fruit slot + star scatter
  // =====================================================================
  const inferno = (function () {
    const STAR = 'star';
    const pays = {
      seven: { 3: 100, 4: 1000, 5: 5000 },
      melon: { 3: 50, 4: 125, 5: 500 }, grape: { 3: 50, 4: 125, 5: 500 },
      plum: { 3: 16, 4: 50, 5: 200 }, orange: { 3: 16, 4: 50, 5: 200 }, lemon: { 3: 16, 4: 50, 5: 200 },
      cherry: { 2: 4, 3: 20, 4: 50, 5: 200 }
    };
    const scatterPays = { 3: 2, 4: 10, 5: 50 };
    const w = { seven: 2.0, melon: 5, grape: 5, plum: 11, orange: 11, lemon: 11, cherry: 8.5, star: 2.4 };
    const reels = [0, 1, 2, 3, 4].map(() => table(w));
    const lines = LINES20.slice(0, 5);
    return {
      id: 'inferno', name: 'Inferno 7', cols: 5, rows: 3, type: 'lines', lineCount: 5,
      tagline: 'Klassische Früchte, heiße Siebenen',
      symbols: {
        seven: { e: '7️⃣', label: 'Sieben' }, melon: { e: '🍉', label: 'Melone' }, grape: { e: '🍇', label: 'Trauben' },
        plum: { e: '🫐', label: 'Pflaume' }, orange: { e: '🍊', label: 'Orange' }, lemon: { e: '🍋', label: 'Zitrone' },
        cherry: { e: '🍒', label: 'Kirsche' }, star: { e: '⭐', label: 'Stern', tag: 'SCATTER' }
      },
      pays, scatterPays, lines, scatter: STAR,
      info: [
        '5 feste Gewinnlinien, Gewinne von links nach rechts.',
        'Kirschen 🍒 zahlen schon ab 2 Stück.',
        'Sterne ⭐ zahlen überall ab 3 Stück (x Gesamteinsatz).',
        'Nach jedem Gewinn kannst du per Risiko-Spiel verdoppeln.'
      ],
      baseSpin(bet) {
        const grid = spinGrid(reels, 3, [STAR]);
        const wins = evalLines(grid, lines, pays, null, bet / 5);
        const sc = findCells(grid, STAR);
        if (scatterPays[sc.length]) wins.push({ kind: 'scatter', sym: STAR, count: sc.length, cells: sc, amount: round2(scatterPays[sc.length] * bet) });
        return { grid, wins, win: round2(sum(wins, x => x.amount)), feature: null };
      }
    };
  })();

  // ---------- full round (used by the simulator) ----------
  function playRound(game, bet) {
    const b = game.baseSpin(bet);
    let total = b.win;
    let featureWin = 0;
    if (b.feature && b.feature.type === 'fs') {
      const fs = Object.assign({}, b.feature);
      let left = fs.spins, guard = 0;
      while (left > 0 && guard++ < 500) {
        left--;
        const r = game.featureSpin(bet, fs);
        featureWin += r.win;
        left += r.retrigger || 0;
      }
    } else if (b.feature && b.feature.type === 'hold') {
      const st = { locked: {}, respins: 3 };
      b.feature.moons.forEach(m => { st.locked[m.c + ',' + m.r] = m.v; });
      while (st.respins > 0 && Object.keys(st.locked).length < 15) game.holdSpin(st);
      featureWin += game.holdTotal(st, bet).amount;
    }
    total += featureWin;
    return { total: round2(total), base: b.win, feature: !!b.feature, featureWin };
  }

  const Engine = { games: [codex, angler, sugar, wolf, inferno], playRound, rnd, round2 };
  if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
  else root.Engine = Engine;
})(typeof window !== 'undefined' ? window : globalThis);
