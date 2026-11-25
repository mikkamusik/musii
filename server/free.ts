import { refreshDynamic } from './catalog.js';
import { db, decrypt, encrypt, save } from './store.js';
import type { Connection, ModelDef, ProviderType, Task } from './types.js';
import { ProviderError, uid } from './util.js';

/**
 * Gratis-Assistent: kuratierte Wege, gute Modelle kostenlos zu nutzen – mit Ein-Klick-Einrichtung.
 * Gruppen: nokey (ohne Anmeldung), quota (kostenloses Kontingent mit Konto), local (eigene Hardware)
 */

export interface SpacePreset {
  id: string;
  space: string;
  name: string;
  task: Task;
  apiName: string;
  quality: number;
  note: string;
}

export const HF_SPACES: SpacePreset[] = [
  { id: 'z-image', space: 'Tongyi-MAI/Z-Image-Turbo', name: 'Z-Image Turbo', task: 'text-to-image', apiName: '/generate', quality: 86, note: 'Sehr gute Fotos & Text im Bild' },
  { id: 'flux-schnell', space: 'black-forest-labs/FLUX.1-schnell', name: 'FLUX.1 schnell', task: 'text-to-image', apiName: '/infer', quality: 80, note: 'Schnell, vielseitig' },
  { id: 'qwen-edit', space: 'Qwen/Qwen-Image-Edit', name: 'Qwen Image Edit', task: 'image-edit', apiName: '/infer', quality: 87, note: 'Bildbearbeitung per Anweisung' },
  { id: 'kontext', space: 'black-forest-labs/FLUX.1-Kontext-Dev', name: 'FLUX.1 Kontext dev', task: 'image-edit', apiName: '/infer', quality: 85, note: 'Bearbeitung mit Identitätserhalt' },
  { id: 'wan22', space: 'zerogpu-aoti/wan2-2-fp8da-aoti-faster', name: 'Wan 2.2 (Bild → Video)', task: 'image-to-video', apiName: '/generate_video', quality: 84, note: 'Bestes offenes Videomodell, ~3–5 s Clips' },
  { id: 'ltx-t2v', space: 'Lightricks/ltx-video-distilled', name: 'LTX-Video (Text → Video)', task: 'text-to-video', apiName: '/text_to_video', quality: 74, note: 'Schnelle kurze Clips' },
  { id: 'ltx-i2v', space: 'Lightricks/ltx-video-distilled', name: 'LTX-Video (Bild → Video)', task: 'image-to-video', apiName: '/image_to_video', quality: 73, note: 'Schnelle kurze Clips' },
  { id: 'rmbg', space: 'not-lain/background-removal', name: 'Freistellen (BiRefNet)', task: 'remove-bg', apiName: '/png', quality: 85, note: 'Transparentes PNG' },
  { id: 'ace-step', space: 'ACE-Step/ACE-Step', name: 'ACE-Step Musik', task: 'music', apiName: '/__call__', quality: 78, note: 'Instrumentals bis 4 Min.' },
];

// ---------- ComfyUI-Workflow-Vorlagen (API-Format) ----------
const SDXL = {
  '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'sd_xl_base_1.0.safetensors' } },
  '5': { class_type: 'EmptyLatentImage', inputs: { width: '{{width}}', height: '{{height}}', batch_size: 1 } },
  '6': { class_type: 'CLIPTextEncode', inputs: { text: '{{prompt}}', clip: ['4', 1] } },
  '7': { class_type: 'CLIPTextEncode', inputs: { text: '{{negative_prompt}}', clip: ['4', 1] } },
  '3': {
    class_type: 'KSampler',
    inputs: { seed: '{{seed}}', steps: 30, cfg: 7, sampler_name: 'dpmpp_2m', scheduler: 'karras', denoise: 1, model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0] },
  },
  '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
  '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'musii', images: ['8', 0] } },
};

const FLUX_SCHNELL = {
  '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'flux1-schnell-fp8.safetensors' } },
  '5': { class_type: 'EmptySD3LatentImage', inputs: { width: '{{width}}', height: '{{height}}', batch_size: 1 } },
  '6': { class_type: 'CLIPTextEncode', inputs: { text: '{{prompt}}', clip: ['4', 1] } },
  '7': { class_type: 'CLIPTextEncode', inputs: { text: '', clip: ['4', 1] } },
  '3': {
    class_type: 'KSampler',
    inputs: { seed: '{{seed}}', steps: 4, cfg: 1, sampler_name: 'euler', scheduler: 'simple', denoise: 1, model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0] },
  },
  '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
  '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'musii', images: ['8', 0] } },
};

function wan22(withImage: boolean) {
  const wf: Record<string, unknown> = {
    '1': { class_type: 'UNETLoader', inputs: { unet_name: 'wan2.2_ti2v_5B_fp16.safetensors', weight_dtype: 'default' } },
    '2': { class_type: 'CLIPLoader', inputs: { clip_name: 'umt5_xxl_fp8_e4m3fn_scaled.safetensors', type: 'wan', device: 'default' } },
    '3': { class_type: 'VAELoader', inputs: { vae_name: 'wan2.2_vae.safetensors' } },
    '4': { class_type: 'ModelSamplingSD3', inputs: { shift: 8, model: ['1', 0] } },
    '5': { class_type: 'CLIPTextEncode', inputs: { text: '{{prompt}}', clip: ['2', 0] } },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: '{{negative_prompt}}', clip: ['2', 0] } },
    '8': {
      class_type: 'Wan22ImageToVideoLatent',
      inputs: { width: 1280, height: 704, length: 121, batch_size: 1, vae: ['3', 0], ...(withImage ? { start_image: ['7', 0] } : {}) },
    },
    '9': {
      class_type: 'KSampler',
      inputs: { seed: '{{seed}}', steps: 20, cfg: 5, sampler_name: 'uni_pc', scheduler: 'simple', denoise: 1, model: ['4', 0], positive: ['5', 0], negative: ['6', 0], latent_image: ['8', 0] },
    },
    '10': { class_type: 'VAEDecode', inputs: { samples: ['9', 0], vae: ['3', 0] } },
    '11': { class_type: 'CreateVideo', inputs: { fps: 24, images: ['10', 0] } },
    '12': { class_type: 'SaveVideo', inputs: { filename_prefix: 'musii', format: 'auto', codec: 'auto', video: ['11', 0] } },
  };
  if (withImage) wf['7'] = { class_type: 'LoadImage', inputs: { image: '{{image}}' } };
  return wf;
}

export const COMFY_TEMPLATES: { id: string; name: string; task: Task; models: string; workflow: unknown; experimental?: boolean }[] = [
  { id: 'flux-schnell', name: 'FLUX.1 schnell (Bild)', task: 'text-to-image', models: 'checkpoints/flux1-schnell-fp8.safetensors (Comfy-Org/flux1-schnell)', workflow: FLUX_SCHNELL },
  { id: 'sdxl', name: 'SDXL (Bild)', task: 'text-to-image', models: 'checkpoints/sd_xl_base_1.0.safetensors', workflow: SDXL },
  {
    id: 'wan22-i2v',
    name: 'Wan 2.2 5B (Bild → Video)',
    task: 'image-to-video',
    models: 'diffusion_models/wan2.2_ti2v_5B_fp16.safetensors, text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors, vae/wan2.2_vae.safetensors (Comfy-Org/Wan_2.2_ComfyUI_Repackaged)',
    workflow: wan22(true),
    experimental: true,
  },
  {
    id: 'wan22-t2v',
    name: 'Wan 2.2 5B (Text → Video)',
    task: 'text-to-video',
    models: 'wie Wan 2.2 Bild → Video',
    workflow: wan22(false),
    experimental: true,
  },
];

// ---------- Vorlagen ----------
export type FreeField = 'apiKey' | 'accountId' | 'baseUrl' | 'model' | 'spaces' | 'workflows';

export interface FreePreset {
  id: string;
  group: 'nokey' | 'quota' | 'local';
  title: string;
  provider: ProviderType;
  description: string;
  limits: string;
  signupUrl?: string;
  fields: FreeField[];
  keyLabel?: string;
  keyOptional?: boolean;
  defaultBaseUrl?: string;
  tasks: Task[];
  models?: Omit<ModelDef, 'id' | 'provider' | 'connectionId'>[];
}

export const FREE_PRESETS: FreePreset[] = [
  {
    id: 'pollinations',
    group: 'nokey',
    title: 'Pollinations.ai',
    provider: 'pollinations',
    description: 'Bilder und Text sofort ohne Konto. Mit kostenlosem Konto (sk_-Schlüssel) zusätzlich aktuelle Bild-, Video- und Stimmmodelle.',
    limits: 'Ohne Konto ca. 1 Bild / 45 s, max. ~768 px und mit kleinem Wasserzeichen. Mit kostenlosem Konto: Pollen-Guthaben je nach Konto-Stufe.',
    signupUrl: 'https://enter.pollinations.ai',
    fields: ['apiKey'],
    keyLabel: 'sk_-Schlüssel (optional)',
    keyOptional: true,
    tasks: ['text-to-image', 'llm', 'text-to-video', 'image-to-video', 'tts'],
  },
  {
    id: 'hf-spaces',
    group: 'nokey',
    title: 'Hugging Face Spaces (Gratis-GPU)',
    provider: 'hf-space',
    description:
      'Community-Spaces auf kostenlosen ZeroGPU-Grafikkarten: Z-Image, FLUX, Qwen-Edit, FLUX Kontext, Wan 2.2 Video, LTX-Video, Freistellen, ACE-Step-Musik. Schnittstellen werden automatisch erkannt.',
    limits: 'Ohne Konto wenige GPU-Minuten pro Tag, mit kostenlosem HF-Token mehr (PRO: deutlich mehr). Spaces können ausgelastet sein – der Smart-Router weicht dann aus.',
    signupUrl: 'https://huggingface.co/settings/tokens',
    fields: ['spaces', 'apiKey'],
    keyLabel: 'HF-Token (optional, „Read“ reicht)',
    keyOptional: true,
    tasks: ['text-to-image', 'image-edit', 'image-to-video', 'text-to-video', 'remove-bg', 'music'],
  },
  {
    id: 'gemini',
    group: 'quota',
    title: 'Google Gemini (Free Tier)',
    provider: 'google',
    description: 'Gemini Flash und Flash-Lite als starke KI-Regie und Vision-Jury – kostenlos mit einem AI-Studio-Schlüssel ohne hinterlegte Abrechnung.',
    limits: 'Tageslimits pro Projekt (siehe AI Studio). Bild-/Videomodelle (Imagen, Veo) sind in der API meist kostenpflichtig.',
    signupUrl: 'https://aistudio.google.com/apikey',
    fields: ['apiKey'],
    keyLabel: 'Gemini-API-Schlüssel',
    tasks: ['llm'],
  },
  {
    id: 'cloudflare',
    group: 'quota',
    title: 'Cloudflare Workers AI',
    provider: 'cloudflare',
    description: 'FLUX.1 schnell, Leonardo Phoenix & Lucid Origin, Nemotron/Gemma als Sprachmodelle, MeloTTS.',
    limits: '10.000 Neuronen pro Tag gratis (Reset 00:00 UTC) – reicht für über 100 FLUX-schnell-Bilder täglich.',
    signupUrl: 'https://dash.cloudflare.com/profile/api-tokens',
    fields: ['apiKey', 'accountId'],
    keyLabel: 'API-Token (Vorlage „Workers AI“)',
    tasks: ['text-to-image', 'llm', 'tts'],
  },
  {
    id: 'openrouter',
    group: 'quota',
    title: 'OpenRouter – :free-Modelle',
    provider: 'openrouter',
    description: 'Alle aktuell kostenlosen Sprachmodelle (u. a. Nemotron, Gemma 4, weitere) werden automatisch erkannt und als KI-Regie genutzt.',
    limits: 'ca. 50 Anfragen/Tag und 20/Minute (1.000/Tag nach einmaliger Aufladung).',
    signupUrl: 'https://openrouter.ai/settings/keys',
    fields: ['apiKey'],
    keyLabel: 'OpenRouter-Schlüssel',
    tasks: ['llm'],
  },
  {
    id: 'groq',
    group: 'quota',
    title: 'Groq (Free Tier)',
    provider: 'openai-compatible',
    description: 'Extrem schnelle Sprachmodelle (z. B. GPT-OSS 120B) – ideal für die KI-Regie.',
    limits: 'Kostenloser Plan mit Minuten-/Tageslimits pro Modell (siehe console.groq.com).',
    signupUrl: 'https://console.groq.com/keys',
    fields: ['apiKey'],
    keyLabel: 'Groq-API-Schlüssel',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    tasks: ['llm'],
    models: [{ task: 'llm', label: 'GPT-OSS 120B (Groq, gratis)', model: 'openai/gpt-oss-120b', quality: 84, speed: 5, cost: 0, free: 'quota', freeNote: 'Groq Free Tier' }],
  },
  {
    id: 'ollama',
    group: 'local',
    title: 'Ollama (lokale Sprachmodelle)',
    provider: 'ollama',
    description: 'Llama, Qwen, Gemma, Mistral, LLaVA … laufen auf deinem Rechner und werden automatisch erkannt.',
    limits: 'Unbegrenzt – nur deine Hardware. Installation: ollama.com, dann z. B. „ollama pull qwen3“.',
    signupUrl: 'https://ollama.com/download',
    fields: ['baseUrl'],
    defaultBaseUrl: 'http://127.0.0.1:11434',
    tasks: ['llm'],
  },
  {
    id: 'comfyui',
    group: 'local',
    title: 'ComfyUI + offene Modelle',
    provider: 'comfyui',
    description: 'Fertige Workflows für FLUX.1 schnell, SDXL und Wan 2.2 (Video) – einfach Modelle herunterladen und verbinden.',
    limits: 'Unbegrenzt. Bild: ab ~8 GB VRAM, Wan 2.2 5B: ab ~12–16 GB VRAM (mit Auslagerung).',
    signupUrl: 'https://github.com/comfyanonymous/ComfyUI',
    fields: ['baseUrl', 'workflows'],
    defaultBaseUrl: 'http://127.0.0.1:8188',
    tasks: ['text-to-image', 'image-to-video', 'text-to-video'],
  },
  {
    id: 'kokoro',
    group: 'local',
    title: 'Kokoro TTS (lokal)',
    provider: 'openai-compatible',
    description: 'Natürliche Open-Source-Stimme über Kokoro-FastAPI (OpenAI-kompatibel, Docker).',
    limits: 'Unbegrenzt, läuft auch auf CPU. Sprachen: Englisch, Spanisch, Französisch, Italienisch, Portugiesisch, Japanisch, Chinesisch, Hindi.',
    signupUrl: 'https://github.com/remsky/Kokoro-FastAPI',
    fields: ['baseUrl'],
    defaultBaseUrl: 'http://127.0.0.1:8880/v1',
    tasks: ['tts'],
    models: [{ task: 'tts', label: 'Kokoro (lokal)', model: 'kokoro', quality: 80, speed: 4, cost: 0, free: 'local', freeNote: 'Lokal – unbegrenzt', params: { voice: 'af_heart' } }],
  },
  {
    id: 'lmstudio',
    group: 'local',
    title: 'LM Studio / vLLM / LocalAI',
    provider: 'openai-compatible',
    description: 'Jedes lokal laufende Sprachmodell mit OpenAI-kompatibler Schnittstelle.',
    limits: 'Unbegrenzt – nur deine Hardware.',
    signupUrl: 'https://lmstudio.ai',
    fields: ['baseUrl', 'model'],
    defaultBaseUrl: 'http://127.0.0.1:1234/v1',
    tasks: ['llm'],
  },
];

export interface ApplyBody {
  id: string;
  apiKey?: string;
  accountId?: string;
  baseUrl?: string;
  model?: string;
  spaces?: string[];
  workflows?: string[];
}

function upsertSingle(type: ProviderType, name: string, patch: Partial<Connection>): Connection {
  let c = db.connections.find((x) => x.type === type);
  if (!c) {
    c = { id: uid('cn_'), type, name, enabled: true, options: {}, createdAt: Date.now() };
    db.connections.push(c);
  }
  Object.assign(c, { enabled: true }, patch, { options: { ...(c.options || {}), ...(patch.options || {}) } });
  return c;
}

function upsertByPreset(type: ProviderType, presetKey: string, name: string, patch: Partial<Connection>): Connection {
  let c = db.connections.find((x) => x.type === type && x.options?.presetId === presetKey);
  if (!c) {
    c = { id: uid('cn_'), type, name, enabled: true, options: { presetId: presetKey }, createdAt: Date.now() };
    db.connections.push(c);
  }
  Object.assign(c, { enabled: true, name }, patch, { options: { ...(c.options || {}), ...(patch.options || {}), presetId: presetKey } });
  return c;
}

function ensureModel(conn: Connection, def: Omit<ModelDef, 'id' | 'provider' | 'connectionId'>, provider: ProviderType) {
  const existing = db.customModels.find((m) => m.connectionId === conn.id && m.model === def.model && m.task === def.task);
  if (existing) return Object.assign(existing, def);
  db.customModels.push({ ...def, id: `custom:${uid()}`, provider, connectionId: conn.id, custom: true });
}

const keyPatch = (k?: string) => (k && k.trim() ? { apiKey: encrypt(k.trim()) } : {});

export async function applyPreset(body: ApplyBody): Promise<{ ok: true; message: string }> {
  const p = FREE_PRESETS.find((x) => x.id === body.id);
  if (!p) throw new ProviderError('Unbekannte Vorlage', 404, false);
  const needKey = p.fields.includes('apiKey') && !p.keyOptional;
  const existingKey = db.connections.find((c) => c.type === p.provider && decrypt(c.apiKey));
  if (needKey && !body.apiKey?.trim() && !existingKey) throw new ProviderError(`Bitte ${p.keyLabel || 'API-Schlüssel'} eintragen`, 400, false);
  let message = '';
  switch (p.id) {
    case 'pollinations':
      upsertSingle('pollinations', 'Pollinations.ai', keyPatch(body.apiKey));
      message = body.apiKey ? 'Pollinations mit Konto verbunden – Gen-Modelle werden geladen' : 'Pollinations ohne Anmeldung aktiviert';
      break;
    case 'hf-spaces': {
      if (body.apiKey?.trim()) upsertSingle('huggingface', 'Hugging Face', keyPatch(body.apiKey));
      const ids = body.spaces?.length ? body.spaces : HF_SPACES.map((s) => s.id);
      for (const id of ids) {
        const s = HF_SPACES.find((x) => x.id === id);
        if (!s) continue;
        upsertByPreset('hf-space', `space:${s.id}`, `${s.name} (HF Space)`, {
          baseUrl: s.space,
          options: { task: s.task, apiName: s.apiName, quality: s.quality },
        });
      }
      message = `${ids.length} Gratis-Spaces aktiviert${body.apiKey ? ' (mit HF-Token)' : ''}`;
      break;
    }
    case 'gemini':
      upsertSingle('google', 'Google Gemini', keyPatch(body.apiKey));
      message = 'Gemini verbunden – Flash/Flash-Lite werden als Gratis-KI-Regie genutzt';
      break;
    case 'cloudflare':
      if (!body.accountId?.trim() && !db.connections.find((c) => c.type === 'cloudflare')?.options?.accountId) {
        throw new ProviderError('Bitte die Cloudflare Account-ID eintragen', 400, false);
      }
      upsertSingle('cloudflare', 'Cloudflare Workers AI', { ...keyPatch(body.apiKey), ...(body.accountId ? { options: { accountId: body.accountId.trim() } } : {}) });
      message = 'Cloudflare Workers AI verbunden – 10.000 Gratis-Neuronen pro Tag';
      break;
    case 'openrouter':
      upsertSingle('openrouter', 'OpenRouter', keyPatch(body.apiKey));
      message = 'OpenRouter verbunden – kostenlose Modelle werden automatisch erkannt';
      break;
    case 'ollama':
      upsertSingle('ollama', 'Ollama (lokal)', { baseUrl: body.baseUrl?.trim() || p.defaultBaseUrl });
      message = 'Ollama verbunden – lokale Modelle werden erkannt, sobald Ollama läuft';
      break;
    case 'comfyui': {
      const tpls = COMFY_TEMPLATES.filter((t) => (body.workflows?.length ? body.workflows : ['flux-schnell']).includes(t.id));
      const workflows: Record<string, string> = {};
      for (const t of tpls) if (!workflows[t.task]) workflows[t.task] = JSON.stringify(t.workflow, null, 1);
      upsertByPreset('comfyui', 'comfy:free', 'ComfyUI (lokal)', { baseUrl: body.baseUrl?.trim() || p.defaultBaseUrl, options: { workflows, quality: 82 } });
      message = `ComfyUI mit ${tpls.length} Workflow-Vorlage(n) verbunden`;
      break;
    }
    case 'groq':
    case 'kokoro':
    case 'lmstudio': {
      const conn = upsertByPreset('openai-compatible', `preset:${p.id}`, p.title, {
        baseUrl: body.baseUrl?.trim() || p.defaultBaseUrl,
        ...keyPatch(body.apiKey),
      });
      const models = p.models ? [...p.models] : [];
      if (p.id === 'lmstudio') {
        if (!body.model?.trim()) throw new ProviderError('Bitte die Modell-ID aus LM Studio eintragen', 400, false);
        models.push({ task: 'llm', label: `${body.model.trim()} (lokal)`, model: body.model.trim(), quality: 75, speed: 3, cost: 0, free: 'local', freeNote: 'Lokal – unbegrenzt' });
      }
      for (const m of models) ensureModel(conn, m, 'openai-compatible');
      message = `${p.title} verbunden`;
      break;
    }
    default:
      throw new ProviderError('Vorlage nicht umsetzbar', 400, false);
  }
  save();
  await refreshDynamic();
  return { ok: true, message };
}

export function presetStatus() {
  return FREE_PRESETS.map((p) => {
    let active = false;
    if (p.id === 'hf-spaces') active = db.connections.some((c) => c.type === 'hf-space' && c.enabled);
    else if (['groq', 'kokoro', 'lmstudio'].includes(p.id)) active = db.connections.some((c) => c.options?.presetId === `preset:${p.id}` && c.enabled);
    else if (p.id === 'comfyui') active = db.connections.some((c) => c.type === 'comfyui' && c.enabled);
    else {
      const c = db.connections.find((x) => x.type === p.provider && x.enabled);
      active = !!c && (p.keyOptional || !p.fields.includes('apiKey') || !!decrypt(c.apiKey));
    }
    return { id: p.id, active };
  });
}
