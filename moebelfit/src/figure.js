/* MöbelFit – Figur, Kinematik und Requisiten (Seitenansicht).
   Bühne: viewBox 0 0 400 300, Boden bei y = 250. 1 Einheit ≈ 1 cm. */

const FIG = { torso: 62, neck: 20, head: 13, thigh: 46, shin: 44, upper: 35, fore: 34, foot: 15 };
const D2R = Math.PI / 180;
const FLOOR = 250;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => 0.5 - 0.5 * Math.cos(Math.PI * t);
const r1 = (n) => Math.round(n * 10) / 10;

/* Zwei-Knochen-IK: Basis a, Ziel t, Längen l1/l2, Beugerichtung s (-1 / +1). */
function ik(a, t, l1, l2, s) {
  const dx = t[0] - a[0], dy = t[1] - a[1];
  const d = Math.hypot(dx, dy) || 0.0001;
  const dc = clamp(d, Math.abs(l1 - l2) + 0.01, l1 + l2 - 0.01);
  const ux = dx / d, uy = dy / d;
  const cosA = clamp((l1 * l1 + dc * dc - l2 * l2) / (2 * l1 * dc), -1, 1);
  const ang = s * Math.acos(cosA);
  const c = Math.cos(ang), sn = Math.sin(ang);
  const j = [a[0] + l1 * (ux * c - uy * sn), a[1] + l1 * (ux * sn + uy * c)];
  const ex = t[0] - j[0], ey = t[1] - j[1];
  const el = Math.hypot(ex, ey) || 0.0001;
  return [j, [j[0] + (l2 * ex) / el, j[1] + (l2 * ey) / el]];
}

/* Gerader Körper (Plank-Linie) ab Knöchel unter Winkel beta (Grad über der Horizontalen). */
function bodyLine(ankle, beta, dir = 1) {
  const r = beta * D2R;
  const ux = Math.cos(r) * dir, uy = -Math.sin(r);
  const hip = [ankle[0] + 89 * ux, ankle[1] + 89 * uy];
  const sh = [hip[0] + 62 * ux, hip[1] + 62 * uy];
  return { hip, sh };
}

function pair(v, offFar = -4, offNear = 2) {
  if (typeof v[0] === "number") return [[v[0] + offFar, v[1]], [v[0] + offNear, v[1]]];
  return v;
}

function normPose(p) {
  const q = Object.assign({ hd: 0, ft: [0, 0], kb: [-1, -1], eb: [1, 1], off: [0, 0] }, p);
  if (p.sh) q.t = Math.atan2(p.sh[0] - p.hip[0], -(p.sh[1] - p.hip[1])) / D2R;
  if (q.t === undefined) q.t = 0;
  q.f = pair(p.f);
  q.h = pair(p.h, -3, 2);
  if (typeof q.ft === "number") q.ft = [q.ft, q.ft];
  return q;
}

function lerpPose(a, b, t) {
  const L2 = (x, y) => [lerp(x[0], y[0], t), lerp(x[1], y[1], t)];
  return {
    hip: L2(a.hip, b.hip), t: lerp(a.t, b.t, t), hd: lerp(a.hd, b.hd, t),
    f: [L2(a.f[0], b.f[0]), L2(a.f[1], b.f[1])],
    h: [L2(a.h[0], b.h[0]), L2(a.h[1], b.h[1])],
    ft: [lerp(a.ft[0], b.ft[0], t), lerp(a.ft[1], b.ft[1], t)],
    kb: t < 0.5 ? a.kb : b.kb, eb: t < 0.5 ? a.eb : b.eb,
    off: L2(a.off, b.off),
  };
}

function solvePose(p) {
  const o = p.off;
  const hip = [p.hip[0] + o[0], p.hip[1] + o[1]];
  const tr = p.t * D2R;
  const sh = [hip[0] + FIG.torso * Math.sin(tr), hip[1] - FIG.torso * Math.cos(tr)];
  const hr = (p.t + p.hd) * D2R;
  const nk = FIG.neck + FIG.head - 4;
  const head = [sh[0] + nk * Math.sin(hr), sh[1] - nk * Math.cos(hr)];
  const J = { hip, sh, head, t: p.t + p.hd, knee: [], ankle: [], toe: [], elbow: [], hand: [] };
  for (let i = 0; i < 2; i++) {
    const fx = [p.f[i][0] + o[0], p.f[i][1] + o[1]];
    const [k, an] = ik(hip, fx, FIG.thigh, FIG.shin, p.kb[i]);
    const fa = p.ft[i] * D2R;
    J.knee.push(k); J.ankle.push(an);
    J.toe.push([an[0] + FIG.foot * Math.cos(fa), an[1] + FIG.foot * Math.sin(fa)]);
    const hx = [p.h[i][0] + o[0], p.h[i][1] + o[1]];
    const [e, hd] = ik(sh, hx, FIG.upper, FIG.fore, p.eb[i]);
    J.elbow.push(e); J.hand.push(hd);
  }
  return J;
}

/* Animation: keys werden zyklisch durchlaufen; move[i]/hold[i] in Sekunden. */
function prepAnim(ex) {
  if (ex._prep) return ex._prep;
  const A = ex.anim;
  const keys = A.keys.map(normPose);
  const n = keys.length;
  const move = A.move || keys.map(() => 1);
  const hold = A.hold || keys.map(() => 0.2);
  const total = move.reduce((s, v, i) => s + v + hold[i], 0);
  ex._prep = { keys, move, hold, total, n };
  return ex._prep;
}

function poseAt(ex, time) {
  const P = prepAnim(ex);
  let tt = ((time % P.total) + P.total) % P.total;
  const phase = tt / P.total;
  for (let i = 0; i < P.n; i++) {
    const a = P.keys[i], b = P.keys[(i + 1) % P.n];
    if (tt < P.move[i]) return { pose: lerpPose(a, b, ease(tt / P.move[i])), phase };
    tt -= P.move[i];
    if (tt < P.hold[i]) return { pose: lerpPose(b, b, 0), phase };
    tt -= P.hold[i];
  }
  return { pose: lerpPose(P.keys[0], P.keys[0], 0), phase };
}

/* ---------- Zeichnen ---------- */
const pts = (arr) => arr.map((p) => r1(p[0]) + "," + r1(p[1])).join(" ");

function figureSVG(J) {
  const limb = (a, b, c, cls) => `<polyline class="${cls}" points="${pts([a, b, c])}"/>`;
  const foot = (i, cls) => `<line class="${cls}" x1="${r1(J.ankle[i][0])}" y1="${r1(J.ankle[i][1])}" x2="${r1(J.toe[i][0])}" y2="${r1(J.toe[i][1])}"/>`;
  const fx = Math.cos(J.t * D2R), fy = Math.sin(J.t * D2R); // Blickrichtung
  const hx = J.head[0], hy = J.head[1];
  return [
    limb(J.sh, J.elbow[0], J.hand[0], "fa-far"),
    limb(J.hip, J.knee[0], J.ankle[0], "fl-far"), foot(0, "ff-far"),
    `<line class="ftorso" x1="${r1(J.hip[0])}" y1="${r1(J.hip[1])}" x2="${r1(J.sh[0])}" y2="${r1(J.sh[1])}"/>`,
    `<circle class="fhip" cx="${r1(J.hip[0])}" cy="${r1(J.hip[1])}" r="11.5"/>`,
    limb(J.hip, J.knee[1], J.ankle[1], "fl-near"), foot(1, "ff-near"),
    `<circle class="fhair" cx="${r1(hx - fx * 2.2)}" cy="${r1(hy - fy * 2.2)}" r="13.4"/>`,
    `<circle class="fface" cx="${r1(hx + fx * 1.6)}" cy="${r1(hy + fy * 1.6)}" r="11.6"/>`,
    limb(J.sh, J.elbow[1], J.hand[1], "fa-near"),
    `<circle class="fhand" cx="${r1(J.hand[1][0])}" cy="${r1(J.hand[1][1])}" r="5"/>`,
  ].join("");
}

/* Requisiten. x = Bezugskante, flip spiegelt um x. */
const PROPS = {
  chair({ x, flip }) {
    const g = `<g ${flip ? `transform="translate(${2 * x} 0) scale(-1 1)"` : ""}>
      <rect class="p-wood-far" x="${x + 13}" y="205" width="4.5" height="45" rx="2"/>
      <rect class="p-wood-far" x="${x - 15}" y="205" width="4.5" height="45" rx="2"/>
      <rect class="p-wood" x="${x + 18}" y="205" width="5" height="45" rx="2"/>
      <rect class="p-wood" x="${x - 22}" y="205" width="5" height="45" rx="2"/>
      <rect class="p-uph" x="${x - 26}" y="128" width="11" height="80" rx="5"/>
      <rect class="p-uph" x="${x - 24}" y="196" width="50" height="11" rx="4"/>
    </g>`;
    return g;
  },
  sofa({ x, flip }) {
    // x = vordere Sitzkante; Sofa liegt links davon (flip: rechts)
    return `<g ${flip ? `transform="translate(${2 * x} 0) scale(-1 1)"` : ""}>
      <rect class="p-sofa-d" x="${x - 92}" y="208" width="94" height="34" rx="6"/>
      <rect class="p-wood-d" x="${x - 86}" y="242" width="6" height="8" rx="1"/>
      <rect class="p-wood-d" x="${x - 8}" y="242" width="6" height="8" rx="1"/>
      <rect class="p-sofa-d" x="${x - 96}" y="132" width="26" height="80" rx="10"/>
      <rect class="p-sofa" x="${x - 74}" y="146" width="22" height="58" rx="9"/>
      <rect class="p-sofa" x="${x - 74}" y="194" width="78" height="18" rx="7"/>
    </g>`;
  },
  counter({ x, flip }) {
    // x = Vorderkante; Küchenzeile rechts davon (flip: links)
    return `<g ${flip ? `transform="translate(${2 * x} 0) scale(-1 1)"` : ""}>
      <rect class="p-wall" x="${x + 76}" y="0" width="${330 - x}" height="250"/>
      <rect class="p-tile" x="${x + 76}" y="96" width="5" height="60"/>
      <rect class="p-cab" x="${x + 2}" y="162" width="74" height="76"/>
      <rect class="p-plinth" x="${x + 6}" y="238" width="70" height="12"/>
      <line class="p-handle" x1="${x + 10}" y1="176" x2="${x + 10}" y2="200"/>
      <rect class="p-top" x="${x - 4}" y="155" width="116" height="7" rx="1"/>
    </g>`;
  },
  wall({ x, flip }) {
    const w = 400;
    return flip
      ? `<rect class="p-wall" x="0" y="0" width="${x}" height="250"/><rect class="p-base" x="0" y="242" width="${x}" height="8"/>`
      : `<rect class="p-wall" x="${x}" y="0" width="${w - x}" height="250"/><rect class="p-base" x="${x}" y="242" width="${w - x}" height="8"/>`;
  },
  door({ x }) {
    return `<rect class="p-frame" x="${x}" y="30" width="10" height="220"/>
      <rect class="p-door" x="${x + 10}" y="36" width="60" height="214"/>
      <circle class="p-knob" cx="${x + 20}" cy="150" r="3"/>
      <rect class="p-anchor" x="${x - 3}" y="146" width="8" height="10" rx="2"/>`;
  },
  bars({ x }) {
    const one = (cx, cls) => `<path class="${cls}" d="M${cx - 14} 250 Q${cx} 226 ${cx + 14} 250" fill="none"/>
      <circle class="p-foam" cx="${cx}" cy="236" r="6.5"/><circle class="p-foam-s" cx="${cx}" cy="236" r="2.2"/>`;
    return one(x - 4, "p-bar-far") + one(x + 2, "p-bar");
  },
  dartboard({ x, y }) {
    return `<rect class="p-dartbg" x="${x - 30}" y="${y - 34}" width="60" height="68" rx="6"/>
      <circle cx="${x}" cy="${y}" r="24" class="p-dart1"/><circle cx="${x}" cy="${y}" r="17" class="p-dart2"/>
      <circle cx="${x}" cy="${y}" r="4" class="p-dart3"/>`;
  },
  calendar({ x, y }) {
    return `<rect class="p-cal" x="${x}" y="${y}" width="44" height="54" rx="2"/>
      <line class="p-calline" x1="${x + 3}" y1="${y + 14}" x2="${x + 41}" y2="${y + 14}"/>
      <line class="p-calline" x1="${x + 3}" y1="${y + 27}" x2="${x + 41}" y2="${y + 27}"/>
      <line class="p-calline" x1="${x + 3}" y1="${y + 40}" x2="${x + 41}" y2="${y + 40}"/>`;
  },
};

/* Dynamische Anhänge (hängen an Gelenken). */
const ATT = {
  db(J) { // Kurzhantel in der vorderen Hand (Stirnansicht)
    const [x, y] = J.hand[1];
    return `<rect class="a-db" x="${r1(x - 9)}" y="${r1(y - 9)}" width="18" height="18" rx="5"/><circle class="a-db-hi" cx="${r1(x)}" cy="${r1(y)}" r="4"/>`;
  },
  dbv(J) { // senkrecht (Goblet)
    const [x, y] = J.hand[1];
    return `<rect class="a-db" x="${r1(x - 8)}" y="${r1(y - 2)}" width="16" height="9" rx="3"/><rect class="a-db" x="${r1(x - 3)}" y="${r1(y + 6)}" width="6" height="14"/><rect class="a-db" x="${r1(x - 8)}" y="${r1(y + 18)}" width="16" height="9" rx="3"/>`;
  },
  dbhip(J) { // Hantel auf der Hüfte
    const [x, y] = J.hip;
    return `<rect class="a-db" x="${r1(x - 9)}" y="${r1(y - 22)}" width="18" height="16" rx="5"/><circle class="a-db-hi" cx="${r1(x)}" cy="${r1(y - 14)}" r="3.5"/>`;
  },
  towel(J) { // Handtuch unter beiden Füßen
    return [0, 1].map((i) => {
      const [x] = J.ankle[i];
      return `<rect class="a-towel" x="${r1(x - 10)}" y="245" width="34" height="6" rx="2"/><line class="a-towel-s" x1="${r1(x - 6)}" y1="248" x2="${r1(x + 20)}" y2="248"/>`;
    }).join("");
  },
  towelheel(J) {
    const x = (J.ankle[0][0] + J.ankle[1][0]) / 2;
    return `<rect class="a-towel" x="${r1(x - 18)}" y="245" width="36" height="6" rx="2"/><line class="a-towel-s" x1="${r1(x - 14)}" y1="248" x2="${r1(x + 14)}" y2="248"/>`;
  },
  towelrear(J) {
    const [x] = J.ankle[0];
    return `<rect class="a-towel" x="${r1(x - 6)}" y="245" width="32" height="6" rx="2"/><line class="a-towel-s" x1="${r1(x - 2)}" y1="248" x2="${r1(x + 22)}" y2="248"/>`;
  },
  pillow(J) {
    const [x, y] = J.knee[1];
    return `<g transform="rotate(${r1(J.t + 90)} ${r1(x)} ${r1(y)})"><rect class="a-pillow" x="${r1(x - 13)}" y="${r1(y - 8)}" width="26" height="16" rx="6"/>
      <line class="a-pillow-s" x1="${r1(x + 4)}" y1="${r1(y - 7)}" x2="${r1(x + 4)}" y2="${r1(y + 7)}"/></g>`;
  },
  pillowhead(J) {
    const [x, y] = J.head;
    return `<rect class="a-pillow" x="${r1(x - 16)}" y="${r1(Math.min(y + 8, 240))}" width="32" height="10" rx="4"/>`;
  },
  banddoor(J, ex) {
    const ax = ex.anchor || 330, ay = 151;
    return [0, 1].map((i) => `<line class="${i ? "a-band" : "a-band2"}" x1="${ax}" y1="${ay}" x2="${r1(J.hand[i][0])}" y2="${r1(J.hand[i][1])}"/>`).join("") +
      [0, 1].map((i) => `<rect class="a-grip" x="${r1(J.hand[i][0] - 3)}" y="${r1(J.hand[i][1] - 7)}" width="6" height="14" rx="3"/>`).join("");
  },
  bandfoot(J) {
    return [0, 1].map((i) => {
      const a = J.ankle[i], h = J.hand[i];
      const mx = (a[0] + h[0]) / 2 + 10, my = (a[1] + h[1]) / 2;
      return `<path class="${i ? "a-band" : "a-band2"}" d="M${r1(a[0] + 6)} ${r1(a[1] + 3)} Q${r1(mx)} ${r1(my)} ${r1(h[0])} ${r1(h[1])}" fill="none"/>`;
    }).join("") + `<rect class="a-grip" x="${r1(J.hand[1][0] - 3)}" y="${r1(J.hand[1][1] - 7)}" width="6" height="14" rx="3"/>`;
  },
  rope(J, ex, phase) {
    const h = J.hand[1];
    const cx = J.hip[0] - 2, cy = 146, rx = 66, ry = 102;
    const th = 90 + 360 * (phase - 0.5);
    const pts2 = [];
    for (let a = th - 75; a <= th + 75.1; a += 15) {
      const r = a * D2R;
      pts2.push([cx + rx * Math.cos(r), cy + ry * Math.sin(r)]);
    }
    const d = "M" + r1(h[0]) + " " + r1(h[1]) + " L" + pts2.map((p) => r1(p[0]) + " " + r1(p[1])).join(" L") + " L" + r1(h[0] - 3) + " " + r1(h[1]);
    return `<path class="a-rope" d="${d}" fill="none"/>
      <rect class="a-ropeh" x="${r1(h[0] - 3)}" y="${r1(h[1] - 9)}" width="6" height="16" rx="2.5"/>`;
  },
};

function stageBG(opts = {}) {
  let s = `<rect class="st-wall" x="0" y="0" width="400" height="250"/>
    <rect class="st-floor" x="0" y="250" width="400" height="50"/>
    <rect class="st-base" x="0" y="244" width="400" height="6"/>`;
  for (let i = 0; i < 7; i++) {
    const x = 20 + i * 62 + (i % 2) * 9;
    s += `<line class="st-seam" x1="${x}" y1="252" x2="${x - 14}" y2="300"/>`;
  }
  s += `<line class="st-seam" x1="0" y1="268" x2="400" y2="268"/><line class="st-seam" x1="0" y1="286" x2="400" y2="286"/>`;
  return s;
}

/* Komplette Szene einer Übung zur Zeit t (Sekunden). */
function sceneSVG(ex, time) {
  const { pose, phase } = poseAt(ex, time);
  const J = solvePose(pose);
  const back = (ex.props || []).filter((p) => !p.front).map((p) => PROPS[p.type](p)).join("");
  const front = (ex.props || []).filter((p) => p.front).map((p) => PROPS[p.type](p)).join("");
  const under = (ex.att || []).filter((a) => a.startsWith("towel") || a === "pillowhead").map((a) => ATT[a](J, ex, phase)).join("");
  const over = (ex.att || []).filter((a) => !(a.startsWith("towel") || a === "pillowhead")).map((a) => ATT[a](J, ex, phase)).join("");
  const shx = (J.hip[0] + (J.ankle[0][0] + J.ankle[1][0]) / 2) / 2;
  const shadow = `<ellipse class="st-shadow" cx="${r1(shx)}" cy="251" rx="56" ry="4.5"/>`;
  return back + shadow + under + figureSVG(J) + over + front;
}

function staticStage(ex) {
  return stageBG();
}
