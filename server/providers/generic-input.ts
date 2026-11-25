import type { MediaInput } from '../files.js';
import type { ModelDef, Task } from '../types.js';
import type { ResolvedRequest } from './types.js';
import { nearestAspect, nearestDuration } from './types.js';

/**
 * Baut aus einer Anfrage ein Eingabe-Objekt für Plattformen mit beliebigen Modellen
 * (Replicate, fal.ai, eigene HTTP-APIs). Feldnamen lassen sich per model.inputMap anpassen.
 */
export type Dialect = 'fal' | 'replicate';

const NAMES: Record<Dialect, Record<string, string>> = {
  fal: {
    prompt: 'prompt',
    negative_prompt: 'negative_prompt',
    aspect_ratio: 'aspect_ratio',
    duration: 'duration',
    seed: 'seed',
    count: 'num_images',
    image: 'image_url',
    images: 'image_urls',
    end_image: 'tail_image_url',
    video: 'video_url',
    audio: 'audio_url',
    mask: 'mask_url',
    resolution: 'resolution',
    voice: 'voice',
    scale: 'scale',
    generate_audio: 'generate_audio',
  },
  replicate: {
    prompt: 'prompt',
    negative_prompt: 'negative_prompt',
    aspect_ratio: 'aspect_ratio',
    duration: 'duration',
    seed: 'seed',
    count: 'num_outputs',
    image: 'image',
    images: 'image_input',
    end_image: 'end_image',
    video: 'video',
    audio: 'audio',
    mask: 'mask',
    resolution: 'resolution',
    voice: 'voice',
    scale: 'scale',
    generate_audio: 'generate_audio',
  },
};

const TASK_FIELDS: Record<Task, string[]> = {
  'text-to-image': ['prompt', 'negative_prompt', 'aspect_ratio', 'seed', 'count', 'images'],
  'image-edit': ['prompt', 'image', 'images', 'mask', 'seed', 'aspect_ratio', 'count'],
  'text-to-video': ['prompt', 'negative_prompt', 'aspect_ratio', 'duration', 'seed', 'resolution', 'generate_audio'],
  'image-to-video': ['prompt', 'negative_prompt', 'aspect_ratio', 'duration', 'seed', 'resolution', 'image', 'end_image', 'generate_audio'],
  lipsync: ['prompt', 'image', 'video', 'audio', 'resolution'],
  'upscale-image': ['image', 'scale', 'prompt'],
  'upscale-video': ['video', 'scale'],
  'remove-bg': ['image'],
  tts: ['prompt', 'voice'],
  sfx: ['prompt', 'duration'],
  music: ['prompt', 'duration'],
  llm: ['prompt'],
};

export function falImageSize(ar: string): string {
  return {
    '1:1': 'square_hd',
    '4:3': 'landscape_4_3',
    '3:2': 'landscape_4_3',
    '5:4': 'landscape_4_3',
    '16:9': 'landscape_16_9',
    '21:9': 'landscape_16_9',
    '3:4': 'portrait_4_3',
    '2:3': 'portrait_4_3',
    '4:5': 'portrait_4_3',
    '9:16': 'portrait_16_9',
    '9:21': 'portrait_16_9',
  }[nearestAspect(ar, ['1:1', '4:3', '3:2', '5:4', '16:9', '21:9', '3:4', '2:3', '4:5', '9:16', '9:21'])] as string;
}

export async function buildGenericInput(
  req: ResolvedRequest,
  model: ModelDef,
  dialect: Dialect,
  fileRef: (m: MediaInput) => Promise<string>,
): Promise<Record<string, unknown>> {
  const fields = new Set(TASK_FIELDS[model.task] || ['prompt']);
  const values: Record<string, unknown> = {};
  const f = model.formats || {};

  if (fields.has('prompt') && req.prompt) values.prompt = req.prompt;
  if (fields.has('negative_prompt') && req.negativePrompt && model.features?.negative !== false) values.negative_prompt = req.negativePrompt;
  if (fields.has('aspect_ratio') && req.aspectRatio && !(model.task === 'image-to-video' && req.image && !f.aspects)) {
    values.aspect_ratio = f.aspects ? nearestAspect(req.aspectRatio, f.aspects) : req.aspectRatio;
  }
  if (f.imageSize && values.aspect_ratio !== undefined) {
    values.image_size = falImageSize(String(values.aspect_ratio));
    delete values.aspect_ratio;
  } else if (f.imageSize && req.aspectRatio && fields.has('aspect_ratio')) {
    values.image_size = falImageSize(req.aspectRatio);
  }
  if (fields.has('duration') && req.duration) {
    const d = model.features?.durations ? nearestDuration(req.duration, model.features.durations) : req.duration;
    values.duration = f.duration === 'string' ? String(d) : f.duration === 's' ? `${d}s` : d;
  }
  if (fields.has('seed') && req.seed != null && Number.isFinite(req.seed)) values.seed = req.seed;
  if (fields.has('count') && (req.count || 1) > 1 && model.features?.batch) values.count = req.count;
  if (fields.has('resolution') && req.resolution) values.resolution = req.resolution;
  if (fields.has('voice') && req.voice) values.voice = req.voice;
  if (fields.has('scale') && req.scale) values.scale = req.scale;
  if (fields.has('generate_audio') && model.features?.audio && req.withAudio !== undefined) values.generate_audio = req.withAudio;

  // Bilder
  const refs = req.refImages || [];
  if (model.task === 'image-edit' || (model.task === 'text-to-image' && model.features?.refs)) {
    const all = [req.image, ...refs].filter(Boolean) as MediaInput[];
    if (all.length) {
      const multi = f.imageArray || (model.features?.maxRefs ?? 1) > 1;
      if (multi) values.images = await Promise.all(all.slice(0, model.features?.maxRefs ?? 10).map(fileRef));
      else values.image = await fileRef(all[0]);
    }
  } else if (fields.has('image') && req.image) {
    values.image = f.imageArray ? [await fileRef(req.image)] : await fileRef(req.image);
  }
  if (fields.has('end_image') && req.endImage && model.features?.endFrame) values.end_image = await fileRef(req.endImage);
  if (fields.has('mask') && req.mask) values.mask = await fileRef(req.mask);
  if (fields.has('video') && req.video) values.video = await fileRef(req.video);
  if (fields.has('audio') && req.audio) values.audio = await fileRef(req.audio);

  // Umbenennen
  const names = NAMES[dialect];
  const map = model.inputMap || {};
  const out: Record<string, unknown> = {};
  for (const [canon, v] of Object.entries(values)) {
    const target = canon in map ? map[canon] : names[canon] || canon;
    if (!target) continue;
    out[target] = v;
  }
  return { ...out, ...(model.params || {}), ...(req.extraParams || {}) };
}
