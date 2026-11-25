import type { ProviderType } from '../types.js';
import { anthropicAdapter } from './anthropic.js';
import { bflAdapter } from './bfl.js';
import { cloudflareAdapter } from './cloudflare.js';
import { comfyAdapter } from './comfyui.js';
import { compatAdapter, ollamaAdapter, openrouterAdapter } from './compat.js';
import { demoAdapter } from './demo.js';
import { elevenlabsAdapter } from './elevenlabs.js';
import { falAdapter } from './fal.js';
import { googleAdapter } from './google.js';
import { hfSpaceAdapter } from './hfspace.js';
import { httpAdapter } from './http.js';
import { huggingfaceAdapter } from './huggingface.js';
import { lumaAdapter } from './luma.js';
import { openaiAdapter } from './openai.js';
import { pollinationsAdapter } from './pollinations.js';
import { replicateAdapter } from './replicate.js';
import { runwayAdapter } from './runway.js';
import { stabilityAdapter } from './stability.js';
import type { ProviderAdapter } from './types.js';

export const ADAPTERS: Record<ProviderType, ProviderAdapter> = {
  openai: openaiAdapter,
  google: googleAdapter,
  anthropic: anthropicAdapter,
  fal: falAdapter,
  replicate: replicateAdapter,
  runway: runwayAdapter,
  luma: lumaAdapter,
  stability: stabilityAdapter,
  bfl: bflAdapter,
  elevenlabs: elevenlabsAdapter,
  huggingface: huggingfaceAdapter,
  openrouter: openrouterAdapter,
  ollama: ollamaAdapter,
  'openai-compatible': compatAdapter,
  comfyui: comfyAdapter,
  http: httpAdapter,
  cloudflare: cloudflareAdapter,
  pollinations: pollinationsAdapter,
  'hf-space': hfSpaceAdapter,
  demo: demoAdapter,
};

export function adapter(type: ProviderType): ProviderAdapter {
  const a = ADAPTERS[type];
  if (!a) throw new Error(`Unbekannter Provider ${type}`);
  return a;
}
