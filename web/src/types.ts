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

export const TASK_LABEL: Record<Task, string> = {
  'text-to-image': 'Text → Bild',
  'image-edit': 'Bild bearbeiten',
  'text-to-video': 'Text → Video',
  'image-to-video': 'Bild → Video',
  lipsync: 'Lipsync / Avatar',
  'upscale-image': 'Bild-Upscale',
  'upscale-video': 'Video-Upscale',
  'remove-bg': 'Freistellen',
  tts: 'Sprache (TTS)',
  sfx: 'Soundeffekte',
  music: 'Musik',
  llm: 'Sprachmodell (Regie & Jury)',
};

export const TASK_SHORT: Record<Task, string> = {
  'text-to-image': 'Bild',
  'image-edit': 'Bearbeiten',
  'text-to-video': 'Video',
  'image-to-video': 'Video',
  lipsync: 'Lipsync',
  'upscale-image': 'Upscale',
  'upscale-video': 'Upscale',
  'remove-bg': 'Freistellen',
  tts: 'Stimme',
  sfx: 'Sound',
  music: 'Musik',
  llm: 'Sprach-KI',
};

export interface ModelFeatures {
  endFrame?: boolean;
  refs?: boolean;
  maxRefs?: number;
  mask?: boolean;
  audio?: boolean;
  negative?: boolean;
  batch?: boolean;
  inputImage?: boolean;
  inputVideo?: boolean;
  vision?: boolean;
  durations?: number[];
  requiresImage?: boolean;
}

export interface Model {
  id: string;
  provider: string;
  connectionId?: string;
  task: Task;
  label: string;
  model: string;
  quality: number;
  speed: number;
  cost: number;
  features?: ModelFeatures;
  params?: Record<string, unknown>;
  inputMap?: Record<string, string>;
  custom?: boolean;
  available: boolean;
  disabled: boolean;
  connectionName?: string;
}

export interface ConfigField {
  key: string;
  label: string;
  type: 'text' | 'password' | 'textarea' | 'json';
  placeholder?: string;
  help?: string;
}

export interface ProviderInfo {
  type: string;
  label: string;
  description: string;
  website?: string;
  keyUrl?: string;
  tasks: Task[];
  needsKey: boolean;
  baseUrl?: { default?: string; required?: boolean };
  multi?: boolean;
  fields?: ConfigField[];
}

export interface Connection {
  id: string;
  type: string;
  name: string;
  enabled: boolean;
  apiKey: string;
  hasKey: boolean;
  baseUrl?: string;
  options?: Record<string, any>;
  createdAt: number;
}

export interface Settings {
  routing: 'quality' | 'balanced' | 'speed' | 'cost';
  llmModelId: string;
  judgeModelId: string;
  autoEnhance: boolean;
  autoFallback: boolean;
  concurrency: number;
  language: string;
  publicUrl?: string;
}

export interface MotionKey {
  z?: number;
  x?: number;
  y?: number;
  r?: number;
  sx?: number;
}
export interface Motion {
  from: MotionKey;
  to: MotionKey;
  ease?: 'linear' | 'in' | 'out' | 'inout' | 'expo-in' | 'expo-out';
  shake?: number;
  blur?: number;
  loop?: boolean;
}
export interface CameraPreset {
  id: string;
  name: string;
  category: string;
  description: string;
  prompt: string;
  motion: Motion;
}
export interface EffectPreset {
  id: string;
  name: string;
  category: string;
  description: string;
  prompt: string;
  localFx?: string;
}
export interface StylePreset {
  id: string;
  name: string;
  prompt: string;
  negative?: string;
  swatch: string;
}

export interface Character {
  id: string;
  name: string;
  description: string;
  refAssetIds: string[];
  createdAt: number;
}

export interface Asset {
  id: string;
  kind: 'image' | 'video' | 'audio';
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
  meta?: Record<string, any>;
}

export interface GenRequest {
  task: Task;
  modelId?: string;
  prompt?: string;
  negativePrompt?: string;
  aspectRatio?: string;
  duration?: number;
  resolution?: string;
  seed?: number;
  count?: number;
  image?: string;
  endImage?: string;
  refImages?: string[];
  video?: string;
  audio?: string;
  mask?: string;
  maskAlpha?: string;
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
}

export interface Job {
  id: string;
  task: Task;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';
  request: GenRequest;
  finalPrompt?: string;
  modelId?: string;
  attempts: { modelId: string; startedAt: number; finishedAt?: number; error?: string }[];
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

export interface Arena {
  id: string;
  task: Task;
  prompt: string;
  entries: { modelId: string; jobId: string; score?: number; reason?: string }[];
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

export interface AppState {
  settings: Settings;
  connections: Connection[];
  providers: ProviderInfo[];
  models: Model[];
  characters: Character[];
  presets: { camera: CameraPreset[]; effects: EffectPreset[]; styles: StylePreset[] };
  tasks: Task[];
  env: { ffmpeg: boolean; publicUrl: string; passwordProtected: boolean };
}
