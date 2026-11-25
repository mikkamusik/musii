import type { Motion, MotionKey } from '../types';

/**
 * Local Motion: rendert Kamerafahrten + Effekte aus einem Standbild direkt im Browser
 * (Canvas + MediaRecorder) – kostenlos, offline, ohne API.
 */

const EASE: Record<string, (t: number) => number> = {
  linear: (t) => t,
  in: (t) => t * t * t,
  out: (t) => 1 - Math.pow(1 - t, 3),
  inout: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  'expo-in': (t) => (t === 0 ? 0 : Math.pow(2, 10 * t - 10)),
  'expo-out': (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
};

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function noise(seed: number) {
  return Math.sin(seed * 12.9898) * 0.5 + Math.sin(seed * 4.1414 + 1.3) * 0.3 + Math.sin(seed * 27.17 + 2.1) * 0.2;
}

export function motionAt(m: Motion, t: number, time = 0): Required<MotionKey> {
  const e = (EASE[m.ease || 'inout'] || EASE.inout)(Math.min(1, Math.max(0, t)));
  const f = m.from;
  const to = m.to;
  const k = {
    z: lerp(f.z ?? 1, to.z ?? 1, e),
    x: lerp(f.x ?? 0, to.x ?? 0, e),
    y: lerp(f.y ?? 0, to.y ?? 0, e),
    r: lerp(f.r ?? 0, to.r ?? 0, e),
    sx: lerp(f.sx ?? 1, to.sx ?? 1, e),
  };
  if (m.loop) {
    // Orbit-Illusion: Sinus-Bewegung über die gesamte Dauer
    const ph = t * Math.PI * 2;
    k.x = Math.sin(ph) * Math.max(Math.abs(f.x ?? 0), Math.abs(to.x ?? 0));
    k.sx = (f.sx ?? 1) + (1 - (f.sx ?? 1)) * Math.abs(Math.cos(ph));
  }
  if (m.shake) {
    const s = m.shake;
    k.x += noise(time * 3.1) * 0.006 * s;
    k.y += noise(time * 2.7 + 5) * 0.006 * s;
    k.r += noise(time * 1.9 + 9) * 0.35 * s;
  }
  return k;
}

export function motionTransform(m: Motion, t: number, time = 0): string {
  const k = motionAt(m, t, time);
  return `translate(${(-k.x * 100).toFixed(2)}%, ${(-k.y * 100).toFixed(2)}%) rotate(${k.r.toFixed(2)}deg) scale(${(k.z * k.sx).toFixed(4)}, ${k.z.toFixed(4)})`;
}

export interface RenderOpts {
  imageUrl: string;
  motion: Motion;
  fx?: string;
  duration: number;
  aspect: string;
  height?: number;
  fps?: number;
  onProgress?: (p: number) => void;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Bild konnte nicht geladen werden'));
    img.src = src;
  });
}

export function supportsLocalMotion(): boolean {
  return typeof MediaRecorder !== 'undefined' && typeof HTMLCanvasElement !== 'undefined' && 'captureStream' in HTMLCanvasElement.prototype;
}

function mimeCandidates(): string[] {
  // WebM zuerst (Chrome/Firefox/Edge), MP4 für Safari
  const options = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4;codecs=avc1', 'video/mp4'];
  return options.filter((o) => MediaRecorder.isTypeSupported(o));
}

export async function renderLocalMotion(o: RenderOpts): Promise<Blob> {
  if (!supportsLocalMotion()) throw new Error('Dieser Browser unterstützt keine Videoaufnahme (MediaRecorder).');
  const img = await loadImage(o.imageUrl);
  const mimes = mimeCandidates();
  if (!mimes.length) throw new Error('Kein unterstütztes Videoformat für die Aufnahme gefunden.');
  for (const mime of mimes) {
    const blob = await renderWith(img, o, mime);
    if (blob.size > 1024) return blob;
  }
  throw new Error('Die Videoaufnahme im Browser lieferte keine Daten – bitte einen anderen Browser (Chrome, Edge, Firefox) verwenden.');
}

async function renderWith(img: HTMLImageElement, o: RenderOpts, mime: string): Promise<Blob> {
  const [aw, ah] = o.aspect.split(':').map(Number);
  const H = o.height || 720;
  const W = Math.round((H * aw) / ah / 2) * 2;
  const fps = o.fps || 30;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const stream = canvas.captureStream(0);
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
  const chunks: BlobPart[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise<Blob>((resolve) => {
    rec.onstop = () => resolve(new Blob(chunks, { type: mime.split(';')[0] }));
  });

  // „Cover“-Skalierung des Bildes auf das Ausgabeformat
  const cover = Math.max(W / img.width, H / img.height);
  const dw = img.width * cover;
  const dh = img.height * cover;
  // Quelle einmalig rastern (bis 2× Ausgabegröße für scharfe Zooms) – spart pro Frame das Neu-Dekodieren (v. a. bei SVG)
  const srcScale = Math.min(2, Math.max(1, Math.min(img.width / dw, 4096 / Math.max(dw, dh))));
  const src = document.createElement('canvas');
  src.width = Math.round(dw * srcScale);
  src.height = Math.round(dh * srcScale);
  src.getContext('2d')!.drawImage(img, 0, 0, src.width, src.height);
  // Vignette einmalig vorberechnen
  const vig = document.createElement('canvas');
  vig.width = W;
  vig.height = H;
  const vctx = vig.getContext('2d')!;
  const vg = vctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.35)');
  vctx.fillStyle = vg;
  vctx.fillRect(0, 0, W, H);
  const grainCanvas = document.createElement('canvas');
  grainCanvas.width = 160;
  grainCanvas.height = 90;
  const gctx = grainCanvas.getContext('2d')!;

  function draw(t: number, time: number) {
    const k = motionAt(o.motion, t, time);
    ctx.save();
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    ctx.translate(W / 2, H / 2);
    ctx.rotate((k.r * Math.PI) / 180);
    ctx.scale(k.z * k.sx, k.z);
    ctx.translate(-k.x * W, -k.y * H);
    const blur = (o.motion.blur || 0) * Math.sin(Math.PI * t);
    if (blur > 0.3) ctx.filter = `blur(${blur.toFixed(1)}px)`;
    // Bild etwas größer zeichnen, damit Rotationen keine Ränder zeigen
    const pad = 1 + Math.min(0.5, Math.abs(k.r) / 60);
    ctx.drawImage(src, (-dw * pad) / 2, (-dh * pad) / 2, dw * pad, dh * pad);
    ctx.restore();
    ctx.filter = 'none';
    applyFx(t, time);
  }

  function applyFx(t: number, time: number) {
    switch (o.fx) {
      case 'flash': {
        const a = Math.max(0, 1 - Math.abs(t - 0.5) * 8);
        if (a > 0) {
          ctx.fillStyle = `rgba(255,240,220,${a * 0.85})`;
          ctx.fillRect(0, 0, W, H);
        }
        break;
      }
      case 'fade': {
        ctx.fillStyle = `rgba(0,0,0,${Math.max(0, (t - 0.6) / 0.4) * 0.9})`;
        ctx.fillRect(0, 0, W, H);
        break;
      }
      case 'glitch': {
        if (Math.floor(time * 12) % 5 === 0) {
          for (let i = 0; i < 6; i++) {
            const y = Math.random() * H;
            const h = 4 + Math.random() * 30;
            const dx = (Math.random() - 0.5) * 60;
            ctx.drawImage(canvas, 0, y, W, h, dx, y, W, h);
          }
          ctx.globalCompositeOperation = 'screen';
          ctx.fillStyle = 'rgba(255,0,80,0.08)';
          ctx.fillRect(4, 0, W, H);
          ctx.fillStyle = 'rgba(0,200,255,0.08)';
          ctx.fillRect(-4, 0, W, H);
          ctx.globalCompositeOperation = 'source-over';
        }
        break;
      }
      case 'chroma': {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.18;
        ctx.drawImage(canvas, 3, 0);
        ctx.drawImage(canvas, -3, 0);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = 'rgba(0,0,0,0.08)';
        for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 1);
        break;
      }
      case 'leak': {
        const g = ctx.createRadialGradient(W * (0.2 + 0.6 * t), H * 0.2, 0, W * (0.2 + 0.6 * t), H * 0.2, W * 0.7);
        g.addColorStop(0, 'rgba(255,170,80,0.35)');
        g.addColorStop(1, 'rgba(255,80,120,0)');
        ctx.globalCompositeOperation = 'screen';
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
        ctx.globalCompositeOperation = 'source-over';
        break;
      }
      case 'pulse': {
        const a = (Math.sin(time * 6) * 0.5 + 0.5) * 0.12;
        ctx.fillStyle = `rgba(180,140,255,${a})`;
        ctx.fillRect(0, 0, W, H);
        break;
      }
      case 'grain': {
        const id = gctx.createImageData(160, 90);
        for (let i = 0; i < id.data.length; i += 4) {
          const v = Math.random() * 255;
          id.data[i] = id.data[i + 1] = id.data[i + 2] = v;
          id.data[i + 3] = 28;
        }
        gctx.putImageData(id, 0, 0);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(grainCanvas, 0, 0, W, H);
        ctx.imageSmoothingEnabled = true;
        break;
      }
    }
    // dezente Vignette für Kino-Look
    ctx.drawImage(vig, 0, 0);
  }

  // Frames exakt takten: jedes Bild wird gezeichnet und explizit in den Stream geschoben
  const track = stream.getVideoTracks()[0] as MediaStreamTrack & { requestFrame?: () => void };
  const frames = Math.max(2, Math.round(o.duration * fps));
  draw(0, 0);
  rec.start(250);
  const t0 = performance.now();
  for (let i = 0; i <= frames; i++) {
    const t = i / frames;
    draw(t, i / fps);
    track.requestFrame?.();
    o.onProgress?.(t);
    const due = t0 + ((i + 1) * 1000) / fps;
    await new Promise((r) => setTimeout(r, Math.max(0, due - performance.now())));
  }
  // letzten Frame sicher in den Stream bringen
  await new Promise((r) => setTimeout(r, 250));
  rec.stop();
  stream.getTracks().forEach((tr) => tr.stop());
  return done;
}

/** Letztes (oder beliebiges) Einzelbild eines Videos als PNG – für „Video verlängern“ */
export function captureFrame(videoUrl: string, at: 'last' | number = 'last'): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.crossOrigin = 'anonymous';
    v.muted = true;
    v.preload = 'auto';
    v.src = videoUrl;
    v.onloadedmetadata = () => {
      v.currentTime = at === 'last' ? Math.max(0, v.duration - 0.05) : at;
    };
    v.onseeked = () => {
      const c = document.createElement('canvas');
      c.width = v.videoWidth;
      c.height = v.videoHeight;
      c.getContext('2d')!.drawImage(v, 0, 0);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('Frame konnte nicht erfasst werden'))), 'image/png');
    };
    v.onerror = () => reject(new Error('Video konnte nicht geladen werden'));
  });
}
