import type { ProviderOutput } from '../files.js';
import type { Connection, ModelDef } from '../types.js';
import { http, httpJson, poll, ProviderError } from '../util.js';
import type { LlmCall, ProviderAdapter, RunCtx } from './types.js';
import { nearestAspect, nearestDuration } from './types.js';

// ---------- Gemeinsame Funktionen für alle OpenAI-kompatiblen APIs ----------

export async function chatCompletion(
  baseUrl: string,
  apiKey: string,
  model: string,
  call: LlmCall,
  opts: { headers?: Record<string, string>; useMaxCompletionTokens?: boolean; signal?: AbortSignal } = {},
): Promise<string> {
  const content: any[] = [{ type: 'text', text: call.prompt }];
  for (const img of call.images || []) {
    content.push({ type: 'image_url', image_url: { url: img.dataUri() } });
  }
  const messages: any[] = [];
  if (call.system) messages.push({ role: 'system', content: call.system });
  messages.push({ role: 'user', content: call.images?.length ? content : call.prompt });
  const body: Record<string, unknown> = { model, messages };
  const max = call.maxTokens ?? 4000;
  if (opts.useMaxCompletionTokens) body.max_completion_tokens = max;
  else body.max_tokens = max;
  if (call.json && opts.useMaxCompletionTokens) body.response_format = { type: 'json_object' };
  const headers: Record<string, string> = { ...(opts.headers || {}) };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const j = await httpJson(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    json: body,
    headers,
    signal: opts.signal,
    timeoutMs: 5 * 60_000,
  });
  const msg = j?.choices?.[0]?.message;
  const text = typeof msg?.content === 'string' ? msg.content : Array.isArray(msg?.content) ? msg.content.map((c: any) => c.text || '').join('') : '';
  if (!text) throw new ProviderError('Leere Antwort vom Sprachmodell');
  return text;
}

export async function imagesGenerate(
  baseUrl: string,
  apiKey: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
  headers: Record<string, string> = {},
): Promise<ProviderOutput[]> {
  const j = await httpJson(`${baseUrl.replace(/\/$/, '')}/images/generations`, {
    json: body,
    headers: { Authorization: `Bearer ${apiKey}`, ...headers },
    signal,
    timeoutMs: 5 * 60_000,
  });
  const data: any[] = j?.data || [];
  const out = data.map((d) => (d.b64_json ? { b64: d.b64_json, mime: 'image/png' } : { url: d.url }));
  if (!out.length) throw new ProviderError('Keine Bilder in der Antwort');
  return out;
}

export async function speech(baseUrl: string, apiKey: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<ProviderOutput[]> {
  const res = await http(`${baseUrl.replace(/\/$/, '')}/audio/speech`, {
    json: body,
    headers: { Authorization: `Bearer ${apiKey}` },
    signal,
  });
  const buf = Buffer.from(await res.arrayBuffer());
  return [{ buffer: buf, mime: res.headers.get('content-type') || 'audio/mpeg' }];
}

function gptImageSize(model: string, ar?: string) {
  if (model.startsWith('dall-e-3')) return nearestAspect(ar, ['1024x1024', '1792x1024', '1024x1792']);
  if (model.startsWith('dall-e-2')) return '1024x1024';
  return nearestAspect(ar, ['1024x1024', '1536x1024', '1024x1536']);
}

const OPENAI_BASE = 'https://api.openai.com/v1';

async function runOpenAI(ctx: RunCtx): Promise<ProviderOutput[]> {
  const { model, req, apiKey, signal } = ctx;
  const base = (ctx.conn.baseUrl || OPENAI_BASE).replace(/\/$/, '');
  const auth = { Authorization: `Bearer ${apiKey}` };

  switch (model.task) {
    case 'text-to-image': {
      const isGpt = !model.model.startsWith('dall-e');
      const body: Record<string, unknown> = {
        model: model.model,
        prompt: req.prompt,
        size: gptImageSize(model.model, req.aspectRatio),
        n: model.model.startsWith('dall-e-3') ? 1 : Math.min(req.count || 1, 4),
        ...model.params,
        ...req.extraParams,
      };
      if (!isGpt) body.response_format = 'b64_json';
      if (isGpt && !body.quality) body.quality = 'high';
      return imagesGenerate(base, apiKey, body, signal);
    }
    case 'image-edit': {
      const fd = new FormData();
      fd.set('model', model.model);
      fd.set('prompt', req.prompt);
      const imgs = [req.image, ...req.refImages].filter(Boolean) as NonNullable<typeof req.image>[];
      if (!imgs.length) throw new ProviderError('Für die Bearbeitung wird ein Bild benötigt', 400, false);
      for (const img of imgs.slice(0, 16)) fd.append('image[]', img.blob(), img.filename);
      if (req.maskAlpha) fd.set('mask', req.maskAlpha.blob(), req.maskAlpha.filename);
      fd.set('size', gptImageSize(model.model, req.aspectRatio));
      fd.set('n', String(Math.min(req.count || 1, 4)));
      for (const [k, v] of Object.entries({ quality: 'high', ...model.params, ...req.extraParams })) fd.set(k, String(v));
      const j = await httpJson(`${base}/images/edits`, { body: fd, headers: auth, signal, timeoutMs: 5 * 60_000 });
      return (j.data || []).map((d: any) => (d.b64_json ? { b64: d.b64_json, mime: 'image/png' } : { url: d.url }));
    }
    case 'text-to-video':
    case 'image-to-video': {
      const pro = model.model.includes('pro');
      const size = nearestAspect(req.aspectRatio, pro ? ['1280x720', '720x1280', '1792x1024', '1024x1792'] : ['1280x720', '720x1280']);
      const fd = new FormData();
      fd.set('model', model.model);
      fd.set('prompt', req.prompt);
      fd.set('size', size);
      fd.set('seconds', String(nearestDuration(req.duration, [4, 8, 12])));
      if (req.image) fd.set('input_reference', req.image.blob(), req.image.filename);
      for (const [k, v] of Object.entries({ ...model.params, ...req.extraParams })) fd.set(k, String(v));
      const created = await httpJson(`${base}/videos`, { body: fd, headers: auth, signal });
      const id = created.id;
      if (!id) throw new ProviderError('Keine Video-ID erhalten');
      ctx.progress('In der Warteschlange bei OpenAI …');
      await poll(
        async () => {
          const s = await httpJson(`${base}/videos/${id}`, { headers: auth, signal });
          if (s.status === 'completed') return true;
          if (s.status === 'failed') throw new ProviderError(s.error?.message || 'Videoerstellung fehlgeschlagen', undefined, false);
          ctx.progress(`Rendert … ${s.progress != null ? Math.round(s.progress) + '%' : s.status}`);
          return undefined;
        },
        { intervalMs: 6000, signal },
      );
      return [{ url: `${base}/videos/${id}/content`, headers: auth, mime: 'video/mp4' }];
    }
    case 'tts': {
      const body: Record<string, unknown> = {
        model: model.model,
        voice: req.voice || 'alloy',
        input: req.prompt,
        ...model.params,
        ...req.extraParams,
      };
      return speech(base, apiKey, body, signal);
    }
    default:
      throw new ProviderError(`OpenAI unterstützt ${model.task} nicht`, 400, false);
  }
}

export const openaiAdapter: ProviderAdapter = {
  info: {
    type: 'openai',
    label: 'OpenAI',
    description: 'GPT-Image, Sora 2 Video, Sprachausgabe (TTS) und GPT als Prompt-Assistent & KI-Jury.',
    website: 'https://platform.openai.com',
    keyUrl: 'https://platform.openai.com/api-keys',
    tasks: ['text-to-image', 'image-edit', 'text-to-video', 'image-to-video', 'tts', 'llm'],
    needsKey: true,
    baseUrl: { default: OPENAI_BASE },
  },
  run: runOpenAI,
  async llm(conn: Connection, apiKey: string, model: ModelDef, call: LlmCall, signal?: AbortSignal) {
    return chatCompletion(conn.baseUrl || OPENAI_BASE, apiKey, model.model, call, { useMaxCompletionTokens: true, signal });
  },
  async test(conn, apiKey) {
    const j = await httpJson(`${(conn.baseUrl || OPENAI_BASE).replace(/\/$/, '')}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeoutMs: 20_000,
    });
    return `Verbunden – ${j?.data?.length ?? 0} Modelle verfügbar`;
  },
};
