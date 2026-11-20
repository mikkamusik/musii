/* Rendert MöbelFit-Workouts als MP4 (720×1280, 9:16) mit Tonspur.
   node tools/render.js <workout-id|bibliothek> [out.mp4] [--fps 24] [--workers 4]
   Voraussetzungen: index.html gebaut (python3 build.py), Playwright, ffmpeg, python3 + numpy. */
const { chromium } = require("playwright");
const { spawn, execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const ROOT = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const id = args[0];
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const out = args[1] && !args[1].startsWith("--") ? path.resolve(args[1]) : path.join(ROOT, "videos", id + ".mp4");
const FPS = +opt("--fps", 24);
const WORKERS = +opt("--workers", 4);
const OUTRO = 5;
const W = 720, H = 1280;

(async () => {
  if (!id) { console.error("Workout-ID fehlt"); process.exit(1); }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mf-" + id + "-"));
  const url = "file://" + path.join(ROOT, "index.html") + "?render=" + encodeURIComponent(id);
  const browser = await chromium.launch();
  const mk = async () => {
    const p = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    p.on("pageerror", (e) => console.error("pageerror:", e.message));
    await p.goto(url);
    await p.evaluate(() => document.fonts.ready);
    await p.waitForTimeout(200);
    return p;
  };
  const first = await mk();
  const info = await first.evaluate(() => ({ total: window.__render.total, segs: window.__render.segs }));
  const totalT = info.total + OUTRO;
  const nFrames = Math.ceil(totalT * FPS);
  fs.writeFileSync(path.join(tmp, "segs.json"), JSON.stringify({ segs: info.segs, outro: OUTRO }));
  console.log(`${id}: ${Math.round(info.total)} s Workout, ${nFrames} Frames, ${WORKERS} Worker`);

  const per = Math.ceil(nFrames / WORKERS);
  const pages = [first];
  for (let i = 1; i < WORKERS; i++) pages.push(await mk());
  const t0 = Date.now();
  let doneFrames = 0;
  const chunks = await Promise.all(pages.map(async (p, wi) => {
    const a = wi * per, b = Math.min(nFrames, a + per);
    const file = path.join(tmp, `chunk${wi}.mp4`);
    const proc = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-pix_fmt", "yuv420p", "-r", String(FPS), file], { stdio: ["pipe", "ignore", "inherit"] });
    const closed = new Promise((res, rej) => proc.on("close", (c) => (c === 0 ? res() : rej(new Error("ffmpeg chunk " + c)))));
    for (let f = a; f < b; f++) {
      await p.evaluate((T) => window.__render.setTime(T), f / FPS);
      const buf = await p.screenshot({ type: "jpeg", quality: 90 });
      if (!proc.stdin.write(buf)) await new Promise((r) => proc.stdin.once("drain", r));
      doneFrames++;
      if (wi === 0 && f % (FPS * 30) === 0) {
        const el = (Date.now() - t0) / 1000;
        console.log(`  ${Math.round((doneFrames / nFrames) * 100)} % · ${Math.round(el)} s`);
      }
    }
    proc.stdin.end();
    await closed;
    return file;
  }));
  await browser.close();

  fs.writeFileSync(path.join(tmp, "list.txt"), chunks.map((c) => `file '${c}'`).join("\n"));
  execFileSync("python3", [path.join(__dirname, "audio.py"), path.join(tmp, "segs.json"), path.join(tmp, "audio.wav")]);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", path.join(tmp, "list.txt"), "-i", path.join(tmp, "audio.wav"),
    "-c:v", "copy", "-c:a", "aac", "-b:a", "64k", "-shortest", "-movflags", "+faststart", out]);
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`fertig: ${out} (${(fs.statSync(out).size / 1e6).toFixed(1)} MB, ${Math.round((Date.now() - t0) / 1000)} s)`);
})().catch((e) => { console.error(e); process.exit(1); });
