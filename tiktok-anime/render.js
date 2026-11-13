// Rendert scene.html Frame für Frame zu JPGs.
// Aufruf: node render.js <ausgabeordner> [--times 0.5,13.2,...]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const outDir = process.argv[2] || 'frames';
  const ti = process.argv.indexOf('--times');
  const tl = JSON.parse(fs.readFileSync(path.join(__dirname, 'timeline.json'), 'utf8'));
  const fps = tl.fps, total = Math.round(tl.duration * fps);
  const jobs = ti > 0
    ? process.argv[ti + 1].split(',').map((t, i) => ({ t: parseFloat(t), name: `preview_${String(i).padStart(2, '0')}_${t}s.jpg` }))
    : Array.from({ length: total }, (_, i) => ({ t: i / fps, name: `f_${String(i).padStart(5, '0')}.jpg` }));
  fs.mkdirSync(outDir, { recursive: true });

  // Figurenbilder als data-URLs übergeben (lokale Dateien würden den Canvas für den Export sperren)
  const figData = {};
  for (const n of ['nanuka', 'oma-hildegard', 'blorp']) {
    const f = path.join(__dirname, 'figuren', n + '.png');
    if (fs.existsSync(f)) figData[n] = 'data:image/png;base64,' + fs.readFileSync(f).toString('base64');
  }

  const browser = await chromium.launch();
  const WORKERS = 4;
  let next = 0, done = 0;
  const url = 'file://' + path.join(__dirname, 'scene.html');
  await Promise.all(Array.from({ length: WORKERS }, async () => {
    const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
    page.on('pageerror', e => { console.error('PAGE ERROR', e.message); process.exitCode = 1; });
    await page.addInitScript(([t, figs]) => { window.__RENDER__ = true; window.TIMELINE = t; window.FIG_DATA = figs; }, [tl, figData]);
    await page.goto(url);
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => window.__imagesReady);
    while (next < jobs.length) {
      const job = jobs[next++];
      const data = await page.evaluate(t => { renderFrame(t); return document.getElementById('c').toDataURL('image/jpeg', 0.94); }, job.t);
      fs.writeFileSync(path.join(outDir, job.name), Buffer.from(data.split(',')[1], 'base64'));
      if (++done % 100 === 0) console.log(`${done}/${jobs.length} Frames`);
    }
    await page.close();
  }));
  await browser.close();
  console.log(`Fertig: ${done} Frames in ${outDir}`);
})();
