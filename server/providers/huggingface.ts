import { http, httpJson, ProviderError } from '../util.js';
import { chatCompletion } from './openai.js';
import type { ProviderAdapter } from './types.js';
import { dimsFor } from './types.js';

const BASE = 'https://router.huggingface.co';

export const huggingfaceAdapter: ProviderAdapter = {
  info: {
    type: 'huggingface',
    label: 'Hugging Face',
    description: 'Inference Providers: offene Bildmodelle (FLUX, SDXL …) und Sprachmodelle über den HF-Router.',
    website: 'https://huggingface.co',
    keyUrl: 'https://huggingface.co/settings/tokens',
    tasks: ['text-to-image', 'llm'],
    needsKey: true,
    baseUrl: { default: BASE },
  },
  async run(ctx) {
    const { model, req, apiKey, signal } = ctx;
    if (model.task !== 'text-to-image') throw new ProviderError('Hugging Face: nur Text-zu-Bild', 400, false);
    const base = (ctx.conn.baseUrl || BASE).replace(/\/$/, '');
    const { width, height } = dimsFor(req.aspectRatio, 1);
    const res = await http(`${base}/hf-inference/models/${model.model}`, {
      json: {
        inputs: req.prompt,
        parameters: { width, height, ...(req.negativePrompt ? { negative_prompt: req.negativePrompt } : {}), ...model.params, ...req.extraParams },
      },
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'image/png' },
      signal,
      timeoutMs: 5 * 60_000,
    });
    return [{ buffer: Buffer.from(await res.arrayBuffer()), mime: res.headers.get('content-type') || 'image/png' }];
  },
  async llm(conn, apiKey, model, call, signal) {
    return chatCompletion(`${(conn.baseUrl || BASE).replace(/\/$/, '')}/v1`, apiKey, model.model, call, { signal });
  },
  async test(_conn, apiKey) {
    const j = await httpJson('https://huggingface.co/api/whoami-v2', { headers: { Authorization: `Bearer ${apiKey}` }, timeoutMs: 20_000 });
    return `Verbunden als ${j?.name || 'HF-Nutzer'}`;
  },
};
