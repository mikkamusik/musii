import type { MediaInput } from '../files.js';
import { httpJson, poll, ProviderError } from '../util.js';
import type { ProviderAdapter, RunCtx } from './types.js';
import { nearestAspect, nearestDuration } from './types.js';

const BASE = 'https://api.lumalabs.ai/dream-machine/v1';

function needUrl(m: MediaInput): string {
  const u = m.publicUrl();
  if (!u) {
    throw new ProviderError(
      'Luma lädt Bilder nur über öffentliche URLs. Trage unter Verbindungen → Einstellungen eine öffentliche URL (PUBLIC_URL) ein oder nutze fal.ai/Replicate für Luma-Modelle.',
      400,
      false,
    );
  }
  return u;
}

async function generate(ctx: RunCtx, path: string, body: Record<string, unknown>, kind: 'video' | 'image') {
  const base = (ctx.conn.baseUrl || BASE).replace(/\/$/, '');
  const headers = { Authorization: `Bearer ${ctx.apiKey}` };
  const g = await httpJson(`${base}${path}`, { json: body, headers, signal: ctx.signal });
  if (!g?.id) throw new ProviderError('Keine Generierungs-ID von Luma');
  const done = await poll(
    async () => {
      const s = await httpJson(`${base}/generations/${g.id}`, { headers, signal: ctx.signal });
      if (s.state === 'completed') return s;
      if (s.state === 'failed') throw new ProviderError(s.failure_reason || 'Luma-Generierung fehlgeschlagen', undefined, false);
      ctx.progress(s.state === 'queued' ? 'Wartet …' : 'Träumt …');
      return undefined;
    },
    { intervalMs: 5000, signal: ctx.signal },
  );
  const url = done?.assets?.[kind];
  if (!url) throw new ProviderError('Luma lieferte keine Datei');
  return [{ url }];
}

export const lumaAdapter: ProviderAdapter = {
  info: {
    type: 'luma',
    label: 'Luma AI',
    description: 'Ray 2 Video (Start- & Endframe, Loops) und Photon Bilder mit Charakter-Referenz.',
    website: 'https://lumalabs.ai/api',
    keyUrl: 'https://lumalabs.ai/api/keys',
    tasks: ['text-to-image', 'text-to-video', 'image-to-video'],
    needsKey: true,
    baseUrl: { default: BASE },
  },
  async run(ctx) {
    const { model, req } = ctx;
    if (model.task === 'text-to-image') {
      const body: Record<string, unknown> = {
        prompt: req.prompt,
        model: model.model,
        aspect_ratio: nearestAspect(req.aspectRatio, ['1:1', '16:9', '9:16', '4:3', '3:4', '21:9', '9:21']),
        ...model.params,
        ...req.extraParams,
      };
      const refUrls = req.refImages.map((r) => r.publicUrl()).filter(Boolean);
      if (refUrls.length) body.character_ref = { identity0: { images: refUrls.slice(0, 4) } };
      return generate(ctx, '/generations/image', body, 'image');
    }
    const body: Record<string, unknown> = {
      prompt: req.prompt,
      model: model.model,
      aspect_ratio: nearestAspect(req.aspectRatio, ['1:1', '16:9', '9:16', '4:3', '3:4', '21:9', '9:21']),
      duration: `${nearestDuration(req.duration, [5, 9])}s`,
      resolution: req.resolution && /1080|4k|540|720/i.test(req.resolution) ? req.resolution.toLowerCase().replace('p', '') + 'p' : '720p',
      ...model.params,
      ...req.extraParams,
    };
    if (req.image || req.endImage) {
      const keyframes: Record<string, unknown> = {};
      if (req.image) keyframes.frame0 = { type: 'image', url: needUrl(req.image) };
      if (req.endImage) keyframes.frame1 = { type: 'image', url: needUrl(req.endImage) };
      body.keyframes = keyframes;
    }
    return generate(ctx, '/generations', body, 'video');
  },
  async test(conn, apiKey) {
    await httpJson(`${(conn.baseUrl || BASE).replace(/\/$/, '')}/generations?limit=1`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeoutMs: 20_000,
    });
    return 'Verbunden – Schlüssel akzeptiert';
  },
};
