import type { MediaInput } from '../files.js';
import type { ResolvedRequest } from './types.js';
import { dimsFor } from './types.js';

/** Variablen für Vorlagen (ComfyUI-Workflows, eigene HTTP-APIs) */
export function templateVars(
  req: ResolvedRequest,
  extra: Record<string, unknown> = {},
  fileUrl: (m: MediaInput) => string = (m) => m.publicUrl() || m.dataUri(),
): Record<string, unknown> {
  const { width, height } = dimsFor(req.aspectRatio, 1);
  return {
    prompt: req.prompt,
    negative_prompt: req.negativePrompt || '',
    seed: req.seed ?? Math.floor(Math.random() * 2 ** 31),
    width,
    height,
    aspect_ratio: req.aspectRatio || '16:9',
    duration: req.duration ?? 5,
    count: req.count ?? 1,
    voice: req.voice || '',
    image_url: req.image ? fileUrl(req.image) : '',
    image_b64: req.image ? req.image.base64() : '',
    end_image_url: req.endImage ? fileUrl(req.endImage) : '',
    video_url: req.video ? fileUrl(req.video) : '',
    audio_url: req.audio ? fileUrl(req.audio) : '',
    mask_url: req.mask ? fileUrl(req.mask) : '',
    ref_image_urls: req.refImages.map((r) => fileUrl(r)),
    ...extra,
  };
}

/**
 * Ersetzt Platzhalter in einer JSON-Vorlage.
 * "{{x}}" (komplett in Anführungszeichen) wird durch den JSON-Wert ersetzt (Zahlen bleiben Zahlen),
 * {{x}} innerhalb eines Strings wird als Text eingefügt.
 */
export function fillTemplate(template: string, vars: Record<string, unknown>): string {
  let out = template.replace(/"\{\{\s*([\w.]+)\s*\}\}"/g, (_m, key) => JSON.stringify(vars[key] ?? ''));
  out = out.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key) => {
    const v = vars[key];
    const s = typeof v === 'string' ? v : JSON.stringify(v ?? '');
    return JSON.stringify(s).slice(1, -1);
  });
  return out;
}

export function fillString(template: string, vars: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key) => {
    const v = vars[key];
    return typeof v === 'string' ? v : JSON.stringify(v ?? '');
  });
}
