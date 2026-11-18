// RTP simulator: node casino/tools/sim.js [rounds] [gameId]
const E = require('../engine.js');
const N = Number(process.argv[2] || 200000);
const only = process.argv[3];
for (const g of E.games) {
  if (only && g.id !== only) continue;
  let bet = 100, won = 0, feats = 0, fw = 0, hits = 0, max = 0;
  const t0 = Date.now();
  for (let i = 0; i < N; i++) {
    const r = E.playRound(g, bet);
    won += r.total; if (r.feature) { feats++; fw += r.featureWin; } if (r.total > 0) hits++;
    if (r.total > max) max = r.total;
  }
  console.log(`${g.id.padEnd(8)} RTP ${(won / (N * bet) * 100).toFixed(2)}%  base ${((won - fw) / (N * bet) * 100).toFixed(2)}%  feature 1/${(N / Math.max(feats,1)).toFixed(0)} avg ${(fw / Math.max(feats,1) / bet).toFixed(1)}x  hit ${(hits / N * 100).toFixed(1)}%  max ${(max / bet).toFixed(0)}x  (${Date.now() - t0}ms)`);
}
