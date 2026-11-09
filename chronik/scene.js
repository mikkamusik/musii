// MIKKANER — EINE CHRONIK
// Deterministischer Canvas-Renderer: render(frame) zeichnet genau ein Bild.
// Alle Daten (Takte, Spuren, Clips, Violinen-Motiv, 130 BPM, -1.5 dB) stammen aus mikkaner.als.

const W = 1920, H = 1080, FPS = 30;
const PAPER = '#d8cbb0';
const INK = '#1e150d';
const RED = '#b3261e';
const GOLD = '#e2b25a';
const BRAND = '#3c7d8c'; // Markenfarbe: nur als feine Linie im Schlussbild (hier anpassen)

const INTRO = 5.0, SHOT = 2.5, OUTRO = 6.0;

// ---------------------------------------------------------------- Hilfen
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeOutExpo = t => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
const easeInOut = t => t * t * (3 - 2 * t);
const D = Math.PI / 180;
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

// ---------------------------------------------------------------- Zeichen-Baukasten (Tusche)
class Sketch {
  constructor(seed) { this.strokes = []; this.labels = []; this.r = rng(seed); }
  poly(kind, pts, closed = false) {
    if (pts.length < 2) return;
    this.strokes.push({ kind, pts: closed ? [...pts, pts[0]] : pts.slice() });
  }
  line(kind, x1, y1, x2, y2) { this.poly(kind, [[x1, y1], [x2, y2]]); }
  arcPts(cx, cy, r, a0 = 0, a1 = 2 * Math.PI, ry = r) {
    const n = Math.max(16, Math.ceil(Math.abs(a1 - a0) * Math.max(r, ry) / 6));
    const p = [];
    for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; p.push([cx + r * Math.cos(a), cy + ry * Math.sin(a)]); }
    return p;
  }
  circle(kind, cx, cy, r, a0 = 0, a1 = 2 * Math.PI, ry = r) { this.poly(kind, this.arcPts(cx, cy, r, a0, a1, ry)); }
  rect(kind, x, y, w, h) { this.poly(kind, [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], true); }
  arrow(kind, x1, y1, x2, y2, head = 20) {
    this.line(kind, x1, y1, x2, y2);
    const a = Math.atan2(y2 - y1, x2 - x1);
    this.poly(kind, [[x2 - head * Math.cos(a - 0.4), y2 - head * Math.sin(a - 0.4)], [x2, y2], [x2 - head * Math.cos(a + 0.4), y2 - head * Math.sin(a + 0.4)]]);
  }
  // Schraffur: parallele Linien im Polygon, optional auf Halbebene n·p > d beschnitten
  hatch(kind, poly, angleDeg, spacing, half = null) {
    const a = angleDeg * D, ca = Math.cos(a), sa = Math.sin(a);
    const rot = poly.map(([x, y]) => [x * ca + y * sa, -x * sa + y * ca]);
    let ymin = Infinity, ymax = -Infinity;
    rot.forEach(p => { ymin = Math.min(ymin, p[1]); ymax = Math.max(ymax, p[1]); });
    const segs = [];
    let flip = false;
    for (let y = Math.ceil(ymin / spacing) * spacing; y <= ymax; y += spacing) {
      const xs = [];
      for (let i = 0; i < rot.length; i++) {
        const p = rot[i], q = rot[(i + 1) % rot.length];
        if ((p[1] <= y && q[1] > y) || (q[1] <= y && p[1] > y)) xs.push(p[0] + (y - p[1]) / (q[1] - p[1]) * (q[0] - p[0]));
      }
      xs.sort((u, v) => u - v);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        let A = [xs[i] * ca - y * sa, xs[i] * sa + y * ca], B = [xs[i + 1] * ca - y * sa, xs[i + 1] * sa + y * ca];
        if (half) {
          const [nx, ny, d] = half;
          const fa = A[0] * nx + A[1] * ny - d, fb = B[0] * nx + B[1] * ny - d;
          if (fa < 0 && fb < 0) continue;
          if (fa < 0 || fb < 0) {
            const t = fa / (fa - fb), C = [lerp(A[0], B[0], t), lerp(A[1], B[1], t)];
            if (fa < 0) A = C; else B = C;
          }
        }
        // leichte Unregelmäßigkeit wie von Hand gestochen
        const j = (this.r() - 0.5) * spacing * 0.25;
        A = [A[0] + j * ca, A[1] + j * sa];
        segs.push(flip ? [B, A] : [A, B]);
      }
      flip = !flip;
    }
    segs.forEach(s => this.poly(kind, s));
  }
  label(text, x, y, size = 17, align = 'center', color = INK, font = 'cinzel') { this.labels.push({ text, x, y, size, align, color, font }); }
}

// Catmull-Rom durch Stützpunkte
function spline(pts, seg = 10) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let k = 0; k < seg; k++) {
      const t = k / seg, t2 = t * t, t3 = t2 * t;
      out.push([0, 1].map(c => 0.5 * (2 * p1[c] + (-p0[c] + p2[c]) * t + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t2 + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * t3)));
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}
function bez(p0, p1, p2, p3, n = 30) {
  const o = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    o.push([0, 1].map(c => u * u * u * p0[c] + 3 * u * u * t * p1[c] + 3 * u * t * t * p2[c] + t * t * t * p3[c]));
  }
  return o;
}
function annulus(cx, cy, r1, r2, a0, a1, s) {
  return [...s.arcPts(cx, cy, r2, a0, a1), ...s.arcPts(cx, cy, r1, a1, a0)];
}

// ---------------------------------------------------------------- Motive
// Lokale Koordinaten: etwa x ±420, y ±280; Mittelpunkt im Bild bei (1010, 690)

function motifKick(s) {
  const cx = -130;
  s.line('guide', -430, 0, 420, 0); s.line('guide', cx, -285, cx, 285);
  s.circle('guide', cx, 0, 276); s.circle('guide', cx, 0, 175);
  s.line('guide', cx, -250, 420, -250); s.line('guide', cx, 250, 420, 250);
  [-60, 30, 150, 240].forEach(a => s.circle('guide', cx, 0, 290, (a - 4) * D, (a + 4) * D));
  s.circle('ink', cx, 0, 250); s.circle('ink', cx, 0, 236); s.circle('fine', cx, 0, 228);
  for (let i = 0; i < 10; i++) {
    const a = (i * 36 + 18) * D;
    s.line('ink', cx + 250 * Math.cos(a), 250 * Math.sin(a), cx + 270 * Math.cos(a), 270 * Math.sin(a));
    s.circle('fine', cx + 274 * Math.cos(a), 274 * Math.sin(a), 5);
  }
  s.circle('fine', cx, 0, 92); s.circle('fine', cx, 0, 84);
  // Seitenansicht
  const x0 = 235, x1 = 395;
  s.rect('ink', x0, -250, x1 - x0, 500);
  s.line('ink', x0 + 14, -250, x0 + 14, 250); s.line('ink', x1 - 14, -250, x1 - 14, 250);
  for (let i = 0; i < 5; i++) { const y = -200 + i * 100; s.line('fine', x0 + 14, y, x1 - 14, y); s.circle('fine', x0 + 22, y, 4); s.circle('fine', x1 - 22, y, 4); }
  // Schraffur
  s.hatch('hatch', annulus(cx, 0, 236, 250, 15 * D, 165 * D, s), 45, 4.5);
  s.hatch('hatch', s.arcPts(cx, 0, 228), 135, 9, [0.7071, 0.7071, cx * 0.7071 + 95]);
  s.hatch('hatch', [[x0 + 14, -250], [x1 - 14, -250], [x1 - 14, 250], [x0 + 14, 250]], 90, 7, [1, 0, 330]);
  s.hatch('hatch', [[x0 + 14, 40], [x1 - 14, 40], [x1 - 14, 250], [x0 + 14, 250]], 20, 9);
  // Rot
  s.arrow('red', -410, -250, cx - 40, -40, 24);
  [34, 54, 74].forEach(r => s.circle('red', cx, 0, r, -50 * D, 50 * D));
  s.label('FIG. I  —  DIE TROMMEL · TAKT 1', 0, 300);
}

function motifClap(s) {
  const bx = -230, by = -30;
  [60, 120, 185].forEach(r => s.circle('guide', bx, by, r));
  s.line('guide', bx - 210, by, bx + 210, by); s.line('guide', bx, by - 210, bx, by + 210);
  s.circle('ink', bx, by, 18);
  for (let i = 0; i < 24; i++) {
    const a = i * 15 * D, L = i % 2 ? 105 : 170, k = i % 6 === 0 ? 'red' : 'ink';
    s.line(k, bx + 30 * Math.cos(a), by + 30 * Math.sin(a), bx + L * Math.cos(a), by + L * Math.sin(a));
  }
  [205, 228].forEach(r => { s.circle('fine', bx, by, r, -35 * D, 35 * D); s.circle('fine', bx, by, r, 145 * D, 215 * D); });
  // Hüllkurven über einem 16er-Raster
  const gx = 0, step = 26, base = 100;
  s.line('guide', gx - 10, base, gx + 16 * step + 10, base);
  for (let b = 0; b <= 4; b++) s.line('guide', gx + b * 4 * step, -230, gx + b * 4 * step, 200);
  for (const hit of [4, 12]) {
    const x = gx + hit * step + 2;
    const env = [];
    for (let i = 0; i <= 40; i++) { const u = i / 40; env.push([x + u * 90, base - 300 * Math.exp(-u * 4.2)]); }
    s.poly('ink', [[x, base], ...env]);
    s.hatch('hatch', [[x, base], ...env, [x + 90, base]], 70, 5);
    const w = [];
    for (let i = 0; i <= 90; i++) { const u = i / 90; w.push([x + u * 90, base - 300 * Math.exp(-u * 4.2) * (0.5 + 0.5 * Math.cos(u * 40))]); }
    s.poly('fine', w);
    s.line('guide', x, base, x, 150);
  }
  for (let i = 0; i < 16; i++) s.rect('fine', gx + i * step + 2, 150, step - 6, step - 6);
  for (const hit of [4, 12]) {
    const sq = [[gx + hit * step + 2, 150], [gx + hit * step + step - 4, 150], [gx + hit * step + step - 4, 150 + step - 6], [gx + hit * step + 2, 150 + step - 6]];
    s.hatch('hatch', sq, 45, 3); s.hatch('hatch', sq, -45, 3);
    s.poly('red', sq, true);
  }
  s.arrow('red', gx + 4 * step + 50, -260, gx + 4 * step + 8, -215, 18);
  ['1', '2', '3', '4'].forEach((t, i) => s.label(t, gx + i * 4 * step + 10, 202, 15));
  s.label('FIG. II  —  NUR AUF ZWEI UND VIER', 0, 300);
}

function motifBass(s) {
  const cx = -300, R = 150, x0 = -100, P = 520;
  s.line('guide', -470, 0, 440, 0); s.line('guide', cx, -190, cx, 190);
  for (let i = 0; i < 12; i++) { const a = i * 30 * D; s.line('guide', cx + (R - 8) * Math.cos(a), (R - 8) * Math.sin(a), cx + (R + 10) * Math.cos(a), (R + 10) * Math.sin(a)); }
  for (let q = 0; q <= 4; q++) s.line('guide', x0 + q * P / 4, -190, x0 + q * P / 4, 190);
  s.line('guide', x0 - 30, -R, 440, -R); s.line('guide', x0 - 30, R, 440, R);
  s.circle('ink', cx, 0, R);
  const ph = 60 * D, px = cx + R * Math.cos(-ph), py = R * Math.sin(-ph);
  s.line('fine', cx, 0, px, py);
  const wave = [];
  for (let i = 0; i <= 120; i++) { const x = x0 + P * i / 120; wave.push([x, -R * Math.sin(2 * Math.PI * i / 120)]); }
  s.poly('ink', wave);
  const wx = x0 + P * (60 / 360);
  s.line('guide', px, py, wx, py);
  s.hatch('hatch', wave.slice(0, 61), 60, 7);
  s.hatch('hatch', wave.slice(60), -60, 12);
  s.circle('red', cx, 0, 40, -ph, 0);
  s.circle('red', px, py, 7); s.circle('red', wx, py, 7);
  s.arrow('red', x0 + P * 0.62, R + 40, x0 + P * 0.98, R + 40, 18);
  s.label('FIG. III  —  DER GRUNDTON · TAKT 9', 0, 300);
}

function motifHarmony(s) {
  const cx = -60;
  s.circle('guide', cx, 0, 278); s.circle('guide', cx, 0, 120);
  s.line('guide', cx - 300, 0, cx + 300, 0); s.line('guide', cx, -290, cx, 290);
  for (let t = 0; t < 2; t++) {
    const tri = [0, 1, 2].map(i => { const a = (-90 + t * 60 + i * 120) * D; return [cx + 200 * Math.cos(a), 200 * Math.sin(a)]; });
    s.poly('guide', tri, true);
  }
  s.circle('ink', cx, 0, 260); s.circle('fine', cx, 0, 200);
  const names = ['C', 'G', 'D', 'A', 'E', 'H', 'FIS', 'CIS', 'GIS', 'ES', 'B', 'F'];
  const pos = i => (-90 + i * 30) * D;
  for (let i = 0; i < 12; i++) {
    const b = pos(i) + 15 * D;
    s.line('fine', cx + 200 * Math.cos(b), 200 * Math.sin(b), cx + 260 * Math.cos(b), 260 * Math.sin(b));
    if (i % 2 === 0) s.hatch('hatch', annulus(cx, 0, 200, 260, pos(i) - 15 * D, pos(i) + 15 * D, s), 30 + i * 15, 6);
  }
  for (let i = 0; i < 12; i++) {
    const a = pos(i);
    s.circle('ink', cx + 230 * Math.cos(a), 230 * Math.sin(a), 15);
    s.label(names[i], cx + 165 * Math.cos(a), 165 * Math.sin(a) + 6, 17, 'center', [0, 1, 9].includes(i) ? RED : INK);
  }
  const tri = [0, 1, 9].map(i => [cx + 230 * Math.cos(pos(i)), 230 * Math.sin(pos(i))]);
  s.poly('red', tri, true);
  // Akkord rechts
  const sx = 280;
  for (let l = 0; l < 5; l++) s.line('fine', sx, -40 + l * 20, sx + 130, -40 + l * 20);
  [[0, 10], [1, -10], [2, -30]].forEach(([k, y]) => {
    const head = s.arcPts(sx + 65, y + 30, 11, 0, 2 * Math.PI, 8);
    s.poly('ink', head); s.hatch('hatch', head, 70, 2.5);
  });
  s.line('ink', sx + 76, -30 + 30, sx + 76, -60);
  s.arrow('red', 210, 120, sx + 40, 40, 16);
  s.label('FIG. IV  —  C-MOLL · TAKT 9', 0, 300);
}

function motifViolin(s) {
  const xf = ([x, y]) => {
    const a = -90 * D - 10 * D, X = x * Math.cos(a) - y * Math.sin(a), Y = x * Math.sin(a) + y * Math.cos(a);
    return [X * 1.12 + 30, Y * 1.12 + 10];
  };
  const P = (kind, pts, closed) => s.poly(kind, pts.map(xf), closed);
  const L = (kind, a, b, c, d) => P(kind, [[a, b], [c, d]]);
  const C = (kind, cx, cy, r, a0 = 0, a1 = 2 * Math.PI, ry = r) => P(kind, s.arcPts(cx, cy, r, a0, a1, ry));
  // Hilfskonstruktion
  L('guide', 0, -470, 0, 270);
  [-170, -40, 40, 236].forEach(y => L('guide', -150, y, 150, y));
  C('guide', 0, -105, 112); C('guide', 0, 135, 132); C('guide', 132, 0, 64); C('guide', -132, 0, 64);
  // Korpus
  const half = spline([[0, -170], [50, -166], [88, -150], [108, -120], [112, -88], [100, -58], [76, -40], [67, -18], [66, 10], [72, 40], [100, 58], [124, 90], [132, 130], [124, 180], [96, 214], [50, 232], [0, 236]], 8);
  const body = [...half, ...half.slice(0, -1).reverse().map(([x, y]) => [-x, y]).slice(0, -1)];
  P('ink', body, true);
  P('fine', body.map(([x, y]) => [x * 0.94, y * 0.95 + 2]), true);
  // Hals, Griffbrett, Schnecke
  P('ink', [[-12, -400], [12, -400], [16, -170], [-16, -170]], true);
  P('fine', [[-13, -400], [13, -400], [21, 40], [-21, 40]], true);
  P('ink', [[-14, -400], [-16, -445], [16, -445], [14, -400]], false);
  const sp = []; for (let i = 0; i <= 80; i++) { const t = i / 80, a = t * 3.4 * Math.PI, r = 28 * (1 - t * 0.78); sp.push([r * Math.cos(a), -470 + r * Math.sin(a)]); }
  P('ink', sp);
  [-412, -432].forEach(y => { L('fine', -34, y, -14, y); L('fine', 14, y, 34, y); });
  // F-Löcher
  [-1, 1].forEach(sg => {
    P('ink', bez([sg * 34, -42], [sg * 60, -10], [sg * 28, 30], [sg * 52, 62], 24));
    C('fine', sg * 34, -46, 5); C('fine', sg * 52, 66, 5);
  });
  P('fine', bez([-32, 58], [-10, 50], [10, 50], [32, 58], 12));
  for (let k = 0; k < 4; k++) L('fine', -6 + k * 4, -400, -18 + k * 12, 205);
  const tail = [[-22, 110], [22, 110], [14, 215], [-14, 215]];
  P('ink', tail, true);
  // Schraffur (Schattenseite)
  s.hatch('hatch', body.map(xf), 12, 7, (() => { const n = xf([1, 0]), o = xf([0, 0]); const nx = n[0] - o[0], ny = n[1] - o[1], d = Math.hypot(nx, ny); return [nx / d, ny / d, (o[0] * nx + o[1] * ny) / d + 30]; })());
  s.hatch('hatch', tail.map(xf), 80, 3.5);
  s.hatch('hatch', [[-12, -400], [12, -400], [16, -170], [-16, -170]].map(xf), 0, 4);
  // Bogen (rot)
  P('red', [[-250, 95], [250, 72]]);
  P('redfine', [[-238, 108], [238, 86]]);
  P('red', [[-250, 95], [-238, 108]]); P('red', [[250, 72], [238, 86]]);
  const a0 = xf([140, 150]), a1 = xf([230, 146]);
  s.arrow('red', a0[0], a0[1], a1[0], a1[1], 18);
  s.label('FIG. V  —  DIE VIOLINE · TAKT 49', 0, 300);
}

function motifRefrain(s) {
  const top = 20;
  for (let l = 0; l < 5; l++) s.line('fine', -410, top + l * 22, 410, top + l * 22);
  const mid = top + 44;
  [-1, 1].forEach(sg => {
    const xt = sg * 340, w = 11;
    const bar = sg < 0 ? [[xt - w, top], [xt, top], [xt, top + 88], [xt - w, top + 88]] : [[xt, top], [xt + w, top], [xt + w, top + 88], [xt, top + 88]];
    s.poly('ink', bar, true); s.hatch('hatch', bar, 90, 2.2);
    s.line('ink', xt - sg * 18, top, xt - sg * 18, top + 88);
    [mid - 11, mid + 11].forEach(y => { const d = s.arcPts(xt - sg * 32, y, 4.5); s.poly('ink', d); s.hatch('hatch', d, 0, 1.5); });
  });
  const ys = [11, -11, 0, -22, -11, 11, 22];
  ys.forEach((dy, i) => {
    const x = -250 + i * 80, y = mid + dy;
    const head = s.arcPts(x, y, 12, 0, 2 * Math.PI, 8.5).map(([px, py]) => { const a = -20 * D, dx = px - x, dyy = py - y; return [x + dx * Math.cos(a) - dyy * Math.sin(a), y + dx * Math.sin(a) + dyy * Math.cos(a)]; });
    s.poly('ink', head, true); s.hatch('hatch', head, 60, 2.2);
    s.line('ink', x + 11, y - 3, x + 11, y - 66);
  });
  // Bogen der Wiederholung
  s.line('guide', -420, -20, 420, -20); s.line('guide', 0, -280, 0, -10);
  s.circle('guide', 0, -20, 345, Math.PI, 2 * Math.PI, 210);
  s.circle('red', 0, -20, 330, -5 * D, -175 * D, 200);
  const e = [-330 * Math.cos(-175 * D) * -1, -20 + 200 * Math.sin(-175 * D)];
  s.arrow('red', -320, -45, -328, -2, 22);
  // Ruhige Wellen unterhalb (leise)
  const w = []; for (let i = 0; i <= 160; i++) { const x = -400 + i * 5; w.push([x, 200 + 8 * Math.sin(i * 0.25) * Math.sin(i * 0.02 * Math.PI)]); }
  s.poly('fine', w);
  s.hatch('hatch', [...w, [400, 230], [-400, 230]], 0, 6);
  s.label('PP', -380, 170, 22, 'left');
  s.label('FIG. VI  —  LEISE, IMMER WIEDER · TAKT 56', 0, 300);
}

function motifBreak(s) {
  const lineY = i => 48 - i * 24; // E4 G4 B4 D5 F5
  for (let i = 0; i < 5; i++) s.line('fine', -420, lineY(i), 420, lineY(i));
  // Violinschlüssel (vereinfacht)
  const cl = [];
  for (let i = 0; i <= 90; i++) { const t = i / 90, a = -Math.PI / 2 + t * 2.6 * Math.PI, r = 22 * (1 - t * 0.7); cl.push([-388 + r * Math.cos(a), 24 + 4 + r * Math.sin(a)]); }
  s.poly('ink', cl);
  s.poly('ink', spline([[-388, 6], [-380, -40], [-372, -78], [-388, -96], [-398, -70], [-388, 30], [-384, 80], [-398, 88], [-404, 76]], 8));
  // Vorzeichen: B, Es, As
  const flat = (x, y) => { s.line('ink', x, y - 26, x, y + 6); s.poly('ink', bez([x, y + 6], [x + 14, y - 2], [x + 12, y - 12], [x, y - 4], 10)); };
  flat(-350, 0); flat(-334, -36); flat(-318, 12);
  // Motiv aus der MIDI-Spur
  const notes = [[0, 72], [6, 75], [12, 70], [18, 68], [24, 72], [30, 75], [36, 70], [42, 68], [48, 68]];
  const yOf = { 72: -12, 75: -36, 70: 0, 68: 12 };
  const xOf = t => -268 + t * 12.6;
  for (let t = 0; t <= 48; t += 6) s.line('guide', xOf(t), -90, xOf(t), 90);
  [23, 47].forEach(t => s.line('ink', xOf(t) - 2, lineY(0), xOf(t) - 2, lineY(4)));
  s.line('ink', 418, lineY(0), 418, lineY(4)); s.line('ink', 410, lineY(0), 410, lineY(4));
  const heads = [];
  notes.forEach(([t, n], i) => {
    const x = xOf(t) + 8, y = yOf[n];
    const head = s.arcPts(x, y, 12, 0, 2 * Math.PI, 8.5).map(([px, py]) => { const a = -20 * D, dx = px - x, dy = py - y; return [x + dx * Math.cos(a) - dy * Math.sin(a), y + dx * Math.sin(a) + dy * Math.cos(a)]; });
    s.poly('ink', head, true);
    if (i < 8) { s.hatch('hatch', head, 60, 2.2); s.line('ink', x + 11, y - 3, x + 11, y - 64); }
    heads.push([x, y]);
  });
  s.poly('red', heads.slice(0, 8).map(([x, y]) => [x, y - 95]));
  s.arrow('red', heads[7][0], heads[7][1] - 95, heads[8][0] - 6, heads[8][1] - 60, 18);
  s.poly('red', [[heads[0][0] - 10, -170], [heads[0][0] - 10, -185], [heads[3][0] + 10, -185], [heads[3][0] + 10, -170]]);
  // Hüllkurve darunter
  const env = [];
  for (let i = 0; i <= 100; i++) { const x = -268 + i * 6.8; env.push([x, 200 - 70 * Math.pow(Math.sin(i / 100 * Math.PI), 0.7)]); }
  s.poly('fine', env); s.hatch('hatch', [...env, [-268, 200]], -30, 8);
  s.label('C', heads[0][0], 130, 16); s.label('ES', heads[1][0], 130, 16); s.label('B', heads[2][0], 130, 16); s.label('AS', heads[3][0], 130, 16);
  s.label('FIG. VII  —  DAS MOTIV DER VIOLINE · TAKT 57', 0, 300);
}

function motifRise(s) {
  const base = 210, X0 = -400, BW = 100;
  for (let b = 0; b <= 8; b++) s.line('guide', X0 + b * BW, -250, X0 + b * BW, base + 30);
  [-200, -100, 0, 100].forEach(y => s.line('guide', X0, y, X0 + 800, y));
  s.line('ink', X0 - 15, base, X0 + 815, base);
  const k = 3.2, curve = [];
  for (let i = 0; i <= 120; i++) { const u = i / 120; curve.push([X0 + 800 * u, base - 410 * (Math.exp(k * u) - 1) / (Math.exp(k) - 1)]); }
  s.poly('ink', curve);
  s.hatch('hatch', [...curve, [X0 + 800, base]], 45, 9);
  s.hatch('hatch', [...curve.slice(80), [X0 + 800, base], [curve[80][0], base]], -45, 9);
  const counts = [2, 2, 4, 4, 8, 8, 16, 16];
  counts.forEach((n, b) => { for (let i = 0; i < n; i++) { const x = X0 + b * BW + (i + 0.5) * BW / n; s.line('fine', x, base + 6, x, base + 24); } });
  s.arrow('red', X0 + 760, -150, X0 + 820, -268, 24);
  s.poly('red', [[X0 + 700, base + 40], [X0 + 700, base + 50], [X0 + 800, base + 50], [X0 + 800, base + 40]]);
  for (let b = 0; b < 8; b++) s.label(String(65 + b), X0 + b * BW + 50, base + 62, 15);
  s.label('FIG. VIII  —  DER AUFBAU · TAKT 65', 0, 300);
}

function motifDrop(s) {
  s.line('guide', -430, 0, 430, 0);
  const ramp = [], rampB = [];
  for (let i = 0; i <= 60; i++) { const u = i / 60, x = -420 + u * 330, a = 18 + 182 * u * u; ramp.push([x, -a]); rampB.push([x, a]); }
  s.poly('ink', ramp); s.poly('ink', rampB);
  s.line('ink', -90, -200, -90, 200);
  s.hatch('hatch', [...ramp, ...rampB.slice().reverse()], 30, 10);
  s.line('guide', -90, -260, -90, 260); s.line('guide', -30, -260, -30, 260);
  for (let p = 0; p < 4; p++) {
    const x0 = -30 + p * 112, top = [], bot = [];
    for (let i = 0; i <= 30; i++) { const u = i / 30, a = 60 + 180 * Math.exp(-u * 2.6); top.push([x0 + u * 108, -a]); bot.push([x0 + u * 108, a]); }
    const shape = [...top, ...bot.slice().reverse()];
    s.poly('ink', shape, true);
    s.hatch('hatch', shape, 60, 5); s.hatch('hatch', shape, -60, 5);
    s.line('guide', x0, -270, x0, 270);
  }
  s.arrow('red', -60, -285, -60, -40, 26);
  [-40, -10, 20].forEach(a => s.line('red', -30 + 12 * Math.cos(a * D), 12 * Math.sin(a * D) - 250, -30 + 40 * Math.cos(a * D), 40 * Math.sin(a * D) - 250));
  s.label('FIG. IX  —  DER ABSTURZ · TAKT 73', 0, 300);
}

function motifSilence(s) {
  const cy = -20, A = 120;
  s.line('guide', -430, cy, 430, cy); s.line('guide', -430, cy - A, 430, cy - A); s.line('guide', -430, cy + A, 430, cy + A);
  for (let i = 0; i <= 5; i++) s.line('guide', -400 + i * 160, -200, -400 + i * 160, 200);
  const saw = [];
  for (let i = 0; i < 5; i++) { const x = -400 + i * 160; saw.push([x, cy + A], [x + 160, cy - A]); if (i < 4) saw.push([x + 160, cy + A]); }
  s.poly('ink', saw);
  for (let i = 0; i < 5; i++) { const x = -400 + i * 160; s.hatch('hatch', [[x, cy + A], [x + 160, cy - A], [x + 160, cy + A]], 75, 9); }
  s.line('red', -300, -230, 300, 190);
  s.line('red', -300, 190, 300, -230);
  s.line('redfine', -430, 235, 430, 235);
  s.label('SYNTH · STUMM GESCHALTET', 0, 225 - 0, 15);
  s.label('FIG. X  —  DIE PAUSE · TAKT 109', 0, 300);
}

const CLIPS = [
  [[0, 32], [32, 96], [96, 160], [160, 224], [284, 288], [288, 352], [352, 400], [416, 432], [432, 463], [476, 480], [480, 544], [544, 608]],
  [[0, 32], [32, 96], [96, 160], [160, 224], [256, 288], [288, 352], [352, 416], [416, 432], [464, 480], [480, 544], [544, 608], [608, 624]],
  [[32, 96], [96, 160], [160, 224], [224, 256], [288, 352], [352, 416], [416, 432], [480, 544], [544, 608]],
  [[32, 96], [96, 160], [160, 224], [224, 256], [256, 288], [288, 352], [352, 416], [432, 464], [464, 480], [480, 544], [544, 608]],
  [[220, 544]],
  [[192, 224], [224, 256], [256, 288], [288, 316], [316, 336], [336, 356], [416, 448], [448, 464], [544, 576], [576, 608], [608, 636], [636, 656]],
  [[32, 96], [96, 160], [160, 224], [224, 256], [256, 288], [288, 352], [352, 416], [480, 544], [544, 608], [608, 624]],
  [[32, 96], [96, 160], [160, 224], [224, 256], [256, 288], [288, 352], [352, 416], [464, 480], [480, 544], [544, 608]],
  [[224, 288], [416, 480]],
];
function motifForm(s) {
  const X = b => -350 + b * (770 / 656), y0 = -235, rh = 50;
  [32, 96, 160, 224, 256, 288, 352, 416, 432, 464, 480, 544, 608].forEach(b => s.line('guide', X(b), -262, X(b), 225));
  s.line('guide', X(0), -262, X(656), -262);
  CLIPS.forEach((clips, r) => {
    const y = y0 + r * rh, muted = r === 7;
    clips.forEach(([a, b]) => {
      const box = [[X(a) + 1, y], [X(b) - 1, y], [X(b) - 1, y + 36], [X(a) + 1, y + 36]];
      s.poly(muted ? 'guide' : 'fine', box, true);
      if (!muted) s.hatch('hatch', box, r % 2 ? -50 : 50, 5 + (r % 3));
    });
    s.label(String(r + 1).padStart(2, '0'), -395, y + 25, 15, 'left', INK, 'mono');
  });
  s.line('red', X(0), y0 + 7 * rh + 18, X(624), y0 + 7 * rh + 18);
  [288, 480].forEach(b => {
    s.poly('red', [[X(b) - 9, -285], [X(b) + 9, -285], [X(b), -267]], true);
    s.line('redfine', X(b), -262, X(b), 225);
  });
  s.label('DROP', X(288) + 14, -270, 14, 'left', RED);
  s.label('FINALE', X(480) + 14, -270, 14, 'left', RED);
  s.label('FIG. XI  —  DIE FORM · 156 TAKTE · NEUN SPUREN', 0, 300);
}

function motifMaster(s) {
  const cx = 0, cy = 175;
  const frac = v => (Math.pow(10, v / 20) - 0.1) / (1.413 - 0.1);
  const ang = v => (-140 + frac(v) * 100) * D;
  s.poly('ink', [[-420, -235], [420, -235], [420, 255], [-420, 255]], true);
  s.poly('fine', [[-405, -220], [405, -220], [405, 240], [-405, 240]], true);
  s.circle('guide', cx, cy, 362, -145 * D, -35 * D);
  s.line('guide', -420, cy, 420, cy); s.line('guide', cx, -235, cx, 255);
  s.circle('ink', cx, cy, 330, ang(-20), ang(3)); s.circle('fine', cx, cy, 300, ang(-20), ang(3));
  const vals = [-20, -10, -7, -5, -3, -2, -1, 0, 1, 2, 3];
  vals.forEach(v => {
    const a = ang(v);
    s.line('guide', cx, cy, cx + 296 * Math.cos(a), cy + 296 * Math.sin(a));
    s.line(v > 0 ? 'red' : 'ink', cx + 300 * Math.cos(a), cy + 300 * Math.sin(a), cx + 346 * Math.cos(a), cy + 346 * Math.sin(a));
    s.label(String(Math.abs(v)), cx + 374 * Math.cos(a), cy + 374 * Math.sin(a) + 6, 17, 'center', v > 0 ? RED : INK);
  });
  for (let v = -20; v <= 3; v += 0.5) { const a = ang(v); s.line('fine', cx + 300 * Math.cos(a), cy + 300 * Math.sin(a), cx + 314 * Math.cos(a), cy + 314 * Math.sin(a)); }
  s.hatch('redhatch', annulus(cx, cy, 300, 330, ang(0), ang(3), s), 30, 4);
  const piv = s.arcPts(cx, cy, 24);
  s.poly('ink', piv); s.hatch('hatch', piv, 45, 3); s.hatch('hatch', piv, -45, 3);
  const a = ang(-1.5);
  s.line('red', cx, cy, cx + 340 * Math.cos(a), cy + 340 * Math.sin(a));
  s.label('VU', cx, cy - 110, 34);
  s.label('-1,5 DB', cx + 220 * Math.cos(a) - 16, cy + 220 * Math.sin(a) + 6, 18, 'right', RED);
  s.label('FIG. XII  —  DER MASTER · TAKT 156', 0, 300);
}

// ---------------------------------------------------------------- Drehbuch
const SHOTS = [
  { key: 'DER KICK.', ch: 'DER KICK', bar: 1, db: -18.0, m: motifKick },
  { key: 'DER CLAP.', ch: 'DER CLAP', bar: 1, db: -16.2, m: motifClap },
  { key: 'DER BASS.', ch: 'DER BASS', bar: 9, db: -12.5, m: motifBass },
  { key: 'DIE HARMONIE.', ch: 'DIE HARMONIE', bar: 9, db: -10.8, m: motifHarmony },
  { key: 'DIE VIOLINE.', ch: 'DIE VIOLINE', bar: 49, db: -9.6, m: motifViolin },
  { key: 'DER REFRAIN.', ch: 'DER REFRAIN', bar: 56, db: -11.4, m: motifRefrain },
  { key: 'DAS MOTIV.', ch: 'DAS MOTIV', bar: 57, db: -13.0, m: motifBreak },
  { key: 'DER AUFBAU.', ch: 'DER AUFBAU', bar: 65, db: -6.2, m: motifRise },
  { key: 'DER DROP.', ch: 'DER DROP', bar: 73, db: -3.1, m: motifDrop },
  { key: 'DIE STILLE.', ch: 'DIE STILLE', bar: 109, db: -20.5, m: motifSilence },
  { key: 'DIE FORM.', ch: 'DIE FORM', bar: 121, db: -4.0, m: motifForm },
  { key: 'DER SCHLIFF.', ch: 'DER SCHLIFF', bar: 156, db: -1.5, m: motifMaster },
];
const LEAD = 'UND DANN KAM';
const TOTAL = INTRO + SHOTS.length * SHOT + OUTRO;
const TOTAL_FRAMES = Math.round(TOTAL * FPS);

const ORDER = { guide: 0, ink: 1, fine: 2, hatch: 3, redhatch: 4, red: 5, redfine: 6 };
const WEIGHT = { guide: 0.5, ink: 1, fine: 0.9, hatch: 0.3, redhatch: 0.5, red: 1.6, redfine: 1.2 };
const STYLE = {
  guide: { c: INK, w: 0.8, a: 0.38 },
  ink: { c: INK, w: 2.1, a: 0.95 },
  fine: { c: INK, w: 1.25, a: 0.9 },
  hatch: { c: INK, w: 0.85, a: 0.72 },
  redhatch: { c: RED, w: 0.9, a: 0.85 },
  red: { c: RED, w: 3.0, a: 1 },
  redfine: { c: RED, w: 1.4, a: 1 },
};

function prepare(shot, i) {
  const s = new Sketch(1000 + i);
  shot.m(s);
  const r = rng(77 + i);
  const strokes = s.strokes
    .map((st, k) => ({ ...st, k }))
    .sort((a, b) => ORDER[a.kind] - ORDER[b.kind] || a.k - b.k)
    .map(st => {
      // gleichmäßig nachrastern und leicht zittern lassen (Feder auf Papier)
      const out = [];
      const ph = r() * 100, amp = st.kind === 'hatch' ? 0.35 : 0.7;
      let sAcc = 0;
      for (let j = 0; j < st.pts.length - 1; j++) {
        const [x1, y1] = st.pts[j], [x2, y2] = st.pts[j + 1];
        const L = Math.hypot(x2 - x1, y2 - y1), n = Math.max(1, Math.ceil(L / 7));
        const nx = -(y2 - y1) / (L || 1), ny = (x2 - x1) / (L || 1);
        for (let q = j === 0 ? 0 : 1; q <= n; q++) {
          const t = q / n, ss = sAcc + L * t, o = amp * Math.sin(ss * 0.045 + ph) + amp * 0.5 * Math.sin(ss * 0.13 + ph * 2);
          out.push([lerp(x1, x2, t) + nx * o, lerp(y1, y2, t) + ny * o]);
        }
        sAcc += L;
      }
      const cum = [0];
      for (let j = 1; j < out.length; j++) cum.push(cum[j - 1] + Math.hypot(out[j][0] - out[j - 1][0], out[j][1] - out[j - 1][1]));
      return { kind: st.kind, pts: out, cum, len: cum[cum.length - 1], w: STYLE[st.kind].w * (0.85 + r() * 0.3) };
    });
  let total = 0;
  strokes.forEach(st => { st.start = total; total += st.len * WEIGHT[st.kind]; });
  return { strokes, total, labels: s.labels };
}

// ---------------------------------------------------------------- Papier
let paperCanvas, grainCanvas, grainCtx, PREP;
function buildPaper() {
  paperCanvas = document.createElement('canvas');
  paperCanvas.width = W; paperCanvas.height = H;
  const g = paperCanvas.getContext('2d');
  g.fillStyle = PAPER; g.fillRect(0, 0, W, H);
  const r = rng(4242);
  // Wolkige Struktur im Papier (niedrigfrequentes Rauschen, sehr schwach)
  const lo = document.createElement('canvas'); lo.width = 64; lo.height = 36;
  const lg = lo.getContext('2d'), id = lg.createImageData(64, 36);
  for (let i = 0; i < 64 * 36; i++) { const v = 128 + (r() - 0.5) * 60; id.data.set([v, v * 0.95, v * 0.85, 255], i * 4); }
  lg.putImageData(id, 0, 0);
  g.globalCompositeOperation = 'multiply'; g.globalAlpha = 0.10; g.imageSmoothingEnabled = true;
  g.drawImage(lo, 0, 0, W, H);
  g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
  // Fasern
  for (let i = 0; i < 2600; i++) {
    const x = r() * W, y = r() * H, a = r() * Math.PI, l = 4 + r() * 18;
    g.strokeStyle = r() < 0.5 ? 'rgba(90,60,30,0.07)' : 'rgba(255,250,235,0.10)';
    g.lineWidth = 0.6; g.beginPath(); g.moveTo(x, y); g.lineTo(x + l * Math.cos(a), y + l * Math.sin(a)); g.stroke();
  }
  // Flecken mit Wasserrand
  for (let k = 0; k < 9; k++) {
    const cx = r() * W, cy = r() * H, R0 = 30 + r() * 110, ph = r() * 10, pts = [];
    for (let i = 0; i < 90; i++) { const a = i / 90 * 2 * Math.PI, rr = R0 * (1 + 0.18 * Math.sin(a * 3 + ph) + 0.09 * Math.sin(a * 7 + ph * 2) + 0.04 * Math.sin(a * 13)); pts.push([cx + rr * Math.cos(a), cy + rr * 0.8 * Math.sin(a)]); }
    g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(...p) : g.moveTo(...p))); g.closePath();
    g.fillStyle = `rgba(125,85,35,${0.02 + r() * 0.025})`; g.fill();
    g.strokeStyle = `rgba(105,65,25,${0.08 + r() * 0.08})`; g.lineWidth = 1.5 + r() * 2.5; g.stroke();
  }
  // Stockflecken
  for (let i = 0; i < 260; i++) {
    const x = r() * W, y = r() * H, rr = 0.6 + r() * r() * 4;
    g.fillStyle = `rgba(100,60,25,${0.08 + r() * 0.25})`; g.beginPath(); g.arc(x, y, rr, 0, 7); g.fill();
  }
  grainCanvas = document.createElement('canvas'); grainCanvas.width = 640; grainCanvas.height = 360;
  grainCtx = grainCanvas.getContext('2d');
}

function drawGrain(ctx, frame, strength) {
  const r = rng(90001 + frame * 7919);
  const id = grainCtx.createImageData(640, 360), d = id.data;
  for (let i = 0; i < d.length; i += 4) { const v = 128 + (r() + r() + r() - 1.5) * 120; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
  grainCtx.putImageData(id, 0, 0);
  ctx.save();
  ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = strength; ctx.imageSmoothingEnabled = true;
  const ox = Math.floor(r() * 3), oy = Math.floor(r() * 3);
  ctx.drawImage(grainCanvas, -ox, -oy, W + 6, H + 6);
  ctx.restore();
}

function drawVignette(ctx, k) {
  const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.38, W / 2, H / 2, H * 1.02);
  g.addColorStop(0, 'rgba(20,10,4,0)'); g.addColorStop(0.6, `rgba(20,10,4,${0.35 * k})`); g.addColorStop(1, `rgba(12,6,2,${0.85 * k})`);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
}

// ---------------------------------------------------------------- Zeichnung & Schrift
function drawSketch(ctx, prep, p) {
  const upto = p * prep.total;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const st of prep.strokes) {
    if (st.start >= upto) break;
    const avail = (upto - st.start) / WEIGHT[st.kind];
    const st_ = STYLE[st.kind];
    ctx.strokeStyle = st_.c; ctx.globalAlpha = st_.a; ctx.lineWidth = st.w;
    ctx.beginPath(); ctx.moveTo(st.pts[0][0], st.pts[0][1]);
    for (let j = 1; j < st.pts.length; j++) {
      if (st.cum[j] <= avail) ctx.lineTo(st.pts[j][0], st.pts[j][1]);
      else {
        const t = (avail - st.cum[j - 1]) / (st.cum[j] - st.cum[j - 1]);
        ctx.lineTo(lerp(st.pts[j - 1][0], st.pts[j][0], t), lerp(st.pts[j - 1][1], st.pts[j][1], t));
        break;
      }
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  // Beschriftungen erscheinen Buchstabe für Buchstabe am Ende des Aufbaus
  const lp = clamp((p - 0.55) / 0.4);
  if (lp > 0) {
    for (const l of prep.labels) {
      const n = Math.ceil(l.text.length * lp);
      ctx.font = l.font === 'mono' ? `500 ${l.size}px "Plex"` : `700 ${l.size}px "Cinzel"`;
      ctx.letterSpacing = l.font === 'mono' ? '3px' : '2px';
      ctx.fillStyle = l.color; ctx.textAlign = l.align; ctx.globalAlpha = 0.92;
      ctx.fillText(l.text.slice(0, n), l.x, l.y);
    }
    ctx.globalAlpha = 1; ctx.letterSpacing = '0px';
  }
}

// Wörter schießen einzeln ins Bild, mit kurzer Bewegungsunschärfe
function flyWords(ctx, words, x, y, size, color, t0, t, spacing, track) {
  ctx.font = `700 ${size}px "Cinzel"`; ctx.letterSpacing = track + 'px'; ctx.textAlign = 'left'; ctx.fillStyle = color;
  const space = ctx.measureText(' ').width + spacing;
  let cx = x;
  words.forEach((w, i) => {
    const ww = ctx.measureText(w).width;
    const lt = (t - t0 - i * 0.075) / 0.26;
    if (lt > 0) {
      const e = easeOutExpo(lt), off = (1 - e) * 520;
      const vel = lt < 1 ? 520 * 10 * Math.log(2) * Math.pow(2, -10 * lt) / 0.26 / FPS : 0; // px pro Bild
      if (vel > 2) {
        const n = 7;
        for (let k = n; k >= 1; k--) { ctx.globalAlpha = 0.16 * (1 - k / (n + 1)); ctx.fillText(w, cx + off + vel * 0.9 * k / n, y); }
      }
      ctx.globalAlpha = 1; ctx.fillText(w, cx + off, y);
    }
    cx += ww + space;
  });
  ctx.letterSpacing = '0px';
}

// ---------------------------------------------------------------- HUD
function hud(ctx, st) {
  const col = st.dark ? 'rgba(214,170,96,0.85)' : 'rgba(30,21,13,0.88)';
  ctx.save();
  ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1.4;
  const m = 44, a = 34;
  [[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1]].forEach(([x, y, sx, sy]) => {
    ctx.beginPath(); ctx.moveTo(x + sx * a, y); ctx.lineTo(x, y); ctx.lineTo(x, y + sy * a); ctx.stroke();
  });
  ctx.font = '500 15px "Plex"'; ctx.letterSpacing = '6px';
  ctx.textAlign = 'left'; ctx.fillText(st.chapter, m + 24, m + 34);
  ctx.textAlign = 'right'; ctx.fillText('MIKKANER — EINE CHRONIK', W - m - 18, m + 34);
  // Zähler unten links
  ctx.textAlign = 'left'; ctx.font = '500 12px "Plex"'; ctx.letterSpacing = '6px';
  ctx.fillText('TAKT', m + 24, H - m - 52);
  ctx.font = '500 36px "Plex"'; ctx.letterSpacing = '8px';
  ctx.fillText(String(Math.round(st.bar)).padStart(3, '0'), m + 22, H - m - 14);
  ctx.font = '500 14px "Plex"'; ctx.letterSpacing = '4px'; ctx.globalAlpha = 0.7;
  ctx.fillText('/156', m + 116, H - m - 16); ctx.globalAlpha = 1;
  // Zeitleiste unten Mitte
  const tw = 620, tx = (W - tw) / 2, ty = H - m - 24;
  ctx.lineWidth = 1; ctx.globalAlpha = 0.55;
  ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(tx + tw, ty); ctx.stroke();
  for (let i = 0; i <= SHOTS.length + 1; i++) {
    const tt = i === 0 ? 0 : i === SHOTS.length + 1 ? TOTAL : INTRO + (i - 1) * SHOT;
    const x = tx + tw * tt / TOTAL; ctx.beginPath(); ctx.moveTo(x, ty - 5); ctx.lineTo(x, ty + 5); ctx.stroke();
  }
  for (let s = 0; s <= TOTAL; s++) { const x = tx + tw * s / TOTAL; ctx.beginPath(); ctx.moveTo(x, ty); ctx.lineTo(x, ty + 2.5); ctx.stroke(); }
  ctx.globalAlpha = 1;
  const px = tx + tw * st.time / TOTAL;
  ctx.strokeStyle = RED; ctx.lineWidth = 2.4;
  ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(px, ty); ctx.stroke();
  ctx.fillStyle = RED; ctx.beginPath(); ctx.moveTo(px - 7, ty - 16); ctx.lineTo(px + 7, ty - 16); ctx.lineTo(px, ty - 5); ctx.closePath(); ctx.fill();
  ctx.fillStyle = col; ctx.font = '500 12px "Plex"'; ctx.letterSpacing = '4px';
  const fmt = v => `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(Math.floor(v % 60)).padStart(2, '0')}:${String(Math.floor((v % 1) * FPS)).padStart(2, '0')}`;
  ctx.textAlign = 'right'; ctx.fillText(fmt(st.time), tx - 18, ty + 4);
  ctx.textAlign = 'left'; ctx.fillText(fmt(TOTAL), tx + tw + 18, ty + 4);
  // Kennzahl unten rechts
  const rx = W - m - 24;
  ctx.textAlign = 'right'; ctx.font = '500 12px "Plex"'; ctx.letterSpacing = '6px';
  ctx.fillText('PEGEL DBFS', rx, H - m - 52);
  ctx.font = '500 36px "Plex"'; ctx.letterSpacing = '6px';
  const dbs = (st.db <= -59.95 ? '-60.0' : st.db.toFixed(1));
  ctx.fillText(dbs, rx - 150, H - m - 14);
  // Mini-Skala
  const sx = rx - 128, sw = 128, sy = H - m - 28;
  ctx.strokeStyle = col; ctx.lineWidth = 1;
  for (let i = 0; i <= 12; i++) { const x = sx + sw * i / 12, h = i % 4 === 0 ? 12 : 6; ctx.beginPath(); ctx.moveTo(x, sy); ctx.lineTo(x, sy - h); ctx.stroke(); }
  ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + sw, sy); ctx.stroke();
  const f = clamp((st.db + 30) / 30), mx = sx + sw * f;
  ctx.strokeStyle = RED; ctx.lineWidth = 2.4; ctx.beginPath(); ctx.moveTo(sx, sy + 5); ctx.lineTo(mx, sy + 5); ctx.stroke();
  ctx.fillStyle = RED; ctx.beginPath(); ctx.moveTo(mx - 5, sy + 15); ctx.lineTo(mx + 5, sy + 15); ctx.lineTo(mx, sy + 7); ctx.closePath(); ctx.fill();
  ctx.fillStyle = col; ctx.font = '500 10px "Plex"'; ctx.letterSpacing = '3px'; ctx.textAlign = 'center';
  ctx.fillText('-30', sx, sy + 28); ctx.fillText('0', sx + sw, sy + 28);
  ctx.restore();
}

// ---------------------------------------------------------------- Goldene Szenen (Anfang & Ende)
function goldScene(ctx, t, frame, outro) {
  ctx.fillStyle = '#0a0806'; ctx.fillRect(0, 0, W, H);
  const cx = W / 2, cy = 470;
  const push = 1 + 0.045 * t / (outro ? OUTRO : INTRO);
  ctx.save();
  ctx.translate(cx, cy); ctx.scale(push, push); ctx.translate(-cx, -cy);
  // Lichthof hinter der Schrift
  const halo = ctx.createRadialGradient(cx, cy, 10, cx, cy, 520);
  halo.addColorStop(0, 'rgba(190,120,40,0.20)'); halo.addColorStop(0.5, 'rgba(120,70,20,0.07)'); halo.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = halo; ctx.fillRect(0, 0, W, H);
  // Ring mit Skala, zeichnet sich auf
  const rp = clamp(t / 1.6), rot = t * 0.06;
  ctx.strokeStyle = 'rgba(214,170,96,0.55)'; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.arc(cx, cy, 310, -Math.PI / 2 + rot, -Math.PI / 2 + rot + rp * 2 * Math.PI); ctx.stroke();
  ctx.strokeStyle = 'rgba(214,170,96,0.3)'; ctx.lineWidth = 0.8;
  ctx.beginPath(); ctx.arc(cx, cy, 292, Math.PI / 2 - rot, Math.PI / 2 - rot + rp * 2 * Math.PI); ctx.stroke();
  const nt = Math.floor(156 * rp);
  for (let i = 0; i < nt; i++) {
    const a = -Math.PI / 2 + rot + i / 156 * 2 * Math.PI, L = i % 13 === 0 ? 16 : i % 4 === 0 ? 9 : 4;
    ctx.strokeStyle = i % 13 === 0 ? 'rgba(230,185,105,0.8)' : 'rgba(214,170,96,0.45)';
    ctx.beginPath(); ctx.moveTo(cx + 310 * Math.cos(a), cy + 310 * Math.sin(a)); ctx.lineTo(cx + (310 + L) * Math.cos(a), cy + (310 + L) * Math.sin(a)); ctx.stroke();
  }
  // Inschrift, glüht Buchstabe für Buchstabe auf
  const title = 'MIKKANER';
  ctx.font = '700 150px "Cinzel"'; ctx.letterSpacing = '22px'; ctx.textAlign = 'left';
  const tw = ctx.measureText(title).width - 22;
  let x = cx - tw / 2;
  for (let i = 0; i < title.length; i++) {
    const ch = title[i], w = ctx.measureText(ch).width;
    const lt = clamp((t - 0.5 - i * 0.12) / 0.5);
    if (lt > 0) {
      const fl = 0.92 + 0.08 * Math.sin(frame * 0.9 + i * 2.1) * Math.sin(frame * 0.37 + i);
      const k = easeInOut(lt) * fl;
      ctx.shadowColor = `rgba(255,160,50,${0.9 * k})`; ctx.shadowBlur = 60;
      ctx.fillStyle = `rgba(200,130,40,${0.7 * k})`; ctx.fillText(ch, x, cy + 52);
      ctx.shadowBlur = 18; ctx.shadowColor = `rgba(255,200,110,${k})`;
      ctx.fillStyle = `rgba(246,206,128,${k})`; ctx.fillText(ch, x, cy + 52);
      ctx.shadowBlur = 0;
      ctx.fillStyle = `rgba(255,240,205,${0.55 * k})`; ctx.fillText(ch, x, cy + 51);
    }
    x += w;
  }
  ctx.shadowBlur = 0;
  // Unterzeile
  const sub = outro ? '130 BPM · 4/4 · 156 TAKTE · NEUN SPUREN' : 'EINE CHRONIK IN ZWÖLF MOMENTEN';
  const sp = clamp((t - (outro ? 1.6 : 1.8)) / 0.8);
  if (sp > 0) {
    ctx.font = '700 26px "Cinzel"'; ctx.letterSpacing = '10px'; ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(255,170,60,0.6)'; ctx.shadowBlur = 14;
    ctx.fillStyle = `rgba(226,178,90,${0.9 * sp})`;
    const n = Math.ceil(sub.length * sp);
    ctx.fillText(sub.slice(0, n), cx, cy + 128);
    ctx.shadowBlur = 0;
  }
  if (outro) {
    const bp = clamp((t - 2.4) / 1.0);
    ctx.strokeStyle = BRAND; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(cx - 240 * bp, cy + 160); ctx.lineTo(cx + 240 * bp, cy + 160); ctx.stroke();
    const ep = clamp((t - 3.0) / 0.8);
    if (ep > 0) {
      ctx.font = '500 14px "Plex"'; ctx.letterSpacing = '8px'; ctx.textAlign = 'center';
      ctx.fillStyle = `rgba(214,170,96,${0.75 * ep})`;
      ctx.fillText('ABLETON LIVE 12 · MASTER -1,5 DB', cx, cy + 196);
    }
  }
  ctx.restore();
  // Flamme mit Funken
  flame(ctx, cx, 838, t, frame, clamp(t / 1.2));
}

function flame(ctx, x, y, t, frame, grow) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const h = 70 * grow;
  const layers = [
    { s: 1.0, c: 'rgba(200,80,20,0.55)', b: 30 },
    { s: 0.72, c: 'rgba(255,150,40,0.7)', b: 18 },
    { s: 0.45, c: 'rgba(255,220,140,0.9)', b: 8 },
  ];
  layers.forEach((L, i) => {
    const sway = 6 * Math.sin(t * 7.3 + i) + 3 * Math.sin(t * 13.1 + i * 2);
    const hh = h * L.s * (0.92 + 0.1 * Math.sin(t * 11 + i * 1.7)), ww = 22 * L.s * grow;
    ctx.shadowColor = L.c; ctx.shadowBlur = L.b; ctx.fillStyle = L.c;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.bezierCurveTo(x - ww * 1.2, y - hh * 0.15, x - ww * 0.6 + sway * 0.3, y - hh * 0.65, x + sway, y - hh);
    ctx.bezierCurveTo(x + ww * 0.6 + sway * 0.3, y - hh * 0.65, x + ww * 1.2, y - hh * 0.15, x, y);
    ctx.fill();
  });
  ctx.shadowBlur = 0;
  // Docht
  ctx.globalCompositeOperation = 'source-over';
  ctx.strokeStyle = 'rgba(214,170,96,0.4)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x - 60, y + 14); ctx.lineTo(x + 60, y + 14); ctx.stroke();
  ctx.globalCompositeOperation = 'lighter';
  // Funken
  for (let i = 0; i < 46; i++) {
    const r = rng(5000 + i), period = 1.6 + r() * 1.8, birth = 0.3 + r() * period;
    if (t < birth) continue;
    const life = ((t - birth) % period) / period, rise = 40 + r() * 260;
    const sx = x + (r() - 0.5) * 30 + Math.sin(life * 6 + i) * 16 * life + (r() - 0.5) * 80 * life;
    const sy = y - 20 - rise * life;
    const a = (1 - life) * grow * (0.6 + 0.4 * Math.sin(frame * 1.7 + i));
    ctx.fillStyle = `rgba(255,${180 + Math.floor(r() * 60)},90,${a})`;
    ctx.shadowColor = 'rgba(255,150,40,0.9)'; ctx.shadowBlur = 6;
    ctx.beginPath(); ctx.arc(sx, sy, 0.8 + r() * 1.6, 0, 7); ctx.fill();
  }
  ctx.restore();
}

// ---------------------------------------------------------------- Bild zusammensetzen
function render(frame) {
  const ctx = document.getElementById('c').getContext('2d');
  const time = frame / FPS;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  let hudState, cutAge = null;

  if (time < INTRO || time >= INTRO + SHOTS.length * SHOT) {
    const outro = time >= INTRO;
    const t = outro ? time - INTRO - SHOTS.length * SHOT : time;
    goldScene(ctx, t, frame, outro);
    drawGrain(ctx, frame, 0.10);
    drawVignette(ctx, 1);
    if (outro) cutAge = t;
    hudState = {
      dark: true, time,
      chapter: outro ? 'EPILOG' : 'PROLOG',
      bar: outro ? 156 : 0,
      db: outro ? -1.5 : lerp(-60, -30, clamp(t / INTRO)),
    };
  } else {
    const i = Math.floor((time - INTRO) / SHOT), t = time - INTRO - i * SHOT, sh = SHOTS[i];
    cutAge = t;
    // Papier, Kamera schiebt sich hinein
    const push = 1 + 0.075 * t / SHOT, fx = 1010, fy = 600;
    ctx.save();
    ctx.translate(fx, fy); ctx.scale(push, push); ctx.translate(-fx, -fy);
    ctx.drawImage(paperCanvas, -40, -30, W + 80, H + 60);
    // Überschrift
    flyWords(ctx, LEAD.split(' '), 130, 212, 46, INK, 0.08, t, 8, 6);
    flyWords(ctx, sh.key.split(' '), 122, 340, 128, RED, 0.24, t, 18, 4);
    // Zeichnung
    ctx.save();
    ctx.translate(1010, 655); ctx.scale(0.9, 0.9);
    drawSketch(ctx, PREP[i], clamp((t - 0.05) / 1.85));
    ctx.restore();
    ctx.restore();
    drawGrain(ctx, frame, 0.16);
    drawVignette(ctx, 1);
    const prev = i === 0 ? { bar: 0, db: -30 } : SHOTS[i - 1];
    const e = easeOutExpo(clamp(t / 0.7));
    const jitter = i === SHOTS.length - 1 ? 0.3 * (1 - clamp(t / 1.0)) : 1;
    hudState = {
      dark: false, time,
      chapter: `KAPITEL ${ROMAN[i]}  ·  ${sh.ch}`,
      bar: lerp(prev.bar, sh.bar, e),
      db: lerp(prev.db, sh.db, e) + jitter * 0.35 * Math.sin(frame * 1.31) * Math.sin(frame * 0.47 + i),
    };
  }
  hud(ctx, hudState);
  // Lichtblitz beim harten Schnitt
  if (cutAge !== null && cutAge < 4 / FPS && time >= INTRO) {
    const k = [0.85, 0.45, 0.18, 0.05][Math.floor(cutAge * FPS + 1e-6)] || 0;
    ctx.fillStyle = `rgba(255,246,228,${k})`; ctx.fillRect(0, 0, W, H);
  }
}

async function init() {
  const faces = [
    new FontFace('Cinzel', 'url(node_modules/@fontsource/cinzel/files/cinzel-latin-700-normal.woff2)', { weight: '700' }),
    new FontFace('Plex', 'url(node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2)', { weight: '500' }),
  ];
  for (const f of faces) { await f.load(); document.fonts.add(f); }
  buildPaper();
  PREP = SHOTS.map(prepare);
  window.TOTAL_FRAMES = TOTAL_FRAMES; window.FPS = FPS;
  window.render = render;
  window.ready = true;
}
init();
