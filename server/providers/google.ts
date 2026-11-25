import type { ProviderOutput } from '../files.js';
import type { Connection, ModelDef } from '../types.js';
import { httpJson, poll, ProviderError } from '../util.js';
import type { LlmCall, ProviderAdapter, RunCtx } from './types.js';
import { nearestAspect, nearestDuration } from './types.js';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

function base(conn: Connection) {
  return (conn.baseUrl || BASE).replace(/\/$/, '');
}

function inline(img: { mime: string; base64(): string }) {
  return { inlineData: { mimeType: img.mime, data: img.base64() } };
}

async function geminiImage(ctx: RunCtx): Promise<ProviderOutput[]> {
  const { model, req, apiKey, signal } = ctx;
  const parts: any[] = [{ text: req.prompt }];
  for (const img of [req.image, ...req.refImages].filter(Boolean) as NonNullable<typeof req.image>[]) parts.push(inline(img));
  const body: any = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      responseModalities: ['IMAGE', 'TEXT'],
      imageConfig: { aspectRatio: nearestAspect(req.aspectRatio, ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9']) },
      ...((model.params as any)?.generationConfig || {}),
    },
  };
  const j = await httpJson(`${base(ctx.conn)}/models/${model.model}:generateContent`, {
    json: body,
    headers: { 'x-goog-api-key': apiKey },
    signal,
    timeoutMs: 5 * 60_000,
  });
  const out: ProviderOutput[] = [];
  for (const c of j?.candidates || []) {
    for (const p of c?.content?.parts || []) {
      const d = p.inlineData || p.inline_data;
      if (d?.data) out.push({ b64: d.data, mime: d.mimeType || d.mime_type || 'image/png' });
    }
  }
  if (!out.length) {
    const reason = j?.promptFeedback?.blockReason || j?.candidates?.[0]?.finishReason;
    throw new ProviderError(`Gemini lieferte kein Bild${reason ? ` (${reason})` : ''}`, undefined, false);
  }
  return out;
}

async function imagen(ctx: RunCtx): Promise<ProviderOutput[]> {
  const { model, req, apiKey, signal } = ctx;
  const body = {
    instances: [{ prompt: req.prompt }],
    parameters: {
      sampleCount: Math.min(req.count || 1, 4),
      aspectRatio: nearestAspect(req.aspectRatio, ['1:1', '3:4', '4:3', '9:16', '16:9']),
      personGeneration: 'allow_adult',
      ...model.params,
      ...req.extraParams,
    },
  };
  const j = await httpJson(`${base(ctx.conn)}/models/${model.model}:predict`, {
    json: body,
    headers: { 'x-goog-api-key': apiKey },
    signal,
    timeoutMs: 5 * 60_000,
  });
  const out = (j?.predictions || [])
    .filter((p: any) => p.bytesBase64Encoded)
    .map((p: any) => ({ b64: p.bytesBase64Encoded, mime: p.mimeType || 'image/png' }));
  if (!out.length) throw new ProviderError('Imagen lieferte kein Bild (evtl. Sicherheitsfilter)', undefined, false);
  return out;
}

async function veo(ctx: RunCtx): Promise<ProviderOutput[]> {
  const { model, req, apiKey, signal } = ctx;
  const instance: any = { prompt: req.prompt };
  if (req.image) instance.image = { bytesBase64Encoded: req.image.base64(), mimeType: req.image.mime };
  if (req.endImage && model.features?.endFrame) instance.lastFrame = { bytesBase64Encoded: req.endImage.base64(), mimeType: req.endImage.mime };
  if (req.refImages.length && model.features?.refs) {
    instance.referenceImages = req.refImages.slice(0, 3).map((r) => ({
      image: { bytesBase64Encoded: r.base64(), mimeType: r.mime },
      referenceType: 'asset',
    }));
  }
  const parameters: any = {
    aspectRatio: nearestAspect(req.aspectRatio, ['16:9', '9:16']),
    ...model.params,
    ...req.extraParams,
  };
  if (req.negativePrompt) parameters.negativePrompt = req.negativePrompt;
  if (model.features?.durations && req.duration) parameters.durationSeconds = nearestDuration(req.duration, model.features.durations);
  if (req.resolution && /1080|720/.test(req.resolution)) parameters.resolution = req.resolution.includes('1080') ? '1080p' : '720p';
  const op = await httpJson(`${base(ctx.conn)}/models/${model.model}:predictLongRunning`, {
    json: { instances: [instance], parameters },
    headers: { 'x-goog-api-key': apiKey },
    signal,
  });
  if (!op?.name) throw new ProviderError('Keine Operation von Veo erhalten');
  ctx.progress('Veo rendert …');
  const done = await poll(
    async () => {
      const s = await httpJson(`${base(ctx.conn)}/${op.name}`, { headers: { 'x-goog-api-key': apiKey }, signal });
      if (s.error) throw new ProviderError(s.error.message || 'Veo-Fehler', undefined, false);
      return s.done ? s : undefined;
    },
    { intervalMs: 8000, signal },
  );
  const samples =
    done?.response?.generateVideoResponse?.generatedSamples || done?.response?.generatedVideos || done?.response?.videos || [];
  const out: ProviderOutput[] = [];
  for (const s of samples) {
    const uri = s?.video?.uri || s?.uri;
    const b64 = s?.video?.bytesBase64Encoded || s?.bytesBase64Encoded;
    if (uri) out.push({ url: uri, headers: { 'x-goog-api-key': apiKey }, mime: 'video/mp4' });
    else if (b64) out.push({ b64, mime: 'video/mp4' });
  }
  if (!out.length) {
    const filtered = done?.response?.generateVideoResponse?.raiMediaFilteredReasons;
    throw new ProviderError(`Veo lieferte kein Video${filtered ? ': ' + filtered.join(', ') : ''}`, undefined, false);
  }
  return out;
}

async function geminiTts(ctx: RunCtx): Promise<ProviderOutput[]> {
  const { model, req, apiKey, signal } = ctx;
  const body = {
    contents: [{ parts: [{ text: req.prompt }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: req.voice || 'Kore' } } },
    },
  };
  const j = await httpJson(`${base(ctx.conn)}/models/${model.model}:generateContent`, {
    json: body,
    headers: { 'x-goog-api-key': apiKey },
    signal,
  });
  const d = j?.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData)?.inlineData;
  if (!d?.data) throw new ProviderError('Keine Audiodaten erhalten');
  // Gemini liefert rohes PCM (16 bit, 24 kHz, mono) -> WAV-Header ergänzen
  const pcm = Buffer.from(d.data, 'base64');
  return [{ buffer: pcmToWav(pcm, 24000), mime: 'audio/wav' }];
}

export function pcmToWav(pcm: Buffer, sampleRate: number, channels = 1, bits = 16): Buffer {
  const header = Buffer.alloc(44);
  const byteRate = (sampleRate * channels * bits) / 8;
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE((channels * bits) / 8, 32);
  header.writeUInt16LE(bits, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export const googleAdapter: ProviderAdapter = {
  info: {
    type: 'google',
    label: 'Google Gemini / Veo / Imagen',
    description: 'Veo 3.x Video (mit Ton), Imagen 4, Gemini-Bildbearbeitung („Nano Banana“), Gemini TTS und Gemini als Assistent.',
    website: 'https://aistudio.google.com',
    keyUrl: 'https://aistudio.google.com/apikey',
    tasks: ['text-to-image', 'image-edit', 'text-to-video', 'image-to-video', 'tts', 'llm'],
    needsKey: true,
    baseUrl: { default: BASE },
  },
  async run(ctx) {
    const m = ctx.model.model;
    if (ctx.model.task === 'tts') return geminiTts(ctx);
    if (m.startsWith('veo')) return veo(ctx);
    if (m.startsWith('imagen')) return imagen(ctx);
    if (m.startsWith('gemini')) return geminiImage(ctx);
    throw new ProviderError(`Unbekanntes Google-Modell ${m}`, 400, false);
  },
  async llm(conn: Connection, apiKey: string, model: ModelDef, call: LlmCall, signal?: AbortSignal) {
    const parts: any[] = [{ text: call.prompt }];
    for (const img of call.images || []) parts.push(inline(img));
    const body: any = {
      contents: [{ role: 'user', parts }],
      generationConfig: { maxOutputTokens: call.maxTokens ?? 4000 },
    };
    if (call.system) body.systemInstruction = { parts: [{ text: call.system }] };
    if (call.json) body.generationConfig.responseMimeType = 'application/json';
    const j = await httpJson(`${base(conn)}/models/${model.model}:generateContent`, {
      json: body,
      headers: { 'x-goog-api-key': apiKey },
      signal,
      timeoutMs: 5 * 60_000,
    });
    const text = (j?.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || '').join('');
    if (!text) throw new ProviderError('Leere Antwort von Gemini');
    return text;
  },
  async test(conn, apiKey) {
    const j = await httpJson(`${base(conn)}/models?pageSize=200`, { headers: { 'x-goog-api-key': apiKey }, timeoutMs: 20_000 });
    return `Verbunden – ${j?.models?.length ?? 0} Modelle verfügbar`;
  },
};
