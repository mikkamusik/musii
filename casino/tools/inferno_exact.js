// exact RTP for a 5-reel line game with independent cells and no wild
function rtp(w, pays, lines, scat, scatPays) {
  const tot = Object.values(w).reduce((a, b) => a + b, 0);
  let r = 0;
  for (const s in pays) {
    const p = w[s] / tot;
    for (const n in pays[s]) {
      const k = +n; const prob = k === 5 ? p ** 5 : p ** k * (1 - p);
      r += prob * pays[s][n] / lines * lines; // per line: pay x lineBet; lines lines => pay * bet/lines * lines... /bet
    }
  }
  r = r / lines; // each line contributes pay*lineBet = pay*bet/lines; summed over lines => pay*bet... handled
  // scatter: approx per reel prob of >=1 scatter in 3 cells
  const ps = w[scat] / tot, q = 1 - (1 - ps) ** 3;
  let sr = 0; const C = (n, k) => { let x = 1; for (let i = 0; i < k; i++) x = x * (n - i) / (i + 1); return x; };
  for (const n in scatPays) sr += C(5, +n) * q ** n * (1 - q) ** (5 - n) * scatPays[n];
  return { line: r * lines, scatter: sr };
}
module.exports = rtp;
if (require.main === module) {
  const w = JSON.parse(process.argv[2]); const pays = JSON.parse(process.argv[3]);
  const out = rtp(w, pays, 5, 'star', { 3: 2, 4: 10, 5: 50 });
  console.log((out.line * 100).toFixed(2) + '% lines', (out.scatter * 100).toFixed(2) + '% scatter', ((out.line + out.scatter) * 100).toFixed(2) + '% total');
}
