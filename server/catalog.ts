import { db, decrypt } from './store.js';
import type { Connection, GenRequest, ModelDef, ModelFeatures, ProviderType, RoutingMode, Task } from './types.js';
import { ADAPTERS } from './providers/index.js';

type Extra = Partial<Omit<ModelDef, 'provider' | 'task' | 'model' | 'label' | 'quality' | 'speed' | 'cost'>>;

export function isFree(mod: ModelDef): boolean {
  return !!mod.free || mod.provider === 'demo';
}

function m(
  provider: ProviderType,
  task: Task,
  model: string,
  label: string,
  quality: number,
  speed: number,
  cost: number,
  extra: Extra = {},
): ModelDef {
  const freeDefault = provider === 'demo' ? { free: 'local' as const, freeNote: 'Offline-Demo' } : {};
  return { id: `${provider}:${task}:${model}`, provider, task, model, label, quality, speed, cost, ...freeDefault, ...extra };
}

const F = (f: ModelFeatures) => ({ features: f });
const KLING_D = { durations: [5, 10] };
const ASPECT_3 = ['16:9', '9:16', '1:1'];

/**
 * Kuratierter Modellkatalog (Stand: Ende 2026). Qualitätswerte sind redaktionelle Schätzungen
 * für den Smart-Router und lassen sich in der Oberfläche überschreiben.
 * Neue/fehlende Modelle können jederzeit als „Eigenes Modell“ ergänzt werden.
 */
export const STATIC_MODELS: ModelDef[] = [
  // ================= OpenAI =================
  m('openai', 'text-to-image', 'gpt-image-1', 'GPT Image 1', 91, 2, 0.17, F({ batch: true })),
  m('openai', 'image-edit', 'gpt-image-1', 'GPT Image 1 – Bearbeiten', 90, 2, 0.17, F({ refs: true, maxRefs: 16, mask: true, batch: true })),
  m('openai', 'text-to-image', 'dall-e-3', 'DALL·E 3', 76, 3, 0.08),
  m('openai', 'text-to-video', 'sora-2', 'Sora 2', 92, 2, 0.8, F({ audio: true, durations: [4, 8, 12] })),
  m('openai', 'text-to-video', 'sora-2-pro', 'Sora 2 Pro', 95, 1, 2.4, F({ audio: true, durations: [4, 8, 12] })),
  m('openai', 'image-to-video', 'sora-2', 'Sora 2', 91, 2, 0.8, F({ audio: true, durations: [4, 8, 12] })),
  m('openai', 'image-to-video', 'sora-2-pro', 'Sora 2 Pro', 94, 1, 2.4, F({ audio: true, durations: [4, 8, 12] })),
  m('openai', 'tts', 'gpt-4o-mini-tts', 'GPT-4o mini TTS', 86, 5, 0.01),
  m('openai', 'llm', 'gpt-5', 'GPT-5', 93, 2, 0.02, F({ vision: true })),
  m('openai', 'llm', 'gpt-5-mini', 'GPT-5 mini', 85, 4, 0.004, F({ vision: true })),

  // ================= Google =================
  m('google', 'text-to-image', 'imagen-4.0-ultra-generate-001', 'Imagen 4 Ultra', 92, 3, 0.06),
  m('google', 'text-to-image', 'imagen-4.0-generate-001', 'Imagen 4', 89, 4, 0.04, F({ batch: true })),
  m('google', 'text-to-image', 'imagen-4.0-fast-generate-001', 'Imagen 4 Fast', 82, 5, 0.02, F({ batch: true })),
  m('google', 'text-to-image', 'gemini-2.5-flash-image', 'Gemini 2.5 Flash Image', 90, 4, 0.04, F({ refs: true, maxRefs: 3 })),
  m('google', 'image-edit', 'gemini-2.5-flash-image', 'Gemini 2.5 Flash Image – Bearbeiten', 94, 4, 0.04, F({ refs: true, maxRefs: 3 })),
  m('google', 'text-to-video', 'veo-3.1-generate-preview', 'Veo 3.1', 97, 1, 3.2, F({ audio: true, negative: true, refs: true, durations: [4, 6, 8] })),
  m('google', 'text-to-video', 'veo-3.1-fast-generate-preview', 'Veo 3.1 Fast', 93, 3, 1.2, F({ audio: true, negative: true, durations: [4, 6, 8] })),
  m('google', 'text-to-video', 'veo-3.0-generate-001', 'Veo 3', 95, 1, 3.2, F({ audio: true, negative: true })),
  m('google', 'image-to-video', 'veo-3.1-generate-preview', 'Veo 3.1', 97, 1, 3.2, F({ audio: true, negative: true, endFrame: true, durations: [4, 6, 8] })),
  m('google', 'image-to-video', 'veo-3.1-fast-generate-preview', 'Veo 3.1 Fast', 93, 3, 1.2, F({ audio: true, negative: true, endFrame: true, durations: [4, 6, 8] })),
  m('google', 'image-to-video', 'veo-3.0-generate-001', 'Veo 3', 94, 1, 3.2, F({ audio: true, negative: true })),
  m('google', 'tts', 'gemini-2.5-flash-preview-tts', 'Gemini TTS', 84, 4, 0.01),
  m('google', 'llm', 'gemini-2.5-pro', 'Gemini 2.5 Pro', 92, 2, 0.01, F({ vision: true })),
  m('google', 'llm', 'gemini-2.5-flash', 'Gemini 2.5 Flash', 86, 5, 0.002, { ...F({ vision: true }), free: 'quota', freeNote: 'Gemini Free Tier (AI-Studio-Schlüssel ohne Abrechnung)' }),
  m('google', 'llm', 'gemini-2.5-flash-lite', 'Gemini 2.5 Flash-Lite', 80, 5, 0.001, { ...F({ vision: true }), free: 'quota', freeNote: 'Gemini Free Tier (AI-Studio-Schlüssel ohne Abrechnung)' }),

  // ================= Anthropic =================
  m('anthropic', 'llm', 'claude-opus-5-5', 'Claude Opus 5.5', 99, 3, 0.03, F({ vision: true })),
  m('anthropic', 'llm', 'claude-sonnet-5-5', 'Claude Sonnet 5.5', 95, 4, 0.015, F({ vision: true })),
  m('anthropic', 'llm', 'claude-haiku-5-5', 'Claude Haiku 5.5', 86, 5, 0.001, F({ vision: true })),
  m('anthropic', 'llm', 'claude-fable-5-2', 'Claude Fable 5.2', 100, 2, 0.06, F({ vision: true })),

  // ================= fal.ai =================
  m('fal', 'text-to-image', 'fal-ai/flux-pro/v1.1-ultra', 'FLUX 1.1 Pro Ultra', 91, 4, 0.06, {
    ...F({ batch: true }),
    formats: { aspects: ['21:9', '16:9', '4:3', '3:2', '1:1', '2:3', '3:4', '9:16', '9:21'] },
  }),
  m('fal', 'text-to-image', 'fal-ai/imagen4/preview/ultra', 'Imagen 4 Ultra (fal)', 92, 3, 0.06, {
    ...F({ negative: true }),
    formats: { aspects: ['1:1', '16:9', '9:16', '3:4', '4:3'] },
  }),
  m('fal', 'text-to-image', 'fal-ai/bytedance/seedream/v4/text-to-image', 'Seedream 4', 92, 4, 0.03, { ...F({ batch: true }), formats: { imageSize: true } }),
  m('fal', 'text-to-image', 'fal-ai/ideogram/v3', 'Ideogram 3 (Typografie)', 88, 3, 0.06, { ...F({ negative: true }), formats: { imageSize: true } }),
  m('fal', 'text-to-image', 'fal-ai/recraft/v3/text-to-image', 'Recraft V3 (Design)', 87, 4, 0.04, { formats: { imageSize: true } }),
  m('fal', 'text-to-image', 'fal-ai/qwen-image', 'Qwen Image', 86, 4, 0.02, { ...F({ negative: true, batch: true }), formats: { imageSize: true } }),
  m('fal', 'text-to-image', 'fal-ai/nano-banana', 'Nano Banana (fal)', 89, 4, 0.04, F({ batch: true })),
  m('fal', 'image-edit', 'fal-ai/nano-banana/edit', 'Nano Banana Edit (fal)', 94, 4, 0.04, F({ refs: true, maxRefs: 10, batch: true })),
  m('fal', 'image-edit', 'fal-ai/bytedance/seedream/v4/edit', 'Seedream 4 Edit', 93, 4, 0.03, F({ refs: true, maxRefs: 10, batch: true })),
  m('fal', 'image-edit', 'fal-ai/flux-pro/kontext', 'FLUX Kontext Pro (fal)', 90, 4, 0.04, F({ refs: false, maxRefs: 1 })),
  m('fal', 'image-edit', 'fal-ai/flux-pro/kontext/max', 'FLUX Kontext Max (fal)', 92, 3, 0.08, F({ maxRefs: 1 })),
  m('fal', 'image-edit', 'fal-ai/qwen-image-edit', 'Qwen Image Edit', 88, 4, 0.03, F({ maxRefs: 1 })),

  m('fal', 'image-to-video', 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video', 'Kling 2.5 Turbo Pro', 95, 3, 0.35, {
    ...F({ negative: true, ...KLING_D }),
    formats: { duration: 'string' },
  }),
  m('fal', 'image-to-video', 'fal-ai/kling-video/v2.1/master/image-to-video', 'Kling 2.1 Master', 93, 2, 1.4, {
    ...F({ negative: true, ...KLING_D }),
    formats: { duration: 'string' },
  }),
  m('fal', 'image-to-video', 'fal-ai/kling-video/v2.1/pro/image-to-video', 'Kling 2.1 Pro (Start+End)', 91, 3, 0.45, {
    ...F({ negative: true, endFrame: true, ...KLING_D }),
    formats: { duration: 'string' },
  }),
  m('fal', 'image-to-video', 'fal-ai/veo3.1/image-to-video', 'Veo 3.1 (fal)', 97, 1, 3.2, {
    ...F({ audio: true, durations: [8] }),
    formats: { duration: 's', aspects: ['16:9', '9:16'] },
  }),
  m('fal', 'image-to-video', 'fal-ai/veo3/fast/image-to-video', 'Veo 3 Fast (fal)', 92, 3, 1.2, {
    ...F({ audio: true, durations: [8] }),
    formats: { duration: 's', aspects: ['16:9', '9:16'] },
  }),
  m('fal', 'image-to-video', 'fal-ai/sora-2/image-to-video', 'Sora 2 (fal)', 91, 2, 0.8, F({ audio: true, durations: [4, 8, 12] })),
  m('fal', 'image-to-video', 'fal-ai/minimax/hailuo-02/pro/image-to-video', 'Hailuo 02 Pro', 92, 2, 0.48, { inputMap: { duration: '', aspect_ratio: '' } }),
  m('fal', 'image-to-video', 'fal-ai/bytedance/seedance/v1/pro/image-to-video', 'Seedance 1 Pro', 93, 3, 0.62, {
    ...F({ durations: [5, 10] }),
    formats: { duration: 'string' },
  }),
  m('fal', 'image-to-video', 'fal-ai/luma-dream-machine/ray-2/image-to-video', 'Luma Ray 2 (fal)', 87, 3, 0.5, {
    ...F({ endFrame: true, durations: [5, 9] }),
    inputMap: { end_image: 'end_image_url' },
    formats: { duration: 's' },
  }),
  m('fal', 'image-to-video', 'fal-ai/wan/v2.2-a14b/image-to-video', 'Wan 2.2 (Open Source)', 83, 3, 0.2, { ...F({ negative: true }), inputMap: { duration: '' } }),

  m('fal', 'text-to-video', 'fal-ai/kling-video/v2.5-turbo/pro/text-to-video', 'Kling 2.5 Turbo Pro', 94, 3, 0.35, {
    ...F({ negative: true, ...KLING_D }),
    formats: { duration: 'string', aspects: ASPECT_3 },
  }),
  m('fal', 'text-to-video', 'fal-ai/veo3', 'Veo 3 (fal)', 95, 1, 3.2, {
    ...F({ audio: true, negative: true, durations: [8] }),
    formats: { duration: 's', aspects: ['16:9', '9:16'] },
  }),
  m('fal', 'text-to-video', 'fal-ai/veo3/fast', 'Veo 3 Fast (fal)', 91, 3, 1.2, {
    ...F({ audio: true, negative: true, durations: [8] }),
    formats: { duration: 's', aspects: ['16:9', '9:16'] },
  }),
  m('fal', 'text-to-video', 'fal-ai/sora-2/text-to-video', 'Sora 2 (fal)', 92, 2, 0.8, {
    ...F({ audio: true, durations: [4, 8, 12] }),
    formats: { aspects: ['16:9', '9:16'] },
  }),
  m('fal', 'text-to-video', 'fal-ai/minimax/hailuo-02/standard/text-to-video', 'Hailuo 02', 89, 3, 0.27, {
    ...F({ durations: [6, 10] }),
    formats: { duration: 'string' },
    inputMap: { aspect_ratio: '' },
  }),
  m('fal', 'text-to-video', 'fal-ai/bytedance/seedance/v1/pro/text-to-video', 'Seedance 1 Pro', 92, 3, 0.62, {
    ...F({ durations: [5, 10] }),
    formats: { duration: 'string', aspects: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'] },
  }),
  m('fal', 'text-to-video', 'fal-ai/wan/v2.2-a14b/text-to-video', 'Wan 2.2 (Open Source)', 82, 3, 0.2, { ...F({ negative: true }), inputMap: { duration: '' } }),

  m('fal', 'lipsync', 'fal-ai/bytedance/omnihuman', 'OmniHuman (Bild + Audio)', 93, 2, 0.9, F({ inputImage: true })),
  m('fal', 'lipsync', 'veed/fabric-1.0', 'Fabric 1.0 (Bild + Audio)', 89, 3, 0.6, { ...F({ inputImage: true }), params: { resolution: '720p' }, inputMap: { prompt: '' } }),
  m('fal', 'lipsync', 'fal-ai/sync-lipsync/v2', 'Sync Lipsync 2 (Video + Audio)', 91, 3, 0.5, { ...F({ inputVideo: true }), inputMap: { prompt: '' } }),
  m('fal', 'lipsync', 'fal-ai/kling-video/lipsync/audio-to-video', 'Kling Lipsync (Video + Audio)', 86, 3, 0.3, { ...F({ inputVideo: true }), inputMap: { prompt: '' } }),
  m('fal', 'upscale-image', 'fal-ai/clarity-upscaler', 'Clarity Upscaler', 90, 3, 0.03, { inputMap: { scale: 'upscale_factor' } }),
  m('fal', 'upscale-image', 'fal-ai/seedvr/upscale/image', 'SeedVR2 Upscale', 88, 4, 0.02, { inputMap: { scale: 'upscale_factor', prompt: '' } }),
  m('fal', 'upscale-image', 'fal-ai/recraft/upscale/crisp', 'Recraft Crisp Upscale', 85, 5, 0.004, { inputMap: { scale: '', prompt: '' } }),
  m('fal', 'upscale-video', 'fal-ai/topaz/upscale/video', 'Topaz Video Upscale (fal)', 92, 2, 0.5, { inputMap: { scale: 'upscale_factor' } }),
  m('fal', 'upscale-video', 'fal-ai/seedvr/upscale/video', 'SeedVR2 Video Upscale', 86, 3, 0.3, { inputMap: { scale: 'upscale_factor' } }),
  m('fal', 'remove-bg', 'fal-ai/birefnet/v2', 'BiRefNet v2 Freistellen', 90, 5, 0.002),
  m('fal', 'remove-bg', 'fal-ai/bria/background/remove', 'Bria RMBG 2.0', 89, 5, 0.018),
  m('fal', 'tts', 'fal-ai/minimax/speech-02-hd', 'MiniMax Speech 02 HD', 88, 4, 0.05, { inputMap: { prompt: 'text', voice: '' } }),
  m('fal', 'music', 'fal-ai/lyria2', 'Lyria 2 Musik (fal)', 88, 3, 0.1, { inputMap: { duration: '' } }),
  m('fal', 'sfx', 'fal-ai/elevenlabs/sound-effects', 'ElevenLabs SFX (fal)', 90, 4, 0.03, { inputMap: { prompt: 'text', duration: 'duration_seconds' } }),

  // ================= Replicate =================
  m('replicate', 'text-to-image', 'black-forest-labs/flux-1.1-pro-ultra', 'FLUX 1.1 Pro Ultra (Replicate)', 91, 4, 0.06, {
    formats: { aspects: ['21:9', '16:9', '3:2', '4:3', '5:4', '1:1', '4:5', '3:4', '2:3', '9:16', '9:21'] },
  }),
  m('replicate', 'text-to-image', 'black-forest-labs/flux-schnell', 'FLUX Schnell', 72, 5, 0.003, F({ batch: true })),
  m('replicate', 'text-to-image', 'google/imagen-4-ultra', 'Imagen 4 Ultra (Replicate)', 92, 3, 0.06),
  m('replicate', 'text-to-image', 'bytedance/seedream-4', 'Seedream 4 (Replicate)', 92, 4, 0.03, F({ refs: true, maxRefs: 10 })),
  m('replicate', 'text-to-image', 'ideogram-ai/ideogram-v3-quality', 'Ideogram 3 Quality', 89, 3, 0.09),
  m('replicate', 'text-to-image', 'recraft-ai/recraft-v3', 'Recraft V3 (Replicate)', 87, 4, 0.04),
  m('replicate', 'text-to-image', 'qwen/qwen-image', 'Qwen Image (Replicate)', 86, 4, 0.025),
  m('replicate', 'image-edit', 'google/nano-banana', 'Nano Banana (Replicate)', 94, 4, 0.039, F({ refs: true, maxRefs: 10 })),
  m('replicate', 'image-edit', 'bytedance/seedream-4', 'Seedream 4 Edit (Replicate)', 93, 4, 0.03, F({ refs: true, maxRefs: 10 })),
  m('replicate', 'image-edit', 'black-forest-labs/flux-kontext-pro', 'FLUX Kontext Pro (Replicate)', 90, 4, 0.04, { ...F({ maxRefs: 1 }), inputMap: { image: 'input_image' } }),
  m('replicate', 'image-edit', 'qwen/qwen-image-edit', 'Qwen Image Edit (Replicate)', 88, 4, 0.03, F({ maxRefs: 1 })),
  m('replicate', 'image-to-video', 'kwaivgi/kling-v2.5-turbo-pro', 'Kling 2.5 Turbo Pro (Replicate)', 95, 3, 0.35, {
    ...F({ negative: true, ...KLING_D }),
    inputMap: { image: 'start_image', aspect_ratio: '' },
  }),
  m('replicate', 'image-to-video', 'kwaivgi/kling-v2.1', 'Kling 2.1 Pro Start+End (Replicate)', 91, 3, 0.45, {
    ...F({ negative: true, endFrame: true, ...KLING_D }),
    inputMap: { image: 'start_image', aspect_ratio: '' },
    params: { mode: 'pro' },
  }),
  m('replicate', 'image-to-video', 'minimax/hailuo-02', 'Hailuo 02 (Replicate)', 92, 2, 0.48, {
    ...F({ endFrame: true, durations: [6, 10] }),
    inputMap: { image: 'first_frame_image', end_image: 'last_frame_image', aspect_ratio: '' },
  }),
  m('replicate', 'image-to-video', 'bytedance/seedance-1-pro', 'Seedance 1 Pro (Replicate)', 93, 3, 0.62, { ...F({ durations: [5, 10] }), inputMap: { aspect_ratio: '' } }),
  m('replicate', 'image-to-video', 'google/veo-3.1', 'Veo 3.1 (Replicate)', 97, 1, 3.2, {
    ...F({ audio: true, negative: true, endFrame: true }),
    inputMap: { end_image: 'last_frame', duration: '' },
  }),
  m('replicate', 'image-to-video', 'wan-video/wan-2.2-i2v-fast', 'Wan 2.2 Fast (Replicate)', 82, 5, 0.05, { inputMap: { duration: '', aspect_ratio: '' } }),
  m('replicate', 'text-to-video', 'kwaivgi/kling-v2.5-turbo-pro', 'Kling 2.5 Turbo Pro (Replicate)', 94, 3, 0.35, {
    ...F({ negative: true, ...KLING_D }),
    formats: { aspects: ASPECT_3 },
  }),
  m('replicate', 'text-to-video', 'google/veo-3.1', 'Veo 3.1 (Replicate)', 97, 1, 3.2, { ...F({ audio: true, negative: true }), inputMap: { duration: '' } }),
  m('replicate', 'text-to-video', 'google/veo-3-fast', 'Veo 3 Fast (Replicate)', 91, 3, 1.2, { ...F({ audio: true, negative: true }), inputMap: { duration: '' } }),
  m('replicate', 'text-to-video', 'minimax/hailuo-02', 'Hailuo 02 (Replicate)', 90, 2, 0.48, { ...F({ durations: [6, 10] }), inputMap: { aspect_ratio: '' } }),
  m('replicate', 'text-to-video', 'bytedance/seedance-1-pro', 'Seedance 1 Pro (Replicate)', 92, 3, 0.62, F({ durations: [5, 10] })),
  m('replicate', 'text-to-video', 'wan-video/wan-2.2-t2v-fast', 'Wan 2.2 Fast (Replicate)', 80, 5, 0.05, { inputMap: { duration: '' } }),
  m('replicate', 'lipsync', 'bytedance/omni-human', 'OmniHuman (Replicate)', 93, 2, 0.9, { ...F({ inputImage: true }), inputMap: { prompt: '' } }),
  m('replicate', 'lipsync', 'sync/lipsync-2', 'Sync Lipsync 2 (Replicate)', 91, 3, 0.5, { ...F({ inputVideo: true }), inputMap: { prompt: '' } }),
  m('replicate', 'lipsync', 'kwaivgi/kling-lip-sync', 'Kling Lipsync (Replicate)', 86, 3, 0.3, {
    ...F({ inputVideo: true }),
    inputMap: { video: 'video_url', audio: 'audio_file', prompt: '' },
  }),
  m('replicate', 'upscale-image', 'recraft-ai/recraft-crisp-upscale', 'Recraft Crisp Upscale (Replicate)', 85, 5, 0.004, { inputMap: { scale: '', prompt: '' } }),
  m('replicate', 'upscale-video', 'topazlabs/video-upscale', 'Topaz Video Upscale (Replicate)', 92, 2, 0.5, { inputMap: { scale: '' }, params: { target_resolution: '1080p' } }),
  m('replicate', 'remove-bg', 'recraft-ai/recraft-remove-background', 'Recraft Freistellen (Replicate)', 88, 5, 0.01),
  m('replicate', 'tts', 'minimax/speech-02-hd', 'MiniMax Speech 02 HD (Replicate)', 88, 4, 0.05, { inputMap: { prompt: 'text', voice: 'voice_id' } }),
  m('replicate', 'music', 'google/lyria-2', 'Lyria 2 Musik (Replicate)', 88, 3, 0.1, { inputMap: { duration: '' } }),

  // ================= Runway =================
  m('runway', 'image-to-video', 'gen4_turbo', 'Runway Gen-4 Turbo', 89, 4, 0.25, F({ durations: [5, 10], requiresImage: true })),
  m('runway', 'text-to-image', 'gen4_image', 'Runway Gen-4 Image (Referenzen)', 88, 3, 0.08, F({ refs: true, maxRefs: 3 })),
  m('runway', 'upscale-video', 'upscale_v1', 'Runway 4K Upscale', 86, 3, 0.1),

  // ================= Luma =================
  m('luma', 'text-to-video', 'ray-2', 'Luma Ray 2', 87, 3, 0.5, F({ durations: [5, 9] })),
  m('luma', 'text-to-video', 'ray-flash-2', 'Luma Ray Flash 2', 81, 5, 0.2, F({ durations: [5, 9] })),
  m('luma', 'image-to-video', 'ray-2', 'Luma Ray 2', 87, 3, 0.5, F({ endFrame: true, durations: [5, 9] })),
  m('luma', 'image-to-video', 'ray-flash-2', 'Luma Ray Flash 2', 81, 5, 0.2, F({ endFrame: true, durations: [5, 9] })),
  m('luma', 'text-to-image', 'photon-1', 'Luma Photon', 85, 4, 0.02, F({ refs: true, maxRefs: 4 })),
  m('luma', 'text-to-image', 'photon-flash-1', 'Luma Photon Flash', 79, 5, 0.005, F({ refs: true, maxRefs: 4 })),

  // ================= Stability =================
  m('stability', 'text-to-image', '/v2beta/stable-image/generate/ultra', 'Stable Image Ultra', 86, 3, 0.08, F({ negative: true })),
  m('stability', 'text-to-image', '/v2beta/stable-image/generate/core', 'Stable Image Core', 79, 5, 0.03, F({ negative: true })),
  m('stability', 'image-edit', 'inpaint', 'Stability Inpaint / Struktur', 82, 4, 0.03, F({ mask: true, negative: true, maxRefs: 1 })),
  m('stability', 'upscale-image', '/v2beta/stable-image/upscale/fast', 'Stability Fast Upscale (4×)', 80, 5, 0.01),
  m('stability', 'remove-bg', '/v2beta/stable-image/edit/remove-background', 'Stability Freistellen', 86, 5, 0.02),

  // ================= Black Forest Labs =================
  m('bfl', 'text-to-image', 'flux-pro-1.1-ultra', 'FLUX 1.1 Pro Ultra (BFL)', 91, 4, 0.06),
  m('bfl', 'image-edit', 'flux-kontext-pro', 'FLUX Kontext Pro (BFL)', 90, 4, 0.04, F({ refs: true, maxRefs: 4 })),
  m('bfl', 'image-edit', 'flux-kontext-max', 'FLUX Kontext Max (BFL)', 92, 3, 0.08, F({ refs: true, maxRefs: 4 })),

  // ================= ElevenLabs =================
  m('elevenlabs', 'tts', 'eleven_v3', 'ElevenLabs v3 (expressiv)', 97, 3, 0.05),
  m('elevenlabs', 'tts', 'eleven_multilingual_v2', 'ElevenLabs Multilingual v2', 96, 4, 0.04),
  m('elevenlabs', 'tts', 'eleven_flash_v2_5', 'ElevenLabs Flash 2.5', 88, 5, 0.02),
  m('elevenlabs', 'sfx', 'sound-generation', 'ElevenLabs Soundeffekte', 92, 4, 0.03),
  m('elevenlabs', 'music', 'music_v1', 'ElevenLabs Music', 91, 2, 0.2),

  // ================= Hugging Face =================
  m('huggingface', 'text-to-image', 'black-forest-labs/FLUX.1-schnell', 'FLUX.1 Schnell (HF)', 72, 4, 0.001),
  m('huggingface', 'text-to-image', 'stabilityai/stable-diffusion-xl-base-1.0', 'SDXL (HF)', 65, 4, 0.001, F({ negative: true })),
  m('huggingface', 'llm', 'openai/gpt-oss-120b', 'GPT-OSS 120B (HF)', 82, 4, 0.001),

  // ================= OpenRouter =================
  m('openrouter', 'llm', 'openai/gpt-5', 'GPT-5 (OpenRouter)', 93, 2, 0.02, F({ vision: true })),
  m('openrouter', 'llm', 'google/gemini-2.5-pro', 'Gemini 2.5 Pro (OpenRouter)', 92, 2, 0.01, F({ vision: true })),
  m('openrouter', 'llm', 'x-ai/grok-4', 'Grok 4 (OpenRouter)', 90, 2, 0.02, F({ vision: true })),
  m('openrouter', 'llm', 'deepseek/deepseek-chat', 'DeepSeek V3 (OpenRouter)', 85, 4, 0.001),
  m('openrouter', 'llm', 'meta-llama/llama-4-maverick', 'Llama 4 Maverick (OpenRouter)', 82, 4, 0.001, F({ vision: true })),
  m('openrouter', 'text-to-image', 'google/gemini-2.5-flash-image', 'Gemini 2.5 Flash Image (OpenRouter)', 90, 4, 0.04),
  m('openrouter', 'image-edit', 'google/gemini-2.5-flash-image', 'Gemini 2.5 Flash Image Edit (OpenRouter)', 93, 4, 0.04, F({ refs: true, maxRefs: 3 })),

  // ================= Cloudflare Workers AI (10.000 Gratis-Neuronen/Tag) =================
  m('cloudflare', 'text-to-image', '@cf/black-forest-labs/flux-1-schnell', 'FLUX.1 schnell (Cloudflare, gratis)', 80, 5, 0, {
    params: { steps: 6 },
    free: 'quota',
    freeNote: '≈ 60 Neuronen/Bild → über 100 Bilder pro Tag gratis (nur quadratisch)',
  }),
  m('cloudflare', 'text-to-image', '@cf/leonardo/phoenix-1.0', 'Leonardo Phoenix 1.0 (Cloudflare)', 85, 4, 0, {
    ...F({ negative: true }),
    free: 'quota',
    freeNote: 'Höherer Verbrauch – einige Bilder pro Tag gratis',
  }),
  m('cloudflare', 'text-to-image', '@cf/leonardo/lucid-origin', 'Leonardo Lucid Origin (Cloudflare)', 86, 4, 0, {
    free: 'quota',
    freeNote: 'Höherer Verbrauch – wenige Bilder pro Tag gratis',
  }),
  m('cloudflare', 'tts', '@cf/myshell-ai/melotts', 'MeloTTS (Cloudflare, gratis)', 58, 5, 0, {
    free: 'quota',
    freeNote: 'Sehr günstig – Englisch/Spanisch/Französisch/Chinesisch/Japanisch/Koreanisch (kein Deutsch)',
  }),
  m('cloudflare', 'llm', '@cf/nvidia/nemotron-3-120b-a12b', 'Nemotron 3 120B (Cloudflare, gratis)', 84, 4, 0, { free: 'quota', freeNote: 'Workers-AI Free-Plan' }),
  m('cloudflare', 'llm', '@cf/google/gemma-4-26b-a4b-it', 'Gemma 4 26B (Cloudflare, gratis)', 80, 4, 0, { free: 'quota', freeNote: 'Workers-AI Free-Plan' }),

  // ================= Pollinations (ohne Anmeldung) =================
  m('pollinations', 'text-to-image', 'classic', 'Pollinations Classic (ohne Anmeldung)', 62, 3, 0, {
    ...F({ batch: true }),
    free: 'nokey',
    freeNote: 'Komplett gratis ohne Konto – gedrosselt (~1 Bild / 45 s), max. ~768 px, kleines Wasserzeichen',
  }),
  m('pollinations', 'llm', 'classic-text', 'Pollinations Text (ohne Anmeldung)', 55, 3, 0, {
    free: 'nokey',
    freeNote: 'Gratis ohne Konto – gedrosselt',
  }),

  // ================= Demo (offline) =================
  m('demo', 'text-to-image', 'demo-image', 'Demo Bild (offline)', 1, 5, 0, F({ batch: true, refs: true, maxRefs: 4 })),
  m('demo', 'image-edit', 'demo-edit', 'Demo Bearbeitung (offline)', 1, 5, 0, F({ refs: true, maxRefs: 4, mask: true })),
  m('demo', 'upscale-image', 'demo-upscale', 'Demo Upscale (offline)', 1, 5, 0),
  m('demo', 'remove-bg', 'demo-bg', 'Demo Freistellen (offline)', 1, 5, 0),
  m('demo', 'image-to-video', 'demo-video', 'Demo Video (ffmpeg)', 1, 5, 0, F({ endFrame: true })),
  m('demo', 'text-to-video', 'demo-video', 'Demo Video (ffmpeg)', 1, 5, 0),
  m('demo', 'tts', 'demo-tts', 'Demo Stimme (Synthese)', 1, 5, 0),
  m('demo', 'sfx', 'demo-sfx', 'Demo Soundeffekt', 1, 5, 0),
  m('demo', 'music', 'demo-music', 'Demo Musik', 1, 5, 0),
  m('demo', 'llm', 'demo-llm', 'Demo Prompt-Assistent (regelbasiert)', 1, 5, 0),
];

// ---------- Dynamische Modelle (Ollama, ComfyUI, HTTP) ----------
let dynamicModels: ModelDef[] = [];

export async function refreshDynamic(): Promise<void> {
  const out: ModelDef[] = [];
  await Promise.all(
    db.connections
      .filter((c) => c.enabled && ADAPTERS[c.type]?.listModels)
      .map(async (c) => {
        try {
          out.push(...(await ADAPTERS[c.type].listModels!(c, decrypt(c.apiKey))));
        } catch {
          /* Verbindung gerade nicht erreichbar */
        }
      }),
  );
  dynamicModels = out;
}

export function allModels(): ModelDef[] {
  const overrides = db.modelOverrides || {};
  const list = [...STATIC_MODELS, ...db.customModels.map((c) => ({ ...c, custom: true })), ...dynamicModels];
  return list.map((mod) => {
    const o = overrides[mod.id];
    return o?.quality != null ? { ...mod, quality: o.quality } : mod;
  });
}

export function isDisabled(id: string) {
  return !!db.modelOverrides?.[id]?.disabled;
}

export function getModel(id: string): ModelDef | undefined {
  return allModels().find((x) => x.id === id);
}

function connReady(c: Connection): boolean {
  if (!c.enabled) return false;
  const info = ADAPTERS[c.type]?.info;
  if (!info) return false;
  if (info.needsKey && !decrypt(c.apiKey)) return false;
  if (info.baseUrl?.required && !c.baseUrl) return false;
  return true;
}

export function connectionFor(model: ModelDef): Connection | undefined {
  if (model.connectionId) {
    const c = db.connections.find((x) => x.id === model.connectionId);
    return c && connReady(c) ? c : undefined;
  }
  return db.connections.find((c) => c.type === model.provider && connReady(c));
}

export function isAvailable(model: ModelDef): boolean {
  return !isDisabled(model.id) && !!connectionFor(model);
}

export function availableModels(task?: Task): ModelDef[] {
  return allModels().filter((x) => (!task || x.task === task) && isAvailable(x));
}

function score(mod: ModelDef, mode: RoutingMode): number {
  switch (mode) {
    case 'speed':
      return mod.speed * 20 + mod.quality * 0.3;
    case 'cost':
      return -Math.log10(mod.cost + 0.001) * 25 + mod.quality * 0.4;
    case 'balanced':
      return mod.quality - Math.log10(1 + mod.cost * 10) * 8 + mod.speed * 1.5;
    case 'free':
      return mod.quality + mod.speed * 0.1;
    case 'free-first':
      return (isFree(mod) ? 1000 : 0) + mod.quality + mod.speed * 0.1;
    default:
      return mod.quality + mod.speed * 0.1;
  }
}

/** Prüft, ob ein Modell die Anforderungen der Anfrage erfüllt */
export function fits(mod: ModelDef, req: GenRequest): boolean {
  const f = mod.features || {};
  if (req.endImage && mod.task === 'image-to-video' && !f.endFrame) return false;
  if (req.mask && mod.task === 'image-edit' && !f.mask) return false;
  if (mod.task === 'lipsync') {
    if (req.video && !req.image && f.inputImage && !f.inputVideo) return false;
    if (req.image && !req.video && f.inputVideo && !f.inputImage) return false;
  }
  if (mod.task === 'text-to-image' && req.refImages?.length && !f.refs) return false;
  if (mod.task === 'image-edit' && (req.refImages?.length || 0) + (req.image ? 1 : 0) > Math.max(1, f.maxRefs ?? 1) && !f.refs) return false;
  return true;
}

/** Smart-Router: sortierte Kandidatenliste (beste zuerst) für eine Aufgabe */
export function rankModels(task: Task, req: GenRequest, mode: RoutingMode = db.settings.routing): ModelDef[] {
  let cands = availableModels(task).filter((x) => fits(x, req));
  if (mode === 'free') cands = cands.filter(isFree);
  // Ton gewünscht -> Modelle mit Audio bevorzugen
  const bonus = (x: ModelDef) => (req.withAudio && x.features?.audio ? 6 : 0);
  return cands.sort((a, b) => score(b, mode) + bonus(b) - (score(a, mode) + bonus(a)));
}

/** Bestes LLM für Prompt-Verbesserung/Jury */
export function pickLlm(preferredId: string, needVision = false): ModelDef[] {
  let all = availableModels('llm').filter((x) => !needVision || x.features?.vision || x.provider === 'demo');
  if (db.settings.routing === 'free') all = all.filter(isFree);
  const sorted = all.sort((a, b) => (db.settings.routing === 'free-first' ? Number(isFree(b)) - Number(isFree(a)) : 0) || b.quality - a.quality);
  if (preferredId && preferredId !== 'auto') {
    const p = sorted.find((x) => x.id === preferredId);
    if (p) return [p, ...sorted.filter((x) => x !== p)];
  }
  return sorted;
}
