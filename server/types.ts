// Zentrale Typen für MUSII Studio

export type Task =
  | 'text-to-image'
  | 'image-edit'
  | 'text-to-video'
  | 'image-to-video'
  | 'lipsync'
  | 'upscale-image'
  | 'upscale-video'
  | 'remove-bg'
  | 'tts'
  | 'sfx'
  | 'music'
  | 'llm';

export const ALL_TASKS: Task[] = [
  'text-to-image',
  'image-edit',
  'text-to-video',
  'image-to-video',
  'lipsync',
  'upscale-image',
  'upscale-video',
  'remove-bg',
  'tts',
  'sfx',
  'music',
  'llm',
];

export type ProviderType =
  | 'openai'
  | 'google'
  | 'anthropic'
  | 'replicate'
  | 'fal'
  | 'runway'
  | 'luma'
  | 'stability'
  | 'bfl'
  | 'elevenlabs'
  | 'huggingface'
  | 'openrouter'
  | 'ollama'
  | 'openai-compatible'
  | 'comfyui'
  | 'http'
  | 'cloudflare'
  | 'pollinations'
  | 'hf-space'
  | 'demo';

export interface Connection {
  id: string;
  type: ProviderType;
  name: string;
  enabled: boolean;
  /** verschlüsselt gespeichert (enc:...) */
  apiKey?: string;
  baseUrl?: string;
  options?: Record<string, unknown>;
  createdAt: number;
}

export interface ModelFeatures {
  /** Endframe / Keyframe am Ende (Video) */
  endFrame?: boolean;
  /** Referenzbilder / Charakter-Konsistenz */
  refs?: boolean;
  /** Maximale Anzahl Referenzbilder */
  maxRefs?: number;
  /** Maske für Inpainting */
  mask?: boolean;
  /** Erzeugt Ton/Audio im Video */
  audio?: boolean;
  /** Negative Prompts */
  negative?: boolean;
  /** Mehrere Ergebnisse pro Aufruf */
  batch?: boolean;
  /** Lipsync: nimmt Bild als Eingabe */
  inputImage?: boolean;
  /** Lipsync: nimmt Video als Eingabe */
  inputVideo?: boolean;
  /** Vision (LLM) */
  vision?: boolean;
  /** Mögliche Videolängen in Sekunden */
  durations?: number[];
  /** Benötigt Eingabebild (i2v) */
  requiresImage?: boolean;
}

export interface ModelDef {
  id: string;
  provider: ProviderType;
  /** optional an konkrete Verbindung gebunden (eigene Modelle) */
  connectionId?: string;
  task: Task;
  label: string;
  /** provider-spezifische Modell-ID / Endpoint */
  model: string;
  /** 0-100, geschätzte Qualität für den Smart-Router */
  quality: number;
  /** 1 (langsam) – 5 (sehr schnell) */
  speed: number;
  /** geschätzte Kosten in USD pro Ergebnis */
  cost: number;
  features?: ModelFeatures;
  /** Standard-Parameter, die immer mitgeschickt werden */
  params?: Record<string, unknown>;
  /** Umbenennung der Standard-Eingabefelder (z. B. image -> start_image). Leerer String = Feld weglassen */
  inputMap?: Record<string, string>;
  /** Formatierung einzelner Felder */
  formats?: {
    /** number = 5, string = "5", s = "5s" */
    duration?: 'number' | 'string' | 's';
    /** erlaubte Seitenverhältnisse (wird auf das nächste gerundet) */
    aspects?: string[];
    /** Bilder als Liste statt einzeln senden */
    imageArray?: boolean;
    /** fal.ai: Seitenverhältnis als image_size-Preset (landscape_16_9 …) senden */
    imageSize?: boolean;
  };
  custom?: boolean;
  notes?: string;
  /** Kostenlos nutzbar: local = eigene Hardware/Browser, nokey = ohne Anmeldung, quota = Gratis-Kontingent */
  free?: 'local' | 'nokey' | 'quota';
  freeNote?: string;
}

export interface GenRequest {
  task: Task;
  modelId?: string; // 'auto' oder konkrete ID
  prompt?: string;
  negativePrompt?: string;
  aspectRatio?: string;
  duration?: number;
  resolution?: string;
  seed?: number;
  count?: number;
  /** Asset-IDs */
  image?: string;
  endImage?: string;
  refImages?: string[];
  video?: string;
  audio?: string;
  mask?: string;
  maskAlpha?: string;
  /** Kamera-Bewegungen (Preset-IDs, max. 3 = Mix) */
  camera?: string[];
  effect?: string;
  style?: string;
  characterId?: string;
  voice?: string;
  withAudio?: boolean;
  scale?: number;
  enhance?: boolean;
  fallback?: boolean;
  extraParams?: Record<string, unknown>;
  groupId?: string;
}

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';

export interface JobAttempt {
  modelId: string;
  startedAt: number;
  finishedAt?: number;
  error?: string;
}

export interface Job {
  id: string;
  task: Task;
  status: JobStatus;
  request: GenRequest;
  finalPrompt?: string;
  modelId?: string;
  attempts: JobAttempt[];
  outputs: string[];
  error?: string;
  progress?: string;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  cost?: number;
  groupId?: string;
  pipelineId?: string;
}

export type AssetKind = 'image' | 'video' | 'audio';

export interface Asset {
  id: string;
  kind: AssetKind;
  file: string;
  mime: string;
  size: number;
  name?: string;
  prompt?: string;
  modelId?: string;
  jobId?: string;
  source: 'generated' | 'upload' | 'local';
  favorite?: boolean;
  createdAt: number;
  meta?: Record<string, unknown>;
}

export interface Character {
  id: string;
  name: string;
  description: string;
  refAssetIds: string[];
  createdAt: number;
}

export interface ArenaEntry {
  modelId: string;
  jobId: string;
  score?: number;
  reason?: string;
}

export interface Arena {
  id: string;
  task: Task;
  prompt: string;
  entries: ArenaEntry[];
  judge: boolean;
  status: 'running' | 'judging' | 'done' | 'failed';
  winnerJobId?: string;
  judgeModelId?: string;
  judgeSummary?: string;
  error?: string;
  createdAt: number;
}

export interface PipelineStep {
  task: Task;
  modelId?: string;
  prompt?: string;
  /** Verknüpft Eingaben mit Ergebnissen vorheriger Schritte: { image: 0 } = Output von Schritt 0 */
  from?: Partial<Record<'image' | 'video' | 'audio' | 'endImage', number>>;
  options?: Partial<GenRequest>;
}

export interface Pipeline {
  id: string;
  name: string;
  steps: PipelineStep[];
  jobIds: string[];
  current: number;
  status: 'running' | 'succeeded' | 'failed';
  error?: string;
  createdAt: number;
}

export interface LedgerEntry {
  id: string;
  at: number;
  provider: ProviderType;
  modelId: string;
  task: Task;
  cost: number;
  jobId?: string;
}

export type RoutingMode = 'quality' | 'balanced' | 'speed' | 'cost' | 'free' | 'free-first';

export interface Settings {
  routing: RoutingMode;
  llmModelId: string; // 'auto' oder ID für Prompt-Verbesserer
  judgeModelId: string; // 'auto' oder ID für KI-Jury
  autoEnhance: boolean;
  autoFallback: boolean;
  concurrency: number;
  language: string;
  publicUrl?: string;
}

export interface DbShape {
  version: number;
  connections: Connection[];
  customModels: ModelDef[];
  modelOverrides: Record<string, { disabled?: boolean; quality?: number }>;
  jobs: Job[];
  assets: Asset[];
  characters: Character[];
  arenas: Arena[];
  pipelines: Pipeline[];
  ledger: LedgerEntry[];
  settings: Settings;
}
