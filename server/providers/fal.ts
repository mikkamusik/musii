import type { MediaInput, ProviderOutput } from '../files.js';
import { collectUrls, httpJson, poll, ProviderError } from '../util.js';
import { buildGenericInput } from './generic-input.js';
import type { ProviderAdapter, RunCtx } from './types.js';

const QUEUE = 'https://queue.fal.run';

async function fileRef(m: MediaInput): Promise<string> {
  return m.publicUrl() || m.dataUri();
}

function extractOutputs(result: any): ProviderOutput[] {
  const out: ProviderOutput[] = [];
  const push = (v: any) => {
    if (!v) return;
    if (typeof v === 'string') out.push({ url: v });
    else if (v.url) out.push({ url: v.url, mime: v.content_type });
  };
  if (Array.isArray(result?.images)) result.images.forEach(push);
  push(result?.image);
  push(result?.video);
  if (Array.isArray(result?.videos)) result.videos.forEach(push);
  push(result?.audio);
  push(result?.audio_file);
  push(result?.audio_url);
  push(result?.output);
  if (!out.length) collectUrls(result).forEach((u) => out.push({ url: u }));
  return out;
}

export const falAdapter: ProviderAdapter = {
  info: {
    type: 'fal',
    label: 'fal.ai',
    description:
      'Schnellste Plattform für Video-KI: Kling, Veo, Hailuo, Seedance, Wan, Flux, Seedream, Nano Banana, Lipsync, Upscaler. Eigene Modelle per Endpoint-ID (z. B. fal-ai/…) hinzufügen.',
    website: 'https://fal.ai',
    keyUrl: 'https://fal.ai/dashboard/keys',
    tasks: ['text-to-image', 'image-edit', 'text-to-video', 'image-to-video', 'lipsync', 'upscale-image', 'upscale-video', 'remove-bg', 'tts', 'music', 'sfx'],
    needsKey: true,
    baseUrl: { default: QUEUE },
  },
  async run(ctx: RunCtx) {
    const { model, req, apiKey, signal } = ctx;
    const input = await buildGenericInput(req, model, 'fal', fileRef);
    const base = (ctx.conn.baseUrl || QUEUE).replace(/\/$/, '');
    const auth = { Authorization: `Key ${apiKey}` };
    const sub = await httpJson(`${base}/${model.model}`, { json: input, headers: auth, signal, timeoutMs: 120_000 });
    if (sub?.images || sub?.video || sub?.image) return extractOutputs(sub); // synchroner Endpunkt
    const statusUrl = sub?.status_url;
    const responseUrl = sub?.response_url;
    if (!statusUrl || !responseUrl) throw new ProviderError('Ungültige Antwort der fal-Warteschlange');
    await poll(
      async () => {
        const s = await httpJson(statusUrl, { headers: auth, signal });
        if (s.status === 'COMPLETED') {
          if (s.error) throw new ProviderError(String(s.error), undefined, false);
          return true;
        }
        if (s.status === 'IN_QUEUE') ctx.progress(`In der Warteschlange${s.queue_position != null ? ` (Position ${s.queue_position})` : ''} …`);
        else ctx.progress('Rendert …');
        return undefined;
      },
      { intervalMs: 3000, signal },
    );
    const result = await httpJson(responseUrl, { headers: auth, signal });
    const out = extractOutputs(result);
    if (!out.length) throw new ProviderError('fal.ai lieferte keine Datei');
    return out;
  },
  async test(_conn, apiKey) {
    // Leichter Testaufruf: Status einer nicht existierenden Anfrage -> 404 bei gültigem Schlüssel, 401 bei ungültigem
    const res = await fetch(`${QUEUE}/fal-ai/flux/requests/00000000-0000-0000-0000-000000000000/status`, {
      headers: { Authorization: `Key ${apiKey}` },
    });
    if (res.status === 401 || res.status === 403) throw new ProviderError('Schlüssel ungültig', res.status, false);
    return 'Verbunden – Schlüssel akzeptiert';
  },
};
