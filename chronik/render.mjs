// Rendert die Chronik Bild für Bild mit Playwright und setzt sie mit ffmpeg zusammen.
//   node render.mjs            -> out/mikkaner-chronik.mp4
//   node render.mjs --stills   -> out/stills/*.png (ein Bild pro Motiv)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(root, 'out');
fs.mkdirSync(out, { recursive: true });

const types = { '.html': 'text/html', '.js': 'text/javascript', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, r));
const url = `http://127.0.0.1:${server.address().port}/index.html`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto(url);
await page.waitForFunction(() => window.ready === true);
const { total, fps } = await page.evaluate(() => ({ total: window.TOTAL_FRAMES, fps: window.FPS }));

const grab = (f, type = 'image/jpeg') => page.evaluate(([f, type]) => {
  window.render(f);
  return document.getElementById('c').toDataURL(type, 0.95).split(',')[1];
}, [f, type]);

if (process.argv.includes('--stills')) {
  const dir = path.join(out, 'stills');
  fs.mkdirSync(dir, { recursive: true });
  const list = process.argv.slice(3).map(Number);
  const frames = list.length ? list : [36, 90, 140, ...Array.from({ length: 12 }, (_, i) => 150 + i * 75 + 66), 150 + 12 * 75 + 120, total - 20];
  for (const f of frames) fs.writeFileSync(path.join(dir, `f${String(f).padStart(4, '0')}.png`), Buffer.from(await grab(f, 'image/png'), 'base64'));
  console.log(`${frames.length} Standbilder in ${dir}`);
} else {
  const file = path.join(out, 'mikkaner-chronik.mp4');
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(fps), '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '23', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', file], { stdio: ['pipe', 'inherit', 'inherit'] });
  const t0 = Date.now();
  for (let f = 0; f < total; f++) {
    const buf = Buffer.from(await grab(f), 'base64');
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    if (f % 150 === 0) console.log(`Bild ${f}/${total} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  }
  ff.stdin.end();
  await new Promise(r => ff.on('close', r));
  console.log(`Fertig: ${file}`);
}
await browser.close();
server.close();
