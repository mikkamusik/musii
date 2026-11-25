import type { MediaInput, ProviderOutput } from '../files.js';
import type { Connection, GenRequest, ModelDef, ProviderType, Task } from '../types.js';

export interface ResolvedRequest extends Omit<GenRequest, 'image' | 'endImage' | 'refImages' | 'video' | 'audio' | 'mask' | 'maskAlpha'> {
  prompt: string;
  image?: MediaInput;
  endImage?: MediaInput;
  refImages: MediaInput[];
  video?: MediaInput;
  audio?: MediaInput;
  mask?: MediaInput;
  maskAlpha?: MediaInput;
}

export interface RunCtx {
  conn: Connection;
  apiKey: string;
  model: ModelDef;
  req: ResolvedRequest;
  signal: AbortSignal;
  progress: (msg: string) => void;
}

export interface LlmCall {
  system?: string;
  prompt: string;
  images?: MediaInput[];
  maxTokens?: number;
  json?: boolean;
  /** Denkaufwand (Claude): low | medium | high */
  effort?: 'low' | 'medium' | 'high';
}

export interface ConfigField {
  key: string;
  label: string;
  type: 'text' | 'password' | 'textarea' | 'json';
  placeholder?: string;
  help?: string;
}

export interface ProviderInfo {
  type: ProviderType;
  label: string;
  description: string;
  website?: string;
  keyUrl?: string;
  /** Unterstützte Aufgaben (für die Übersicht) */
  tasks: Task[];
  needsKey: boolean;
  /** Basis-URL einstellbar */
  baseUrl?: { default?: string; required?: boolean };
  /** Mehrere Verbindungen dieses Typs möglich */
  multi?: boolean;
  /** Zusätzliche Konfigurationsfelder (options.*) */
  fields?: ConfigField[];
}

export interface ProviderAdapter {
  info: ProviderInfo;
  run(ctx: RunCtx): Promise<ProviderOutput[]>;
  llm?(conn: Connection, apiKey: string, model: ModelDef, call: LlmCall, signal?: AbortSignal): Promise<string>;
  test?(conn: Connection, apiKey: string): Promise<string>;
  /** Dynamische Modelle (z. B. Ollama, OpenRouter) */
  listModels?(conn: Connection, apiKey: string): Promise<ModelDef[]>;
}

// ---------- Hilfsfunktionen für Seitenverhältnisse ----------
export function parseAspect(ar?: string): [number, number] {
  const m = (ar || '16:9').match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  if (!m) return [16, 9];
  return [Number(m[1]), Number(m[2])];
}

/** Wählt aus einer Liste das am besten passende Seitenverhältnis */
export function nearestAspect(ar: string | undefined, options: string[]): string {
  const [w, h] = parseAspect(ar);
  const target = w / h;
  let best = options[0];
  let bestDiff = Infinity;
  for (const o of options) {
    const sep = o.includes(':') ? ':' : 'x';
    const [a, b] = o.split(sep).map(Number);
    const diff = Math.abs(Math.log(a / b) - Math.log(target));
    if (diff < bestDiff) {
      bestDiff = diff;
      best = o;
    }
  }
  return best;
}

/** Breite/Höhe (durch 64 teilbar) für eine Pixelzahl */
export function dimsFor(ar: string | undefined, megapixels = 1): { width: number; height: number } {
  const [w, h] = parseAspect(ar);
  const total = megapixels * 1024 * 1024;
  const width = Math.round(Math.sqrt((total * w) / h) / 64) * 64;
  const height = Math.round(Math.sqrt((total * h) / w) / 64) * 64;
  return { width, height };
}

export function nearestDuration(d: number | undefined, options: number[]): number {
  const t = d ?? options[0];
  return options.reduce((a, b) => (Math.abs(b - t) < Math.abs(a - t) ? b : a), options[0]);
}
