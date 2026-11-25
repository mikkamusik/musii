import type { MediaInput, ProviderOutput } from '../files.js';
import { httpJson, poll, ProviderError } from '../util.js';
import type { ProviderAdapter, RunCtx } from './types.js';
import { nearestAspect, nearestDuration } from './types.js';

const BASE = 'https://api.dev.runwayml.com/v1';
const VERSION = '2024-11-06';

function uri(m: MediaInput) {
  return m.publicUrl() || m.dataUri();
}

async function task(ctx: RunCtx, path: string, body: Record<string, unknown>): Promise<ProviderOutput[]> {
  const base = (ctx.conn.baseUrl || BASE).replace(/\/$/, '');
  const headers = { Authorization: `Bearer ${ctx.apiKey}`, 'X-Runway-Version': VERSION };
  const created = await httpJson(`${base}${path}`, { json: body, headers, signal: ctx.signal });
  if (!created?.id) throw new ProviderError('Keine Task-ID von Runway');
  const done = await poll(
    async () => {
      const t = await httpJson(`${base}/tasks/${created.id}`, { headers, signal: ctx.signal });
      if (t.status === 'SUCCEEDED') return t;
      if (t.status === 'FAILED' || t.status === 'CANCELLED') throw new ProviderError(t.failure || t.failureCode || 'Runway-Task fehlgeschlagen', undefined, false);
      ctx.progress(t.progress != null ? `Rendert … ${Math.round(t.progress * 100)}%` : t.status === 'PENDING' ? 'Wartet …' : 'Rendert …');
      return undefined;
    },
    { intervalMs: 5000, signal: ctx.signal },
  );
  const out = (done.output || []).map((u: string) => ({ url: u }));
  if (!out.length) throw new ProviderError('Runway lieferte keine Datei');
  return out;
}

export const runwayAdapter: ProviderAdapter = {
  info: {
    type: 'runway',
    label: 'Runway',
    description: 'Gen-4 Turbo Bild-zu-Video, Gen-4 Image mit Referenzen (Charakter-Konsistenz) und Video-Upscaling.',
    website: 'https://dev.runwayml.com',
    keyUrl: 'https://dev.runwayml.com',
    tasks: ['text-to-image', 'image-to-video', 'upscale-video'],
    needsKey: true,
    baseUrl: { default: BASE },
  },
  async run(ctx) {
    const { model, req } = ctx;
    switch (model.task) {
      case 'image-to-video': {
        if (!req.image) throw new ProviderError('Runway benötigt ein Startbild', 400, false);
        const promptImage: unknown =
          req.endImage && model.features?.endFrame
            ? [
                { uri: uri(req.image), position: 'first' },
                { uri: uri(req.endImage), position: 'last' },
              ]
            : uri(req.image);
        return task(ctx, '/image_to_video', {
          model: model.model,
          promptImage,
          promptText: req.prompt.slice(0, 1000),
          ratio: nearestAspect(req.aspectRatio, ['1280:720', '720:1280', '1104:832', '832:1104', '960:960', '1584:672']),
          duration: nearestDuration(req.duration, [5, 10]),
          ...(req.seed != null ? { seed: req.seed } : {}),
          ...model.params,
          ...req.extraParams,
        });
      }
      case 'text-to-image': {
        const refs = req.refImages.slice(0, 3).map((r, i) => ({ uri: uri(r), tag: `ref${i + 1}` }));
        let prompt = req.prompt;
        if (refs.length && !/@ref\d/.test(prompt)) prompt = `${prompt} (featuring ${refs.map((r) => '@' + r.tag).join(', ')})`;
        return task(ctx, '/text_to_image', {
          model: model.model,
          promptText: prompt.slice(0, 1000),
          ratio: nearestAspect(req.aspectRatio, ['1920:1080', '1080:1920', '1024:1024', '1360:768', '1168:880', '1440:1080', '1080:1440', '1808:768', '2112:912']),
          ...(refs.length ? { referenceImages: refs } : {}),
          ...(req.seed != null ? { seed: req.seed } : {}),
          ...model.params,
          ...req.extraParams,
        });
      }
      case 'upscale-video': {
        if (!req.video) throw new ProviderError('Bitte ein Video wählen', 400, false);
        return task(ctx, '/video_upscale', { model: model.model, videoUri: uri(req.video), ...model.params });
      }
      default:
        throw new ProviderError(`Runway unterstützt ${model.task} nicht`, 400, false);
    }
  },
  async test(conn, apiKey) {
    const j = await httpJson(`${(conn.baseUrl || BASE).replace(/\/$/, '')}/organization`, {
      headers: { Authorization: `Bearer ${apiKey}`, 'X-Runway-Version': VERSION },
      timeoutMs: 20_000,
    });
    return `Verbunden – Guthaben: ${j?.creditBalance ?? '?'} Credits`;
  },
};
