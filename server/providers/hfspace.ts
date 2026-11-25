import type { MediaInput, ProviderOutput } from '../files.js';
import { db, decrypt } from '../store.js';
import type { Connection, ModelDef, Task } from '../types.js';
import { collectUrls, http, httpJson, ProviderError, sleep } from '../util.js';
import type { ProviderAdapter, ResolvedRequest } from './types.js';
import { parseAspect } from './types.js';

/**
 * Hugging Face Spaces (Gradio): nutzt die kostenlosen ZeroGPU-Spaces der Community.
 * Die Schnittstelle des Spaces wird automatisch gelesen (/gradio_api/info) und die Parameter
 * werden anhand ihrer Namen belegt – so lässt sich fast jeder Space ohne Konfiguration anbinden.
 */

export interface GParam {
  parameter_name?: string | null;
  label?: string;
  component: string;
  parameter_has_default?: boolean;
  parameter_default?: unknown;
}
export interface GEndpoint {
  parameters: GParam[];
  returns: { component: string; label?: string }[];
}
export interface GInfo {
  named_endpoints: Record<string, GEndpoint>;
}

export function spaceHost(idOrUrl: string): string {
  const v = idOrUrl.trim().replace(/\/$/, '');
  if (/^https?:\/\//.test(v)) {
    // https://huggingface.co/spaces/owner/name -> owner-name.hf.space
    const m = v.match(/huggingface\.co\/spaces\/([^/]+)\/([^/?#]+)/);
    if (m) return spaceHost(`${m[1]}/${m[2]}`);
    return v;
  }
  const [owner, name] = v.split('/');
  if (!owner || !name) throw new ProviderError('Space-ID im Format „owner/name“ angeben', 400, false);
  return `https://${`${owner}-${name}`.toLowerCase().replace(/[._]/g, '-')}.hf.space`;
}

const MEDIA_OUT: Record<string, string[]> = {
  image: ['image', 'gallery', 'imageslider', 'file', 'imageeditor'],
  video: ['video', 'file'],
  audio: ['audio', 'file'],
};

function outKind(task: Task): 'image' | 'video' | 'audio' {
  if (['text-to-video', 'image-to-video', 'upscale-video', 'lipsync'].includes(task)) return 'video';
  if (['tts', 'sfx', 'music'].includes(task)) return 'audio';
  return 'image';
}

const pname = (p: GParam) => `${p.parameter_name || ''} ${p.label || ''}`.toLowerCase();
const isPromptLike = (p: GParam) => /textbox|textarea/i.test(p.component) && /prompt|text|caption|description|query/.test(pname(p)) && !/negative|lyric|filepath|path/.test(pname(p));

/** Wählt den passenden Endpunkt eines Spaces für eine Aufgabe */
export function pickEndpoint(info: GInfo, task: Task, hasImage: boolean, apiName?: string): string {
  const eps = info.named_endpoints || {};
  if (apiName) {
    const key = apiName.startsWith('/') ? apiName : `/${apiName}`;
    if (!eps[key]) throw new ProviderError(`Endpunkt ${key} existiert in diesem Space nicht (verfügbar: ${Object.keys(eps).join(', ')})`, 400, false);
    return key;
  }
  const want = MEDIA_OUT[outKind(task)];
  const needsImage = ['image-edit', 'image-to-video', 'upscale-image', 'remove-bg'].includes(task);
  const hints: Partial<Record<Task, RegExp>> = {
    'text-to-video': /text_?to_?video|t2v|generate/,
    'image-to-video': /image_?to_?video|i2v|generate_video|generate/,
    'text-to-image': /generate|infer|txt2img|text_?to_?image|run/,
    'image-edit': /infer|edit|generate/,
    'remove-bg': /png|remove|image/,
    music: /__call__|generate|text2music/,
    tts: /generate|tts|speak|synth/,
  };
  let best = '';
  let bestScore = -Infinity;
  for (const [name, ep] of Object.entries(eps)) {
    const rets = ep.returns.map((r) => r.component.toLowerCase());
    if (!rets.some((c) => want.includes(c))) continue;
    let score = 0;
    const imageParams = ep.parameters.filter((p) => /^image$|imageeditor/i.test(p.component));
    if (ep.parameters.some(isPromptLike)) score += 3;
    if (needsImage && imageParams.length) score += 4;
    if (needsImage && !imageParams.length) score -= 4;
    if (!needsImage && imageParams.some((p) => !p.parameter_has_default || p.parameter_default == null) && !hasImage) score -= 6;
    if (hints[task]?.test(name.toLowerCase())) score += 2;
    if (/lambda|update|toggle|handle|sample|retake|repaint|extend|edit_process/.test(name.toLowerCase())) score -= 5;
    if (score > bestScore) {
      bestScore = score;
      best = name;
    }
  }
  if (!best) throw new ProviderError(`Dieser Space bietet keinen passenden Endpunkt für ${task}`, 400, false);
  return best;
}

export interface FileRefs {
  image?: unknown;
  endImage?: unknown;
  video?: unknown;
  audio?: unknown;
}

/** Belegt die Space-Parameter anhand ihrer Namen mit den Werten der Anfrage */
export function mapParams(params: GParam[], task: Task, req: Pick<ResolvedRequest, 'prompt' | 'negativePrompt' | 'seed' | 'aspectRatio' | 'duration' | 'voice'>, files: FileRefs): unknown[] {
  const def = (p: GParam) => (p.parameter_has_default ? p.parameter_default : null);
  const widthP = params.find((p) => /width/.test(pname(p)));
  const heightP = params.find((p) => /height/.test(pname(p)));
  let dims: { w: number; h: number } | undefined;
  if (req.aspectRatio && typeof widthP?.parameter_default === 'number' && typeof heightP?.parameter_default === 'number') {
    const area = widthP.parameter_default * heightP.parameter_default;
    const [aw, ah] = parseAspect(req.aspectRatio);
    const w = Math.sqrt((area * aw) / ah);
    dims = { w: Math.round(w / 32) * 32, h: Math.round(area / w / 32) * 32 };
  }
  let promptUsed = false;
  let imageUsed = false;
  return params.map((p) => {
    const n = pname(p);
    const c = p.component.toLowerCase();
    if (c === 'image' || c === 'imageeditor') {
      if (/end|last|tail/.test(n)) return files.endImage ?? def(p);
      if (!imageUsed && files.image) {
        imageUsed = true;
        return files.image;
      }
      return def(p);
    }
    if (c === 'video') return files.video ?? def(p);
    if (c === 'audio') return task === 'lipsync' ? (files.audio ?? def(p)) : def(p);
    if (c === 'file') return files.image ?? files.video ?? files.audio ?? def(p);
    if (c === 'gallery') return def(p) ?? [];
    if (/negative/.test(n)) return req.negativePrompt || def(p);
    if (/lyric/.test(n)) return task === 'music' ? '[instrumental]' : def(p);
    if (!promptUsed && (isPromptLike(p) || (task === 'tts' && /textbox|textarea/.test(c)))) {
      promptUsed = true;
      return req.prompt;
    }
    if (/random/.test(n) && c === 'checkbox') return req.seed == null ? (def(p) ?? true) : false;
    if (/seed/.test(n)) return req.seed ?? def(p);
    if (dims && p === widthP) return dims.w;
    if (dims && p === heightP) return dims.h;
    if (/^mode\b/.test(n.trim()) && typeof p.parameter_default === 'string' && /to-video/.test(p.parameter_default)) {
      return task === 'text-to-video' ? 'text-to-video' : 'image-to-video';
    }
    if (/duration|seconds/.test(n) && task === 'music' && req.duration) return req.duration;
    if (/voice/.test(n) && req.voice) return req.voice;
    return def(p);
  });
}

/** Wertet einen Gradio-SSE-Stream aus */
export function parseGradioStream(text: string): unknown[] {
  const blocks = text.split(/\r?\n\r?\n/);
  for (const b of blocks) {
    const ev = b.match(/^event:\s*(\S+)/m)?.[1];
    const data = b
      .split(/\r?\n/)
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trim())
      .join('\n');
    if (ev === 'complete') return JSON.parse(data) as unknown[];
    if (ev === 'error') {
      let msg = '';
      try {
        const j = JSON.parse(data);
        msg = typeof j === 'string' ? j : j?.message || j?.error || '';
      } catch {
        msg = data;
      }
      const quota = /quota|zerogpu|gpu/i.test(msg);
      throw new ProviderError(
        msg && msg !== 'null'
          ? `Space-Fehler: ${msg}${quota ? ' – mit kostenlosem HF-Token gibt es mehr GPU-Zeit' : ''}`
          : 'Space-Fehler (oft: GPU-Tageskontingent erschöpft oder Space ausgelastet). Mit kostenlosem HF-Token steigt das Kontingent.',
        429,
        true,
      );
    }
  }
  throw new ProviderError('Unerwartete Antwort des Spaces (kein Ergebnis)');
}

/** Extrahiert Mediendateien aus den Rückgabewerten anhand der Komponententypen */
export function extractSpaceOutputs(data: unknown[], returns: { component: string }[], task: Task): string[] {
  const want = MEDIA_OUT[outKind(task)];
  const urls: string[] = [];
  returns.forEach((r, i) => {
    const comp = r.component.toLowerCase();
    if (!want.includes(comp)) return;
    const found = collectUrls(data[i]).filter((u) => /^https?:/.test(u));
    if (!found.length) return;
    if (comp === 'imageslider') urls.push(found[found.length - 1]);
    else if (comp === 'gallery') urls.push(...found);
    else urls.push(found[0]);
  });
  return urls;
}

/**
 * Spaces laufen oft auf mehreren Instanzen hinter einem Load-Balancer. Dateien und Ereignisse existieren
 * nur auf der Instanz, die sie erzeugt hat – deshalb bei 403/404 einfach erneut anfragen.
 */
async function replicaFetch(url: string, opts: Parameters<typeof http>[1], tries = 15): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await http(url, opts);
    } catch (e) {
      lastErr = e;
      const st = (e as ProviderError).status;
      if (st !== 403 && st !== 404) throw e;
      await sleep(250 + i * 100, opts?.signal);
    }
  }
  throw lastErr;
}

// ---------- Info-Cache ----------
const infoCache = new Map<string, { at: number; info: GInfo; prefix: string }>();

async function loadInfo(host: string, headers: Record<string, string>, signal?: AbortSignal) {
  const c = infoCache.get(host);
  if (c && Date.now() - c.at < 10 * 60_000) return c;
  for (const prefix of ['/gradio_api', '']) {
    try {
      const info = await httpJson<GInfo>(`${host}${prefix}/info`, { headers, signal, timeoutMs: 60_000 });
      if (info?.named_endpoints) {
        const entry = { at: Date.now(), info, prefix };
        infoCache.set(host, entry);
        return entry;
      }
    } catch (e) {
      if (prefix === '') throw new ProviderError(`Space nicht erreichbar oder schläft gerade (${(e as Error).message}). Bitte in einer Minute erneut versuchen.`, 503, true);
    }
  }
  throw new ProviderError('Space liefert keine API-Beschreibung', 400, false);
}

function hfToken(conn: Connection, apiKey: string) {
  if (apiKey) return apiKey;
  const hf = db.connections.find((c) => c.type === 'huggingface' && c.enabled && decrypt(c.apiKey));
  return hf ? decrypt(hf.apiKey) : '';
}

export const hfSpaceAdapter: ProviderAdapter = {
  info: {
    type: 'hf-space',
    label: 'Hugging Face Spaces (gratis GPU)',
    description:
      'Nutzt kostenlose Community-Spaces mit ZeroGPU (FLUX, Z-Image, Wan 2.2, LTX-Video, Qwen-Edit, Freistellen, Musik …). Die Schnittstelle wird automatisch erkannt. Ohne Konto kleines Kontingent, mit kostenlosem HF-Token mehr.',
    website: 'https://huggingface.co/spaces',
    keyUrl: 'https://huggingface.co/settings/tokens',
    tasks: ['text-to-image', 'image-edit', 'text-to-video', 'image-to-video', 'remove-bg', 'upscale-image', 'lipsync', 'tts', 'music', 'sfx'],
    needsKey: false,
    baseUrl: { required: true, default: 'black-forest-labs/FLUX.1-schnell' },
    multi: true,
    fields: [
      { key: 'task', label: 'Aufgabe', type: 'text', placeholder: 'text-to-image | image-edit | image-to-video | text-to-video | remove-bg | music …' },
      { key: 'apiName', label: 'Endpunkt (optional)', type: 'text', placeholder: 'leer = automatisch, z. B. /infer', help: 'Wird automatisch gewählt, wenn leer.' },
      { key: 'quality', label: 'Qualitäts-Score (0-100)', type: 'text', placeholder: '75' },
    ],
  },
  async run(ctx) {
    const { conn, model, req, signal } = ctx;
    const host = spaceHost(conn.baseUrl || '');
    const token = hfToken(conn, ctx.apiKey);
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
    ctx.progress('Lese Space-Schnittstelle …');
    const { info, prefix } = await loadInfo(host, headers, signal);
    const apiName = pickEndpoint(info, model.task, !!req.image, (conn.options?.apiName as string) || undefined);
    const ep = info.named_endpoints[apiName];

    async function upload(m?: MediaInput) {
      if (!m) return undefined;
      const fd = new FormData();
      fd.append('files', m.blob(), m.filename);
      const paths = await httpJson<string[]>(`${host}${prefix}/upload`, { body: fd, headers, signal, timeoutMs: 5 * 60_000 });
      if (!paths?.[0]) throw new ProviderError('Upload zum Space fehlgeschlagen');
      return { path: paths[0], orig_name: m.filename, mime_type: m.mime, size: m.size, meta: { _type: 'gradio.FileData' } };
    }
    const callBase = `${host}${prefix}/call/${apiName.replace(/^\//, '')}`;
    const hasFiles = !!(req.image || req.refImages[0] || req.endImage || req.video || req.audio);
    let out: unknown[] | undefined;
    // Bis zu 3 Durchläufe: hochgeladene Dateien können auf einer anderen Instanz liegen als der Aufruf
    for (let attempt = 0; attempt < (hasFiles ? 3 : 1); attempt++) {
      const files: FileRefs = {
        image: await upload(req.image || req.refImages[0]),
        endImage: await upload(req.endImage),
        video: await upload(req.video),
        audio: await upload(req.audio),
      };
      const data = mapParams(ep.parameters, model.task, req, files);
      if (req.extraParams) {
        // Feinsteuerung: { "steps": 8 } überschreibt Parameter nach Namen
        ep.parameters.forEach((p, i) => {
          if (p.parameter_name && p.parameter_name in req.extraParams!) data[i] = req.extraParams![p.parameter_name];
        });
      }
      ctx.progress('In der Space-Warteschlange …');
      const sub = await httpJson<{ event_id: string }>(callBase, { json: { data }, headers, signal });
      if (!sub?.event_id) throw new ProviderError('Space hat den Auftrag nicht angenommen');
      ctx.progress('Space rendert auf Gratis-GPU …');
      const res = await replicaFetch(`${callBase}/${sub.event_id}`, { headers, signal, timeoutMs: 20 * 60_000 });
      try {
        out = parseGradioStream(await res.text());
        break;
      } catch (e) {
        const msg = (e as Error).message;
        if (hasFiles && attempt < 2 && /file|not found|not allowed|no such/i.test(msg)) {
          ctx.progress('Space-Instanz gewechselt – sende erneut …');
          continue;
        }
        throw e;
      }
    }
    const urls = extractSpaceOutputs(out || [], ep.returns, model.task);
    if (!urls.length) throw new ProviderError('Der Space lieferte keine Datei');
    // Ergebnisse direkt (mit Instanz-Wiederholung) herunterladen
    const results: ProviderOutput[] = [];
    for (const u of urls) {
      const r = await replicaFetch(u, { headers, signal, timeoutMs: 10 * 60_000 });
      results.push({ buffer: Buffer.from(await r.arrayBuffer()), mime: r.headers.get('content-type') || undefined });
    }
    return results;
  },
  async listModels(conn) {
    const task = conn.options?.task as Task | undefined;
    if (!task || !conn.baseUrl) return [];
    return [
      {
        id: `hf-space:${conn.id}`,
        provider: 'hf-space',
        connectionId: conn.id,
        task,
        label: conn.name,
        model: conn.baseUrl,
        quality: Number(conn.options?.quality ?? 75),
        speed: 2,
        cost: 0,
        free: 'quota',
        freeNote: 'Hugging Face ZeroGPU – tägliches Gratis-GPU-Kontingent',
        features: { negative: true, inputImage: true, inputVideo: true, maxRefs: 1, audio: false },
      } satisfies ModelDef,
    ];
  },
  async test(conn, apiKey) {
    const host = spaceHost(conn.baseUrl || '');
    const token = hfToken(conn, apiKey);
    infoCache.delete(host);
    const { info } = await loadInfo(host, token ? { Authorization: `Bearer ${token}` } : {});
    const task = conn.options?.task as Task | undefined;
    const names = Object.keys(info.named_endpoints);
    let chosen = '';
    if (task) chosen = pickEndpoint(info, task, ['image-edit', 'image-to-video', 'remove-bg', 'upscale-image'].includes(task), (conn.options?.apiName as string) || undefined);
    return `Space erreichbar – ${names.length} Endpunkte${chosen ? `, genutzt: ${chosen}` : ''}${token ? ' (mit HF-Token)' : ' (anonym)'}`;
  },
};
