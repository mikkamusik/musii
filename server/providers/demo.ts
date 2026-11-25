import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ProviderOutput } from '../files.js';
import { ProviderError, sleep } from '../util.js';
import type { ProviderAdapter, RunCtx } from './types.js';
import { dimsFor } from './types.js';

/**
 * Demo-Provider: funktioniert komplett offline ohne Schlüssel.
 * Erzeugt prozedurale Bilder (SVG), synthetisierte Audiodateien (WAV)
 * und – falls ffmpeg installiert ist – echte Videos mit Kamerafahrt.
 */

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed: number) {
  let s = seed || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function wrap(text: string, max: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > max) {
      if (cur) lines.push(cur);
      cur = w;
    } else cur = (cur + ' ' + w).trim();
    if (lines.length >= 3) break;
  }
  if (cur && lines.length < 4) lines.push(cur);
  return lines;
}

export function demoSvg(prompt: string, aspect?: string, seed = 0, inputDataUri?: string, mode = 'gen'): string {
  const { width, height } = dimsFor(aspect, 0.6);
  const r = rng(hash(prompt) + seed * 7919);
  const hue = Math.floor(r() * 360);
  const hue2 = (hue + 40 + Math.floor(r() * 120)) % 360;
  const blobs = Array.from({ length: 7 }, () => ({
    cx: r() * width,
    cy: r() * height,
    rad: (0.15 + r() * 0.35) * Math.min(width, height),
    h: (hue + Math.floor(r() * 160)) % 360,
    o: 0.35 + r() * 0.4,
  }));
  const lines = wrap(prompt || 'MUSII Studio', Math.max(24, Math.floor(width / 22)));
  const fs = Math.round(Math.min(width, height) / 22);
  const label =
    mode === 'edit' ? 'DEMO · Bearbeitung' : mode === 'upscale' ? 'DEMO · Upscale' : mode === 'bg' ? 'DEMO · Freigestellt' : 'DEMO · offline erzeugt';
  const filter =
    mode === 'edit'
      ? `<filter id="fx"><feColorMatrix type="hueRotate" values="${Math.floor(r() * 300) + 30}"/></filter>`
      : mode === 'upscale'
        ? `<filter id="fx"><feConvolveMatrix order="3" kernelMatrix="0 -1 0 -1 5 -1 0 -1 0"/></filter>`
        : `<filter id="fx"><feColorMatrix type="saturate" values="1"/></filter>`;
  const checker =
    mode === 'bg'
      ? `<pattern id="chk" width="32" height="32" patternUnits="userSpaceOnUse"><rect width="16" height="16" fill="#ddd"/><rect x="16" y="16" width="16" height="16" fill="#ddd"/><rect x="16" width="16" height="16" fill="#fff"/><rect y="16" width="16" height="16" fill="#fff"/></pattern>`
      : '';
  const body = inputDataUri
    ? `${mode === 'bg' ? `<rect width="100%" height="100%" fill="url(#chk)"/>` : ''}
       <image href="${inputDataUri}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice" filter="url(#fx)" ${mode === 'bg' ? 'clip-path="url(#cp)"' : ''}/>`
    : `<rect width="100%" height="100%" fill="url(#bg)"/>
       ${blobs.map((b) => `<circle cx="${b.cx.toFixed(0)}" cy="${b.cy.toFixed(0)}" r="${b.rad.toFixed(0)}" fill="hsl(${b.h} 85% 60%)" opacity="${b.o.toFixed(2)}" filter="url(#blur)"/>`).join('\n')}
       <rect width="100%" height="100%" fill="url(#vig)"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="hsl(${hue} 70% 18%)"/><stop offset="1" stop-color="hsl(${hue2} 70% 30%)"/>
    </linearGradient>
    <radialGradient id="vig" cx="50%" cy="45%" r="75%"><stop offset="0.6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.65"/></radialGradient>
    <filter id="blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${(Math.min(width, height) / 14).toFixed(0)}"/></filter>
    ${filter}${checker}
    <clipPath id="cp"><ellipse cx="${width / 2}" cy="${height / 2}" rx="${width * 0.36}" ry="${height * 0.42}"/></clipPath>
  </defs>
  ${body}
  <g font-family="Inter, Helvetica, Arial, sans-serif" fill="#fff">
    <rect x="${fs}" y="${fs}" rx="${fs / 2}" width="${label.length * fs * 0.56 + fs}" height="${fs * 1.6}" fill="#000" opacity="0.45"/>
    <text x="${fs * 1.5}" y="${fs * 2.1}" font-size="${fs * 0.8}" font-weight="600" letter-spacing="1">${esc(label)}</text>
    ${lines
      .map(
        (l, i) =>
          `<text x="${fs}" y="${height - fs * (lines.length - i) * 1.35}" font-size="${fs}" font-weight="500" opacity="0.92" style="paint-order:stroke" stroke="#000" stroke-opacity="0.35" stroke-width="${fs / 8}">${esc(l)}</text>`,
      )
      .join('\n')}
  </g>
</svg>`;
}

function wav(samples: Float32Array, sampleRate: number): Buffer {
  const pcm = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767 * 0.8), i * 2);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export function demoAudio(kind: 'tts' | 'sfx' | 'music', text: string, duration?: number): Buffer {
  const sr = 22050;
  const secs = kind === 'tts' ? Math.min(20, Math.max(1.5, text.split(/\s+/).length * 0.38)) : Math.min(30, duration || (kind === 'sfx' ? 3 : 12));
  const n = Math.floor(sr * secs);
  const out = new Float32Array(n);
  const r = rng(hash(text));
  if (kind === 'tts') {
    // Silben-ähnliche, formant-artige Modulation
    const base = 120 + r() * 80;
    let phase = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const syl = Math.floor(t * 4.2);
      const sylT = t * 4.2 - syl;
      const env = Math.sin(Math.PI * Math.min(1, sylT * 1.1)) * (hash(text + syl) % 7 === 0 ? 0 : 1);
      const f = base * (1 + 0.12 * Math.sin(t * 2.3) + ((hash(text + syl) % 5) - 2) * 0.04);
      phase += (2 * Math.PI * f) / sr;
      const formant = Math.sin(phase) * 0.5 + Math.sin(phase * 2.01) * 0.3 + Math.sin(phase * 3.02) * 0.15;
      out[i] = formant * env * 0.6;
    }
  } else if (kind === 'sfx') {
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const env = Math.exp(-t * (1.5 + r() * 0.01)) * (t < 0.02 ? t / 0.02 : 1);
      lp = lp * 0.92 + (Math.random() * 2 - 1) * 0.08;
      out[i] = (lp * 3 + Math.sin(2 * Math.PI * (80 + 400 * Math.exp(-t * 3)) * t) * 0.4) * env;
    }
  } else {
    const scale = [0, 3, 5, 7, 10, 12, 15];
    const root = 196 * Math.pow(2, Math.floor(r() * 5) / 12);
    const bpm = 96 + Math.floor(r() * 40);
    const step = 60 / bpm / 2;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const k = Math.floor(t / step);
      const noteT = t - k * step;
      const deg = scale[hash(text + (k % 16)) % scale.length];
      const f = root * Math.pow(2, deg / 12);
      const env = Math.exp(-noteT * 6);
      const bass = Math.sin(2 * Math.PI * (root / 2) * t) * 0.25 * (Math.floor(t / (step * 4)) % 2 ? 1 : 0.7);
      const kick = noteT < 0.12 && k % 4 === 0 ? Math.sin(2 * Math.PI * 60 * noteT * (1 - noteT * 4)) * 0.6 : 0;
      out[i] = Math.sin(2 * Math.PI * f * t) * env * 0.35 + Math.sin(2 * Math.PI * f * 2 * t) * env * 0.1 + bass + kick;
    }
    // Fade-out
    for (let i = Math.max(0, n - sr); i < n; i++) out[i] *= (n - i) / sr;
  }
  return wav(out, sr);
}

let ffmpegAvailable: boolean | undefined;
export function hasFfmpeg(): boolean {
  if (ffmpegAvailable === undefined) {
    try {
      execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
      ffmpegAvailable = true;
    } catch {
      ffmpegAvailable = false;
    }
  }
  return ffmpegAvailable;
}

function run(cmd: string, args: string[], signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = execFile(cmd, args, { maxBuffer: 1 << 24 }, (err, _o, stderr) => {
      if (err) reject(new ProviderError(`ffmpeg: ${String(stderr).split('\n').slice(-3).join(' ')}`, undefined, false));
      else resolve();
    });
    signal.addEventListener('abort', () => p.kill('SIGKILL'), { once: true });
  });
}

async function demoVideo(ctx: RunCtx): Promise<ProviderOutput[]> {
  if (!hasFfmpeg()) {
    throw new ProviderError(
      'Demo-Videos benötigen ffmpeg auf dem Server. Alternativ: „Local Motion“ im Video-Studio rendert Kamerafahrten kostenlos im Browser.',
      400,
      false,
    );
  }
  const { req } = ctx;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'musii-'));
  const out = path.join(tmp, 'out.mp4');
  const secs = Math.min(10, req.duration || 5);
  const fps = 25;
  const frames = Math.round(secs * fps);
  const portrait = (req.aspectRatio || '16:9').split(':').map(Number).reduce((a, b) => a / b) < 1;
  const W = portrait ? 720 : 1280;
  const H = portrait ? 1280 : 720;
  try {
    const src = req.image && /png|jpe?g|webp/.test(req.image.mime) ? path.join(tmp, 'in.' + req.image.mime.split('/')[1]) : '';
    if (src) fs.writeFileSync(src, req.image!.buffer());
    const cam = (req.camera || [])[0] || 'dolly-in';
    // einfache Kamerafahrten über zoompan
    const z: Record<string, [string, string, string]> = {
      'dolly-in': [`min(1+0.35*on/${frames},1.35)`, 'iw/2-(iw/zoom/2)', 'ih/2-(ih/zoom/2)'],
      'dolly-out': [`max(1.35-0.35*on/${frames},1)`, 'iw/2-(iw/zoom/2)', 'ih/2-(ih/zoom/2)'],
      'crash-zoom': [`min(1+1.2*pow(on/${frames},3),2.2)`, 'iw/2-(iw/zoom/2)', 'ih/2-(ih/zoom/2)'],
      'pan-left': ['1.25', `(iw-iw/zoom)*(1-on/${frames})`, 'ih/2-(ih/zoom/2)'],
      'pan-right': ['1.25', `(iw-iw/zoom)*on/${frames}`, 'ih/2-(ih/zoom/2)'],
      'tilt-up': ['1.25', 'iw/2-(iw/zoom/2)', `(ih-ih/zoom)*(1-on/${frames})`],
      'tilt-down': ['1.25', 'iw/2-(iw/zoom/2)', `(ih-ih/zoom)*on/${frames}`],
    };
    const [zz, xx, yy] = z[cam] || z['dolly-in'];
    const zoompan = `zoompan=z='${zz}':x='${xx}':y='${yy}':d=${frames}:s=${W}x${H}:fps=${fps}`;
    const args = src
      ? ['-y', '-loop', '1', '-i', src, '-vf', `scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase,crop=${W * 2}:${H * 2},${zoompan},format=yuv420p`, '-frames:v', String(frames), '-c:v', 'libx264', '-preset', 'veryfast', '-movflags', '+faststart', out]
      : [
          '-y',
          '-f',
          'lavfi',
          '-i',
          `gradients=s=${W}x${H}:c0=0x${(hash(req.prompt) & 0xffffff).toString(16).padStart(6, '0')}:c1=0x${((hash(req.prompt) >> 4) & 0xffffff).toString(16).padStart(6, '0')}:x0=0:y0=0:x1=${W}:y1=${H}:speed=0.02:rate=${fps}`,
          '-vf',
          `${zoompan.replace(`s=${W}x${H}`, `s=${W}x${H}`)},drawtext=text='DEMO':fontcolor=white@0.8:fontsize=${Math.round(H / 14)}:x=40:y=40,format=yuv420p`,
          '-frames:v',
          String(frames),
          '-c:v',
          'libx264',
          '-preset',
          'veryfast',
          '-movflags',
          '+faststart',
          out,
        ];
    try {
      await run('ffmpeg', args, ctx.signal);
    } catch (e) {
      if (src) throw e;
      // Fallback ohne gradients/drawtext (ältere ffmpeg-Versionen)
      await run(
        'ffmpeg',
        ['-y', '-f', 'lavfi', '-i', `testsrc2=s=${W}x${H}:r=${fps}`, '-vf', 'hue=s=0.6,format=yuv420p', '-frames:v', String(frames), '-c:v', 'libx264', '-preset', 'veryfast', '-movflags', '+faststart', out],
        ctx.signal,
      );
    }
    return [{ buffer: fs.readFileSync(out), mime: 'video/mp4' }];
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

export const demoAdapter: ProviderAdapter = {
  info: {
    type: 'demo',
    label: 'Demo (offline)',
    description: 'Testet alle Abläufe ohne Schlüssel und ohne Kosten: prozedurale Bilder, synthetische Audios und (mit ffmpeg) Videos mit Kamerafahrt.',
    tasks: ['text-to-image', 'image-edit', 'upscale-image', 'remove-bg', 'image-to-video', 'text-to-video', 'tts', 'sfx', 'music', 'llm'],
    needsKey: false,
  },
  async run(ctx) {
    const { model, req } = ctx;
    ctx.progress('Demo rendert …');
    await sleep(600 + Math.random() * 600, ctx.signal);
    const img = req.image && /^image\/(png|jpe?g|webp|svg)/.test(req.image.mime) ? req.image.dataUri() : undefined;
    const seed = req.seed ?? Math.floor(Math.random() * 100000);
    switch (model.task) {
      case 'text-to-image': {
        const n = Math.min(req.count || 1, 4);
        return Array.from({ length: n }, (_, i) => ({
          buffer: Buffer.from(demoSvg(req.prompt, req.aspectRatio, seed + i)),
          mime: 'image/svg+xml',
        }));
      }
      case 'image-edit':
        return [{ buffer: Buffer.from(demoSvg(req.prompt, req.aspectRatio, seed, img || req.refImages[0]?.dataUri(), 'edit')), mime: 'image/svg+xml' }];
      case 'upscale-image':
        return [{ buffer: Buffer.from(demoSvg('Upscale', req.aspectRatio, 0, img, 'upscale')), mime: 'image/svg+xml' }];
      case 'remove-bg':
        return [{ buffer: Buffer.from(demoSvg('', req.aspectRatio, 0, img, 'bg')), mime: 'image/svg+xml' }];
      case 'tts':
      case 'sfx':
      case 'music':
        return [{ buffer: demoAudio(model.task, req.prompt, req.duration), mime: 'audio/wav' }];
      case 'image-to-video':
      case 'text-to-video':
        return demoVideo(ctx);
      default:
        throw new ProviderError(`Demo unterstützt ${model.task} nicht`, 400, false);
    }
  },
  async llm(_conn, _key, _model, call) {
    // Regelbasierter „Prompt-Regisseur“ und „Jury“ für den Offline-Modus
    const src = (call.prompt.split('\n').pop() || call.prompt).trim();
    const looks = [
      'cinematic composition, dramatic volumetric lighting, rich color grading, shallow depth of field, 35mm film look',
      'golden hour backlight, soft haze, warm palette, wide-angle lens, epic scale',
      'moody low-key lighting, neon reflections, teal and orange grade, anamorphic flares',
      'clean studio lighting, high detail, crisp textures, editorial framing',
    ];
    if (call.json && call.images?.length) {
      const n = call.images.length;
      const scores = Array.from({ length: n }, (_, i) => ({
        index: i,
        score: 60 + (hash(src + i) % 35),
        reason: 'Demo-Bewertung (offline): Komposition und Prompt-Treue geschätzt.',
      }));
      const winner = scores.reduce((a, b) => (b.score > a.score ? b : a)).index;
      return JSON.stringify({ scores, winner, summary: 'Offline-Demo-Jury – verbinde Claude, GPT oder Gemini für echte Bewertungen.' });
    }
    if (call.json) return JSON.stringify(looks.map((l) => `${src}, ${l}`));
    if (call.images?.length) return 'a vivid, colorful abstract composition with soft gradients and glowing light orbs, cinematic lighting, high detail';
    return `${src}, ${looks[0]}, highly detailed`;
  },
  async test() {
    return `Bereit${hasFfmpeg() ? ' – ffmpeg gefunden, Demo-Videos aktiv' : ' – ohne ffmpeg (Videos über Local Motion im Browser)'}`;
  },
};
