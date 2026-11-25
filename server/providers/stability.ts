import type { ProviderOutput } from '../files.js';
import { http, httpJson, ProviderError } from '../util.js';
import type { ProviderAdapter, RunCtx } from './types.js';
import { nearestAspect } from './types.js';

const BASE = 'https://api.stability.ai';

async function call(ctx: RunCtx, path: string, fields: Record<string, string | Blob | undefined>): Promise<ProviderOutput[]> {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === '') continue;
    if (v instanceof Blob) fd.set(k, v, k + '.png');
    else fd.set(k, v);
  }
  const res = await http(`${(ctx.conn.baseUrl || BASE).replace(/\/$/, '')}${path}`, {
    body: fd,
    headers: { Authorization: `Bearer ${ctx.apiKey}`, Accept: 'image/*' },
    signal: ctx.signal,
    timeoutMs: 5 * 60_000,
  });
  const buf = Buffer.from(await res.arrayBuffer());
  return [{ buffer: buf, mime: res.headers.get('content-type') || 'image/png' }];
}

export const stabilityAdapter: ProviderAdapter = {
  info: {
    type: 'stability',
    label: 'Stability AI',
    description: 'Stable Image Ultra / SD 3.5, Inpainting mit Maske, Freistellen und Upscaling.',
    website: 'https://platform.stability.ai',
    keyUrl: 'https://platform.stability.ai/account/keys',
    tasks: ['text-to-image', 'image-edit', 'upscale-image', 'remove-bg'],
    needsKey: true,
    baseUrl: { default: BASE },
  },
  async run(ctx) {
    const { model, req } = ctx;
    const extra = Object.fromEntries(Object.entries({ ...model.params, ...req.extraParams }).map(([k, v]) => [k, String(v)]));
    switch (model.task) {
      case 'text-to-image':
        return call(ctx, model.model, {
          prompt: req.prompt,
          negative_prompt: req.negativePrompt,
          aspect_ratio: nearestAspect(req.aspectRatio, ['16:9', '1:1', '21:9', '2:3', '3:2', '4:5', '5:4', '9:16', '9:21']),
          seed: req.seed != null ? String(req.seed) : undefined,
          output_format: 'png',
          ...extra,
        });
      case 'image-edit': {
        if (!req.image) throw new ProviderError('Bitte ein Bild wählen', 400, false);
        if (req.mask) {
          return call(ctx, '/v2beta/stable-image/edit/inpaint', {
            image: req.image.blob(),
            mask: req.mask.blob(),
            prompt: req.prompt,
            negative_prompt: req.negativePrompt,
            output_format: 'png',
            ...extra,
          });
        }
        return call(ctx, '/v2beta/stable-image/control/structure', {
          image: req.image.blob(),
          prompt: req.prompt,
          negative_prompt: req.negativePrompt,
          control_strength: '0.6',
          output_format: 'png',
          ...extra,
        });
      }
      case 'upscale-image':
        if (!req.image) throw new ProviderError('Bitte ein Bild wählen', 400, false);
        return call(ctx, model.model, { image: req.image.blob(), output_format: 'png', ...extra });
      case 'remove-bg':
        if (!req.image) throw new ProviderError('Bitte ein Bild wählen', 400, false);
        return call(ctx, model.model, { image: req.image.blob(), output_format: 'png', ...extra });
      default:
        throw new ProviderError(`Stability unterstützt ${model.task} nicht`, 400, false);
    }
  },
  async test(conn, apiKey) {
    const j = await httpJson(`${(conn.baseUrl || BASE).replace(/\/$/, '')}/v1/user/balance`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeoutMs: 20_000,
    });
    return `Verbunden – Guthaben: ${j?.credits ?? '?'} Credits`;
  },
};
