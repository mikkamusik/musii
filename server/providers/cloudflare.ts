import type { ProviderOutput } from '../files.js';
import type { Connection, ModelDef } from '../types.js';
import { http, httpJson, ProviderError } from '../util.js';
import { chatCompletion } from './openai.js';
import type { LlmCall, ProviderAdapter } from './types.js';
import { dimsFor } from './types.js';

/**
 * Cloudflare Workers AI: 10.000 Neuronen pro Tag kostenlos (Reset 00:00 UTC).
 * Bilder (FLUX.1 schnell, Leonardo Phoenix/Lucid Origin), Sprachmodelle, Sprachausgabe.
 */
const API = 'https://api.cloudflare.com/client/v4';

function accountBase(conn: Connection) {
  const acc = String(conn.options?.accountId || '').trim();
  if (!acc) throw new ProviderError('Cloudflare Account-ID fehlt (Dashboard → Workers AI → „REST API verwenden“)', 400, false);
  return `${(conn.baseUrl || API).replace(/\/$/, '')}/accounts/${acc}/ai`;
}

/** Workers AI liefert je nach Modell Binärdaten oder JSON mit Base64 – beides auswerten */
export async function parseCfResponse(res: Response, kind: 'image' | 'audio'): Promise<ProviderOutput[]> {
  const ct = res.headers.get('content-type') || '';
  if (ct.startsWith('image/') || ct.startsWith('audio/') || ct.startsWith('application/octet-stream')) {
    return [{ buffer: Buffer.from(await res.arrayBuffer()), mime: ct.startsWith('application/') ? undefined : ct }];
  }
  const j: any = await res.json();
  if (j?.success === false) throw new ProviderError(j?.errors?.[0]?.message || 'Workers-AI-Fehler', undefined, false);
  const r = j?.result ?? j;
  const b64 = kind === 'image' ? r?.image ?? r?.images?.[0] : r?.audio;
  if (!b64 || typeof b64 !== 'string') throw new ProviderError('Workers AI lieferte keine Datei');
  return [{ b64, mime: kind === 'audio' ? 'audio/mpeg' : undefined }];
}

export const cloudflareAdapter: ProviderAdapter = {
  info: {
    type: 'cloudflare',
    label: 'Cloudflare Workers AI (gratis)',
    description:
      'Kostenloses Tageskontingent von 10.000 Neuronen: FLUX.1 schnell (sehr viele Bilder/Tag), Leonardo Phoenix & Lucid Origin, offene Sprachmodelle als KI-Regie und MeloTTS. Benötigt API-Token + Account-ID.',
    website: 'https://developers.cloudflare.com/workers-ai/',
    keyUrl: 'https://dash.cloudflare.com/profile/api-tokens',
    tasks: ['text-to-image', 'tts', 'llm'],
    needsKey: true,
    fields: [{ key: 'accountId', label: 'Account-ID', type: 'text', placeholder: '32-stellige Account-ID aus dem Cloudflare-Dashboard' }],
  },
  async run(ctx) {
    const { model, req, apiKey, signal, conn } = ctx;
    const base = accountBase(conn);
    const headers = { Authorization: `Bearer ${apiKey}` };
    if (model.task === 'text-to-image') {
      const body: Record<string, unknown> = { prompt: req.prompt.slice(0, 2048), ...model.params, ...req.extraParams };
      if (req.seed != null) body.seed = req.seed;
      if (!/flux-1-schnell/.test(model.model)) {
        const { width, height } = dimsFor(req.aspectRatio, 1);
        body.width = width;
        body.height = height;
        if (req.negativePrompt) body.negative_prompt = req.negativePrompt;
      }
      const res = await http(`${base}/run/${model.model}`, { json: body, headers, signal, timeoutMs: 3 * 60_000 });
      return parseCfResponse(res, 'image');
    }
    if (model.task === 'tts') {
      const res = await http(`${base}/run/${model.model}`, {
        json: { prompt: req.prompt, lang: (req.extraParams?.lang as string) || 'en', ...model.params },
        headers,
        signal,
      });
      return parseCfResponse(res, 'audio');
    }
    throw new ProviderError(`Workers AI: ${model.task} wird nicht unterstützt`, 400, false);
  },
  async llm(conn: Connection, apiKey: string, model: ModelDef, call: LlmCall, signal?: AbortSignal) {
    return chatCompletion(`${accountBase(conn)}/v1`, apiKey, model.model, { ...call, images: undefined }, { signal });
  },
  async test(conn, apiKey) {
    accountBase(conn);
    try {
      const j = await httpJson(`${API}/user/tokens/verify`, { headers: { Authorization: `Bearer ${apiKey}` }, timeoutMs: 20_000 });
      if (j?.result?.status !== 'active') throw new Error('Token nicht aktiv');
    } catch {
      // Account-Tokens werden über den Account-Endpunkt geprüft
      await httpJson(`${API}/accounts/${conn.options?.accountId}/tokens/verify`, { headers: { Authorization: `Bearer ${apiKey}` }, timeoutMs: 20_000 });
    }
    return 'Verbunden – 10.000 Gratis-Neuronen pro Tag verfügbar';
  },
};
