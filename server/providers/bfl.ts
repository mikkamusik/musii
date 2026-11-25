import { httpJson, poll, ProviderError } from '../util.js';
import type { ProviderAdapter } from './types.js';
import { nearestAspect } from './types.js';

const BASE = 'https://api.bfl.ai/v1';

export const bflAdapter: ProviderAdapter = {
  info: {
    type: 'bfl',
    label: 'Black Forest Labs (FLUX)',
    description: 'FLUX direkt vom Hersteller: FLUX 1.1 Pro Ultra (fotorealistisch) und FLUX Kontext (Bildbearbeitung per Anweisung).',
    website: 'https://bfl.ai',
    keyUrl: 'https://api.bfl.ai',
    tasks: ['text-to-image', 'image-edit'],
    needsKey: true,
    baseUrl: { default: BASE },
  },
  async run(ctx) {
    const { model, req, apiKey, signal } = ctx;
    const base = (ctx.conn.baseUrl || BASE).replace(/\/$/, '');
    const body: Record<string, unknown> = {
      prompt: req.prompt,
      aspect_ratio: nearestAspect(req.aspectRatio, ['21:9', '16:9', '3:2', '4:3', '1:1', '3:4', '2:3', '9:16', '9:21']),
      output_format: 'png',
      ...(req.seed != null ? { seed: req.seed } : {}),
      ...model.params,
      ...req.extraParams,
    };
    if (model.task === 'image-edit') {
      const img = req.image || req.refImages[0];
      if (!img) throw new ProviderError('FLUX Kontext benötigt ein Eingabebild', 400, false);
      body.input_image = img.base64();
      req.refImages
        .filter((r) => r !== img)
        .slice(0, 3)
        .forEach((r, i) => (body[`input_image_${i + 2}`] = r.base64()));
    }
    const sub = await httpJson(`${base}/${model.model}`, { json: body, headers: { 'x-key': apiKey }, signal });
    const pollingUrl = sub?.polling_url || (sub?.id ? `${base}/get_result?id=${sub.id}` : '');
    if (!pollingUrl) throw new ProviderError('Keine Auftrags-ID von BFL');
    const res = await poll(
      async () => {
        const s = await httpJson(pollingUrl, { headers: { 'x-key': apiKey }, signal });
        if (s.status === 'Ready') return s;
        if (['Error', 'Failed', 'Content Moderated', 'Request Moderated', 'Task not found'].includes(s.status)) {
          throw new ProviderError(`FLUX: ${s.status}${s.details ? ' – ' + JSON.stringify(s.details) : ''}`, undefined, false);
        }
        ctx.progress(s.status === 'Pending' ? 'Rendert …' : String(s.status));
        return undefined;
      },
      { intervalMs: 1500, signal },
    );
    const url = res?.result?.sample;
    if (!url) throw new ProviderError('FLUX lieferte kein Bild');
    return [{ url }];
  },
  async test() {
    return 'Schlüssel gespeichert – wird beim ersten Bild geprüft';
  },
};
