import { connectionFor, pickLlm } from './catalog.js';
import type { MediaInput } from './files.js';
import { cameraById, effectById, styleById } from './presets.js';
import { ADAPTERS } from './providers/index.js';
import type { LlmCall } from './providers/types.js';
import { db, decrypt } from './store.js';
import type { GenRequest, ModelDef, Task } from './types.js';
import { errMsg, ProviderError } from './util.js';
import { getAsset } from './files.js';

export interface LlmResult {
  text: string;
  modelId: string;
}

/** Ruft das beste verfügbare Sprachmodell auf – mit automatischem Fallback auf das nächste */
export async function callLlm(call: LlmCall, preferId = db.settings.llmModelId, signal?: AbortSignal): Promise<LlmResult> {
  const needVision = !!call.images?.length;
  const cands = pickLlm(preferId, needVision);
  if (!cands.length) throw new ProviderError('Kein Sprachmodell verbunden. Verbinde z. B. Claude, GPT, Gemini oder Ollama.', 400, false);
  const errors: string[] = [];
  for (const model of cands) {
    const conn = connectionFor(model);
    const ad = conn && ADAPTERS[conn.type];
    if (!conn || !ad?.llm) continue;
    try {
      const text = await ad.llm(conn, decrypt(conn.apiKey), model, call, signal);
      return { text: text.trim(), modelId: model.id };
    } catch (e) {
      errors.push(`${model.label}: ${errMsg(e)}`);
    }
  }
  throw new ProviderError(`Kein Sprachmodell konnte antworten – ${errors.join(' | ')}`);
}

const TASK_HINT: Record<Task, string> = {
  'text-to-image': 'a single still image',
  'image-edit': 'an edit instruction applied to the provided image(s); keep identity, composition and lighting unless asked otherwise',
  'text-to-video': 'a 5–10 second cinematic video clip (describe subject, action over time, camera movement, lighting, mood and sound)',
  'image-to-video': 'animating the provided start frame into a 5–10 second video (describe the motion, camera movement and atmosphere; do NOT re-describe the static image in detail)',
  lipsync: 'a talking-head performance',
  'upscale-image': 'upscaling',
  'upscale-video': 'upscaling',
  'remove-bg': 'background removal',
  tts: 'spoken narration text (keep the meaning, improve rhythm and clarity, keep the original language)',
  sfx: 'a sound effect description (precise, physical, layered)',
  music: 'a music generation prompt (genre, tempo/BPM, instruments, mood, structure)',
  llm: 'text',
};

const DIRECTOR_SYSTEM = `You are an award-winning film director, cinematographer and prompt engineer for generative AI models (image, video, audio).
Rewrite the user's idea into ONE optimized prompt that gets the best possible result from state-of-the-art models.
Rules:
- Write in English (except for spoken text/dialogue/narration which stays in its original language).
- Be concrete and visual: subject, action, setting, composition/shot size, lens, lighting, color palette, texture, mood.
- For video: describe motion over time and exactly one clear camera movement; keep it physically plausible; optionally add sound design.
- Keep all user-specified details, names, text in quotes, and constraints. Never add text overlays unless requested.
- 40–120 words. No preamble, no quotes, no markdown, no lists. Output only the prompt.`;

export async function enhancePrompt(prompt: string, task: Task, opts: { modelLabel?: string; image?: MediaInput } = {}, signal?: AbortSignal) {
  const { text, modelId } = await callLlm(
    {
      system: DIRECTOR_SYSTEM,
      prompt: `Target: ${TASK_HINT[task]}${opts.modelLabel ? ` (model: ${opts.modelLabel})` : ''}.\nUser idea:\n${prompt}`,
      images: opts.image ? [opts.image] : undefined,
      maxTokens: 2000,
      effort: 'low',
    },
    db.settings.llmModelId,
    signal,
  );
  return { prompt: cleanup(text), modelId };
}

export async function promptVariations(prompt: string, task: Task, n = 4, signal?: AbortSignal) {
  const { text, modelId } = await callLlm(
    {
      system: DIRECTOR_SYSTEM.replace('ONE optimized prompt', `${n} distinctly different optimized prompts (vary composition, lighting, mood and camera)`).replace(
        'Output only the prompt.',
        'Output a JSON array of strings only.',
      ),
      prompt: `Target: ${TASK_HINT[task]}.\nUser idea:\n${prompt}`,
      maxTokens: 4000,
      json: true,
      effort: 'low',
    },
    db.settings.llmModelId,
    signal,
  );
  const arr = parseJson<string[]>(text);
  const list = Array.isArray(arr) ? arr.filter((s) => typeof s === 'string') : text.split(/\n+/).map(cleanup).filter((s) => s.length > 20);
  return { prompts: list.slice(0, n).map(cleanup), modelId };
}

export async function describeImage(image: MediaInput, signal?: AbortSignal) {
  const { text, modelId } = await callLlm(
    {
      system:
        'You are an expert at reverse-engineering prompts. Describe the image as a single detailed generation prompt (subject, style, composition, lens, lighting, colors, mood). 50–110 words, English, no preamble.',
      prompt: 'Write the prompt that would recreate this image.',
      images: [image],
      maxTokens: 2000,
      effort: 'low',
    },
    db.settings.llmModelId,
    signal,
  );
  return { prompt: cleanup(text), modelId };
}

export interface JudgeScore {
  index: number;
  score: number;
  reason: string;
}

/** KI-Jury: bewertet mehrere Bilder anhand des Prompts und wählt den Gewinner */
export async function judgeImages(prompt: string, images: MediaInput[], signal?: AbortSignal) {
  const { text, modelId } = await callLlm(
    {
      system: `You are a strict art director judging AI-generated images for a client.
Score each image 0–100 on: prompt adherence (40%), aesthetic quality & composition (30%), technical quality — anatomy, hands, text, artifacts (30%).
Respond with JSON only: {"scores":[{"index":0,"score":87,"reason":"short reason in German"}],"winner":0,"summary":"one sentence in German"}`,
      prompt: `Prompt: "${prompt}"\nThere are ${images.length} images, in order (index 0 to ${images.length - 1}).`,
      images,
      maxTokens: 3000,
      json: true,
      effort: 'medium',
    },
    db.settings.judgeModelId,
    signal,
  );
  const parsed = parseJson<{ scores: JudgeScore[]; winner: number; summary?: string }>(text);
  if (!parsed?.scores) throw new ProviderError('Die KI-Jury lieferte kein auswertbares Ergebnis');
  return { ...parsed, modelId };
}

function cleanup(s: string): string {
  return s
    .trim()
    .replace(/^```[a-z]*\s*|```$/g, '')
    .replace(/^(prompt|optimized prompt)\s*:\s*/i, '')
    .replace(/^["'“„]|["'”“]$/g, '')
    .trim();
}

export function parseJson<T>(text: string): T | undefined {
  const t = text.trim().replace(/^```(?:json)?\s*|```$/g, '');
  try {
    return JSON.parse(t) as T;
  } catch {
    const m = t.match(/[[{][\s\S]*[\]}]/);
    if (m) {
      try {
        return JSON.parse(m[0]) as T;
      } catch {
        /* weiter */
      }
    }
  }
  return undefined;
}

/** Baut den finalen Prompt aus Text + Stil + Kamera + Effekt + Charakter */
export function composePrompt(req: GenRequest): { prompt: string; negative?: string } {
  const parts: string[] = [];
  const base = (req.prompt || '').trim();
  const character = req.characterId ? db.characters.find((c) => c.id === req.characterId) : undefined;
  if (character && !['tts', 'sfx', 'music'].includes(req.task)) {
    parts.push(base || character.description);
    if (base && character.description) parts.push(`The main character is ${character.name}: ${character.description}. Keep the character's face and identity exactly consistent with the reference images`);
  } else if (base) parts.push(base);

  const isVideo = req.task === 'text-to-video' || req.task === 'image-to-video';
  if (isVideo && req.camera?.length) {
    const cams = req.camera.map(cameraById).filter(Boolean);
    if (cams.length === 1) parts.push(`Camera: ${cams[0]!.prompt}`);
    else if (cams.length > 1) parts.push(`Camera: combined movement — ${cams.map((c) => c!.prompt).join(', while ')}`);
  }
  if (isVideo && req.effect) {
    const fx = effectById(req.effect);
    if (fx) parts.push(`Visual effect: ${fx.prompt}`);
  }
  let negative = req.negativePrompt;
  if (req.style && !['tts', 'sfx', 'music', 'lipsync'].includes(req.task)) {
    const st = styleById(req.style);
    if (st) {
      parts.push(`Style: ${st.prompt}`);
      if (st.negative) negative = [negative, st.negative].filter(Boolean).join(', ');
    }
  }
  return { prompt: parts.join('. ').replace(/\.\./g, '.'), negative };
}

export function characterRefs(req: GenRequest): string[] {
  if (!req.characterId) return req.refImages || [];
  const c = db.characters.find((x) => x.id === req.characterId);
  const refs = (c?.refAssetIds || []).filter((id) => getAsset(id));
  return [...(req.refImages || []), ...refs];
}

export type { ModelDef };
