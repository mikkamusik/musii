import type { ProviderOutput } from '../files.js';
import type { Connection, ModelDef, Task } from '../types.js';
import { http, httpJson, ProviderError, sleep } from '../util.js';
import { chatCompletion } from './openai.js';
import type { LlmCall, ProviderAdapter, RunCtx } from './types.js';
import { dimsFor, parseAspect } from './types.js';

/**
 * Pollinations.ai
 * - Classic-API: kostenlos ohne Anmeldung (Bilder & Text, gedrosselt ~1 Anfrage / 45 s, max. ~768×768)
 * - Gen-API (gen.pollinations.ai) mit sk_-Schlüssel: viele aktuelle Bild-, Video- und Audiomodelle,
 *   abgerechnet in „Pollen“ (je nach Konto-Stufe mit täglichem Gratis-Guthaben)
 */
const CLASSIC_IMG = 'https://image.pollinations.ai/prompt/';
const CLASSIC_TXT = 'https://text.pollinations.ai/';
const GEN = 'https://gen.pollinations.ai';

/** Bild-URL der Classic-API (max. 768×768 Fläche) */
export function classicImageUrl(prompt: string, aspect?: string, seed?: number): string {
  const [aw, ah] = parseAspect(aspect || '1:1');
  const area = 768 * 768;
  const w = Math.round(Math.sqrt((area * aw) / ah) / 16) * 16;
  const h = Math.round(area / w / 16) * 16;
  const qs = new URLSearchParams({ width: String(w), height: String(h), nologo: 'true', seed: String(seed ?? Math.floor(Math.random() * 1e9)) });
  return `${CLASSIC_IMG}${encodeURIComponent(prompt.slice(0, 1500))}?${qs}`;
}

async function classicWithRetry(url: string, ctx: RunCtx): Promise<Response> {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      return await http(url, { signal: ctx.signal, timeoutMs: 3 * 60_000 });
    } catch (e) {
      const status = (e as ProviderError).status;
      // 503 = kurz ausgelastet (Retry nach ~10 s), 402/429 = Gratis-Drosselung (~45 s)
      if ((status === 402 || status === 429 || status === 503) && attempt < 5) {
        const wait = status === 503 ? 12_000 : 46_000;
        ctx.progress(`Gratis-Kontingent ausgelastet – neuer Versuch in ${Math.round(wait / 1000)} s …`);
        await sleep(wait, ctx.signal);
        continue;
      }
      throw e;
    }
  }
  throw new ProviderError('Pollinations ist gerade ausgelastet');
}

function genQuality(name: string, kind: 'image' | 'video'): number {
  const n = name.toLowerCase();
  const table: [RegExp, number][] =
    kind === 'image'
      ? [
          [/gpt-image-2/, 93],
          [/nano-banana|gemini.*image/, 92],
          [/flux\.2-pro|flux-2-pro/, 91],
          [/seedream-5|seedream-4/, 90],
          [/ideogram/, 88],
          [/kontext/, 88],
          [/z-image/, 86],
          [/grok-imagine/, 85],
          [/gpt-image-1/, 86],
          [/flux\.1-schnell|flux-schnell/, 78],
        ]
      : [
          [/kling-v4|kling-v3/, 94],
          [/veo-3/, 93],
          [/seedance-2/, 93],
          [/wan-2\.7|wan-2\.[5-9]/, 88],
          [/ltx-2/, 85],
          [/grok-imagine/, 85],
        ];
  return table.find(([re]) => re.test(n))?.[1] ?? (kind === 'image' ? 76 : 80);
}

export const pollinationsAdapter: ProviderAdapter = {
  info: {
    type: 'pollinations',
    label: 'Pollinations.ai (gratis)',
    description:
      'Ohne Anmeldung sofort nutzbar: kostenlose Bilder und Text über die Classic-API. Mit kostenlosem Konto (sk_-Schlüssel) zusätzlich aktuelle Bild-, Video- und Stimmmodelle über die Gen-API.',
    website: 'https://pollinations.ai',
    keyUrl: 'https://enter.pollinations.ai/keys',
    tasks: ['text-to-image', 'image-edit', 'text-to-video', 'image-to-video', 'tts', 'llm'],
    needsKey: false,
  },
  async run(ctx) {
    const { model, req, apiKey, signal } = ctx;
    // ---------- Classic (ohne Schlüssel) ----------
    if (model.model === 'classic') {
      const count = Math.max(1, Math.min(req.count || 1, 4));
      const out: ProviderOutput[] = [];
      for (let i = 0; i < count; i++) {
        if (i > 0) {
          ctx.progress(`Bild ${i + 1}/${count} – Gratis-Drosselung, kurze Pause …`);
          await sleep(46_000, signal);
        }
        const res = await classicWithRetry(classicImageUrl(req.prompt, req.aspectRatio, req.seed != null ? req.seed + i : undefined), ctx);
        out.push({ buffer: Buffer.from(await res.arrayBuffer()), mime: res.headers.get('content-type') || 'image/jpeg' });
      }
      return out;
    }
    // ---------- Gen-API (mit Schlüssel) ----------
    if (!apiKey) throw new ProviderError('Für dieses Pollinations-Modell wird ein kostenloser sk_-Schlüssel benötigt (enter.pollinations.ai)', 400, false);
    const auth = { Authorization: `Bearer ${apiKey}` };
    switch (model.task) {
      case 'text-to-image': {
        const { width, height } = dimsFor(req.aspectRatio, 1);
        const qs = new URLSearchParams({ model: model.model, width: String(width), height: String(height), nologo: 'true' });
        if (req.seed != null) qs.set('seed', String(req.seed));
        const res = await http(`${GEN}/image/${encodeURIComponent(req.prompt.slice(0, 2000))}?${qs}`, { headers: auth, signal, timeoutMs: 5 * 60_000 });
        return [{ buffer: Buffer.from(await res.arrayBuffer()), mime: res.headers.get('content-type') || undefined }];
      }
      case 'image-edit': {
        const img = req.image || req.refImages[0];
        if (!img) throw new ProviderError('Bild fehlt', 400, false);
        const fd = new FormData();
        fd.set('model', model.model);
        fd.set('prompt', req.prompt);
        for (const m of [img, ...req.refImages.filter((r) => r !== img)].slice(0, 4)) fd.append('image', m.blob(), m.filename);
        const j = await httpJson(`${GEN}/v1/images/edits`, { body: fd, headers: auth, signal, timeoutMs: 5 * 60_000 });
        return (j?.data || []).map((d: any) => (d.b64_json ? { b64: d.b64_json } : { url: d.url }));
      }
      case 'text-to-video':
      case 'image-to-video': {
        const qs = new URLSearchParams({ model: model.model, duration: String(req.duration || 5) });
        if (req.aspectRatio) qs.set('aspectRatio', req.aspectRatio);
        if (req.image) {
          const pub = req.image.publicUrl();
          if (!pub) throw new ProviderError('Pollinations lädt Startbilder per URL – bitte unter Einstellungen eine öffentliche URL setzen oder Text-zu-Video nutzen', 400, false);
          qs.set('image', pub);
        }
        ctx.progress('Pollinations rendert das Video …');
        const res = await http(`${GEN}/video/${encodeURIComponent(req.prompt.slice(0, 2000))}?${qs}`, { headers: auth, signal, timeoutMs: 15 * 60_000 });
        return [{ buffer: Buffer.from(await res.arrayBuffer()), mime: res.headers.get('content-type') || 'video/mp4' }];
      }
      case 'tts': {
        const qs = new URLSearchParams({ voice: req.voice || 'nova', model: model.model });
        const res = await http(`${GEN}/audio/${encodeURIComponent(req.prompt.slice(0, 3000))}?${qs}`, { headers: auth, signal });
        return [{ buffer: Buffer.from(await res.arrayBuffer()), mime: res.headers.get('content-type') || 'audio/mpeg' }];
      }
      default:
        throw new ProviderError(`Pollinations: ${model.task} nicht unterstützt`, 400, false);
    }
  },
  async llm(_conn: Connection, apiKey: string, model: ModelDef, call: LlmCall, signal?: AbortSignal) {
    if (model.model !== 'classic-text') {
      return chatCompletion(`${GEN}/v1`, apiKey, model.model, call, { signal });
    }
    // Classic-Text ohne Schlüssel
    const qs = new URLSearchParams({ model: 'openai' });
    if (call.system) qs.set('system', call.system.slice(0, 1500));
    if (call.json) qs.set('json', 'true');
    const res = await http(`${CLASSIC_TXT}${encodeURIComponent(call.prompt.slice(0, 3000))}?${qs}`, { signal, timeoutMs: 120_000 });
    const text = (await res.text()).trim();
    if (!text) throw new ProviderError('Leere Antwort von Pollinations');
    return text;
  },
  async listModels(conn: Connection, apiKey: string) {
    // Gen-Modelle nur anbieten, wenn ein Schlüssel hinterlegt ist
    if (!apiKey) return [];
    const out: ModelDef[] = [];
    const [images, videos] = await Promise.all([
      httpJson<any[]>(`${GEN}/image/models`, { timeoutMs: 15_000 }).catch(() => []),
      httpJson<any[]>(`${GEN}/video/models`, { timeoutMs: 15_000 }).catch(() => []),
    ]);
    const add = (m: any, task: Task, kind: 'image' | 'video', cost: number) => {
      if (m?.paid_only || m?.community) return;
      out.push({
        id: `pollinations:${task}:${m.name}`,
        provider: 'pollinations',
        connectionId: conn.id,
        task,
        label: `${m.title || m.name} (Pollinations)`,
        model: m.name,
        quality: genQuality(m.name, kind),
        speed: 4,
        cost,
        free: 'quota',
        freeNote: 'Pollen-Guthaben – je nach Konto-Stufe mit täglichem Gratis-Kontingent',
        features: { audio: (m.output_modalities || []).includes('audio'), maxRefs: 4, refs: task === 'image-edit' },
      });
    };
    for (const m of images || []) {
      const cost = Number(m?.pricing?.completionImageTokens ?? 0.01) || 0.01;
      add(m, 'text-to-image', 'image', cost);
      if ((m.input_modalities || []).includes('image') && (m.supported_endpoints || []).some((e: string) => e.includes('images'))) add(m, 'image-edit', 'image', cost);
    }
    for (const m of videos || []) {
      const cost = (Number(m?.pricing?.completionVideoSeconds ?? 0.1) || 0.1) * 5;
      add(m, 'text-to-video', 'video', cost);
      if ((m.input_modalities || []).includes('image')) add(m, 'image-to-video', 'video', cost);
    }
    return out;
  },
  async test(_conn, apiKey) {
    if (!apiKey) {
      const res = await fetch(classicImageUrl('test', '1:1', 1).replace(/width=\d+&height=\d+/, 'width=64&height=64'), { method: 'GET' });
      if (!res.ok) throw new ProviderError(`Classic-API antwortete mit ${res.status}`, res.status);
      return 'Classic-API erreichbar – Gratis-Bilder ohne Anmeldung aktiv';
    }
    const models = await httpJson<any[]>(`${GEN}/image/models`, { headers: { Authorization: `Bearer ${apiKey}` }, timeoutMs: 20_000 });
    return `Verbunden – ${models.length} Bildmodelle über die Gen-API`;
  },
};
