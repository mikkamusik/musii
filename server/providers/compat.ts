import type { ProviderOutput } from '../files.js';
import type { Connection, ModelDef } from '../types.js';
import { httpJson, ProviderError } from '../util.js';
import { chatCompletion, imagesGenerate, speech } from './openai.js';
import type { LlmCall, ProviderAdapter, RunCtx } from './types.js';
import { nearestAspect } from './types.js';

// ---------------- OpenRouter ----------------
const OR_BASE = 'https://openrouter.ai/api/v1';
const OR_HEADERS = { 'HTTP-Referer': 'https://github.com/musii-studio', 'X-Title': 'MUSII Studio' };

async function chatImages(base: string, apiKey: string, ctx: RunCtx, headers: Record<string, string> = {}): Promise<ProviderOutput[]> {
  const { model, req, signal } = ctx;
  const content: any[] = [{ type: 'text', text: req.prompt }];
  for (const img of [req.image, ...req.refImages].filter(Boolean) as NonNullable<typeof req.image>[]) {
    content.push({ type: 'image_url', image_url: { url: img.dataUri() } });
  }
  const j = await httpJson(`${base}/chat/completions`, {
    json: {
      model: model.model,
      messages: [{ role: 'user', content }],
      modalities: ['image', 'text'],
      image_config: { aspect_ratio: nearestAspect(req.aspectRatio, ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9']) },
      ...model.params,
      ...req.extraParams,
    },
    headers: { Authorization: `Bearer ${apiKey}`, ...headers },
    signal,
    timeoutMs: 5 * 60_000,
  });
  const images: any[] = j?.choices?.[0]?.message?.images || [];
  const out = images.map((i) => ({ url: i?.image_url?.url || i?.url })).filter((o) => o.url);
  if (!out.length) throw new ProviderError('Das Modell lieferte kein Bild');
  return out;
}

export const openrouterAdapter: ProviderAdapter = {
  info: {
    type: 'openrouter',
    label: 'OpenRouter',
    description: 'Ein Schlüssel für 300+ Sprachmodelle (GPT, Claude, Gemini, Llama, Mistral, Grok, DeepSeek …) und Bildmodelle mit Bildausgabe.',
    website: 'https://openrouter.ai',
    keyUrl: 'https://openrouter.ai/settings/keys',
    tasks: ['llm', 'text-to-image', 'image-edit'],
    needsKey: true,
    baseUrl: { default: OR_BASE },
  },
  async run(ctx) {
    if (ctx.model.task === 'text-to-image' || ctx.model.task === 'image-edit') {
      return chatImages((ctx.conn.baseUrl || OR_BASE).replace(/\/$/, ''), ctx.apiKey, ctx, OR_HEADERS);
    }
    throw new ProviderError(`OpenRouter unterstützt ${ctx.model.task} nicht`, 400, false);
  },
  async llm(conn: Connection, apiKey: string, model: ModelDef, call: LlmCall, signal?: AbortSignal) {
    return chatCompletion(conn.baseUrl || OR_BASE, apiKey, model.model, call, { headers: OR_HEADERS, signal });
  },
  async listModels(conn) {
    // Alle aktuell kostenlosen Modelle (Preis 0, Suffix :free) automatisch anbieten
    const j = await httpJson(`${(conn.baseUrl || OR_BASE).replace(/\/$/, '')}/models`, { timeoutMs: 20_000 });
    return parseOpenRouterFree(j?.data || [], conn.id);
  },
  async test(conn, apiKey) {
    const j = await httpJson(`${(conn.baseUrl || OR_BASE).replace(/\/$/, '')}/key`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeoutMs: 20_000,
    });
    const d = j?.data;
    return `Verbunden${d?.label ? ' (' + d.label + ')' : ''}${d?.limit_remaining != null ? ` – Restlimit ${d.limit_remaining}` : ''}`;
  },
};

export function parseOpenRouterFree(data: any[], connectionId: string): ModelDef[] {
  const out: ModelDef[] = [];
  for (const m of data) {
    const p = m?.pricing || {};
    const free = String(m?.id || '').endsWith(':free') || (p.prompt === '0' && p.completion === '0' && (p.request ?? '0') === '0');
    const outMods: string[] = m?.architecture?.output_modalities || ['text'];
    const inMods: string[] = m?.architecture?.input_modalities || ['text'];
    if (!free || !outMods.includes('text') || outMods.length > 1) continue;
    const size = Number(String(m.id).match(/(\d+)b\b/i)?.[1] || 0);
    const quality = Math.min(90, 70 + Math.round(Math.log2(Math.max(1, size)) * 2) + (/ultra|pro|large|super/i.test(m.id) ? 4 : 0));
    out.push({
      id: `openrouter-free:${m.id}`,
      provider: 'openrouter',
      connectionId,
      task: 'llm',
      label: `${m.name || m.id} (gratis)`,
      model: m.id,
      quality,
      speed: 3,
      cost: 0,
      free: 'quota',
      freeNote: 'OpenRouter :free – ca. 50 Anfragen/Tag (1.000 nach einmaliger Aufladung)',
      features: { vision: inMods.includes('image') },
    });
  }
  return out.slice(0, 40);
}

// ---------------- Ollama (lokal) ----------------
const OLLAMA_BASE = 'http://127.0.0.1:11434';

export const ollamaAdapter: ProviderAdapter = {
  info: {
    type: 'ollama',
    label: 'Ollama (lokal)',
    description: 'Lokale Sprachmodelle (Llama, Qwen, Gemma, Mistral, LLaVA …) – kostenlos und privat als Prompt-Assistent.',
    website: 'https://ollama.com',
    tasks: ['llm'],
    needsKey: false,
    baseUrl: { default: OLLAMA_BASE },
  },
  async run() {
    throw new ProviderError('Ollama wird als Sprachmodell genutzt', 400, false);
  },
  async llm(conn, apiKey, model, call, signal) {
    return chatCompletion(`${(conn.baseUrl || OLLAMA_BASE).replace(/\/$/, '')}/v1`, apiKey, model.model, call, { signal });
  },
  async listModels(conn) {
    const j = await httpJson(`${(conn.baseUrl || OLLAMA_BASE).replace(/\/$/, '')}/api/tags`, { timeoutMs: 5000 });
    return (j?.models || []).map(
      (m: any): ModelDef => ({
        id: `ollama:${conn.id}:${m.name}`,
        provider: 'ollama',
        connectionId: conn.id,
        task: 'llm',
        label: `${m.name} (Ollama)`,
        model: m.name,
        quality: 60,
        speed: 3,
        cost: 0,
        free: 'local',
        freeNote: 'Läuft lokal auf deinem Rechner',
        features: { vision: /llava|vision|gemma3|qwen2\.5vl|qwen-vl|minicpm-v|llama3\.2-vision/i.test(m.name) },
      }),
    );
  },
  async test(conn) {
    const j = await httpJson(`${(conn.baseUrl || OLLAMA_BASE).replace(/\/$/, '')}/api/tags`, { timeoutMs: 5000 });
    return `Verbunden – ${j?.models?.length ?? 0} lokale Modelle`;
  },
};

// ---------------- Beliebige OpenAI-kompatible API ----------------
export const compatAdapter: ProviderAdapter = {
  info: {
    type: 'openai-compatible',
    label: 'OpenAI-kompatible API',
    description:
      'Jede API mit OpenAI-Format: xAI Grok, Mistral, DeepSeek, Groq, Together, DeepInfra, Fireworks, Azure, LM Studio, vLLM, LocalAI … Chat, Bilder (/images/generations) und Sprache (/audio/speech).',
    tasks: ['llm', 'text-to-image', 'image-edit', 'tts'],
    needsKey: false,
    baseUrl: { required: true, default: 'https://api.x.ai/v1' },
    multi: true,
    fields: [
      {
        key: 'imageMode',
        label: 'Bild-Modus',
        type: 'text',
        placeholder: 'images (Standard) oder chat',
        help: '„chat“ für Modelle, die Bilder über /chat/completions mit modalities=["image"] liefern.',
      },
    ],
  },
  async run(ctx) {
    const { model, req, apiKey, signal, conn } = ctx;
    const base = (conn.baseUrl || '').replace(/\/$/, '');
    if (!base) throw new ProviderError('Basis-URL fehlt', 400, false);
    switch (model.task) {
      case 'text-to-image':
      case 'image-edit':
        if (conn.options?.imageMode === 'chat' || model.task === 'image-edit') return chatImages(base, apiKey, ctx);
        return imagesGenerate(
          base,
          apiKey,
          {
            model: model.model,
            prompt: req.prompt,
            n: Math.min(req.count || 1, 4),
            response_format: 'b64_json',
            ...model.params,
            ...req.extraParams,
          },
          signal,
        );
      case 'tts':
        return speech(base, apiKey, { model: model.model, voice: req.voice || 'alloy', input: req.prompt, ...model.params }, signal);
      default:
        throw new ProviderError(`Aufgabe ${model.task} wird für OpenAI-kompatible APIs nicht unterstützt`, 400, false);
    }
  },
  async llm(conn, apiKey, model, call, signal) {
    return chatCompletion(conn.baseUrl || '', apiKey, model.model, call, { signal });
  },
  async test(conn, apiKey) {
    const j = await httpJson(`${(conn.baseUrl || '').replace(/\/$/, '')}/models`, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      timeoutMs: 20_000,
    });
    const ids: string[] = (j?.data || []).map((m: any) => m.id).slice(0, 8);
    return `Verbunden – ${j?.data?.length ?? 0} Modelle${ids.length ? ': ' + ids.join(', ') : ''}`;
  },
};
