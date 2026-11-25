import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { allModels, availableModels, connectionFor, isAvailable, isDisabled, isFree, refreshDynamic } from './catalog.js';
import { applyPreset, COMFY_TEMPLATES, FREE_PRESETS, HF_SPACES, presetStatus } from './free.js';
import { APP_PASSWORD, HOST, MEDIA_DIR, PORT, PUBLIC_URL_ENV, WEB_DIST } from './config.js';
import { addClient } from './events.js';
import { deleteAssetFile, getAsset, guessMimeFromName, mediaInput, writeAsset } from './files.js';
import { cancelJob, createArena, createJob, createPipeline, getJob } from './jobs.js';
import { describeImage, enhancePrompt, promptVariations } from './llm.js';
import { CAMERA, EFFECTS, STYLES } from './presets.js';
import { hasFfmpeg } from './providers/demo.js';
import { listElevenVoices } from './providers/elevenlabs.js';
import { ADAPTERS } from './providers/index.js';
import { authToken, db, decrypt, encrypt, maskKey, save } from './store.js';
import { ALL_TASKS, type Connection, type GenRequest, type ModelDef, type ProviderType, type Settings, type Task } from './types.js';
import { errMsg, ProviderError, uid } from './util.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '50mb' }));

// ---------------- optionaler Passwortschutz ----------------
const COOKIE = 'musii_auth';
function readCookie(req: Request, name: string) {
  const raw = req.headers.cookie || '';
  const m = raw.split(';').map((s) => s.trim()).find((s) => s.startsWith(name + '='));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : '';
}
app.post('/api/login', (req, res) => {
  if (!APP_PASSWORD) return res.json({ ok: true });
  if (req.body?.password !== APP_PASSWORD) return res.status(401).json({ error: 'Falsches Passwort' });
  res.setHeader('Set-Cookie', `${COOKIE}=${authToken(APP_PASSWORD)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`);
  res.json({ ok: true });
});
app.use((req: Request, res: Response, next: NextFunction) => {
  if (!APP_PASSWORD) return next();
  if (!req.path.startsWith('/api') && !req.path.startsWith('/media')) return next();
  if (req.path === '/api/auth') return next();
  if (readCookie(req, COOKIE) === authToken(APP_PASSWORD)) return next();
  res.status(401).json({ error: 'Anmeldung erforderlich', auth: true });
});
app.get('/api/auth', (req, res) => {
  res.json({ required: !!APP_PASSWORD, ok: !APP_PASSWORD || readCookie(req, COOKIE) === authToken(APP_PASSWORD) });
});

// ---------------- Hilfen ----------------
const wrap =
  (fn: (req: Request, res: Response) => Promise<unknown> | unknown) =>
  async (req: Request, res: Response) => {
    try {
      const out = await fn(req, res);
      if (!res.headersSent) res.json(out ?? { ok: true });
    } catch (e) {
      const status = e instanceof ProviderError && e.status && e.status >= 400 && e.status < 500 ? e.status : 500;
      if (!res.headersSent) res.status(status).json({ error: errMsg(e) });
    }
  };

function publicConnection(c: Connection) {
  return { ...c, apiKey: maskKey(c.apiKey), hasKey: !!decrypt(c.apiKey) };
}

function publicModel(mod: ModelDef) {
  const conn = connectionFor(mod);
  return { ...mod, available: isAvailable(mod), disabled: isDisabled(mod.id), connectionName: conn?.name };
}

function param(req: Request, name: string): string {
  const v = req.params[name];
  return Array.isArray(v) ? v[0] : String(v);
}

// ---------------- Status & Katalog ----------------
app.get(
  '/api/state',
  wrap(async () => ({
    settings: db.settings,
    connections: db.connections.map(publicConnection),
    providers: Object.values(ADAPTERS).map((a) => a.info),
    models: allModels().map(publicModel),
    characters: db.characters,
    presets: { camera: CAMERA, effects: EFFECTS, styles: STYLES },
    tasks: ALL_TASKS,
    env: { ffmpeg: hasFfmpeg(), publicUrl: db.settings.publicUrl || PUBLIC_URL_ENV, passwordProtected: !!APP_PASSWORD },
  })),
);

app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': verbunden\n\n');
  addClient(res);
});

// ---------------- Generierung & Jobs ----------------
function validateRequest(body: any): GenRequest {
  const task = body?.task as Task;
  if (!ALL_TASKS.includes(task) || task === 'llm') throw new ProviderError('Ungültige Aufgabe', 400, false);
  const req: GenRequest = { ...body, task };
  if (['text-to-image', 'text-to-video', 'tts', 'sfx', 'music'].includes(task) && !req.prompt?.trim() && !req.characterId) {
    throw new ProviderError('Bitte einen Prompt eingeben', 400, false);
  }
  if (['image-edit', 'upscale-image', 'remove-bg'].includes(task) && !req.image && !(req.refImages || []).length) {
    throw new ProviderError('Bitte ein Bild auswählen', 400, false);
  }
  if (task === 'upscale-video' && !req.video) throw new ProviderError('Bitte ein Video auswählen', 400, false);
  if (task === 'lipsync' && (!req.audio || (!req.image && !req.video))) throw new ProviderError('Lipsync benötigt Bild oder Video und eine Audiodatei', 400, false);
  for (const id of [req.image, req.endImage, req.video, req.audio, req.mask, req.maskAlpha, ...(req.refImages || [])]) {
    if (id && !getAsset(id)) throw new ProviderError(`Datei ${id} nicht gefunden`, 400, false);
  }
  return req;
}

app.post(
  '/api/generate',
  wrap(async (req) => {
    const r = validateRequest(req.body);
    return createJob(r);
  }),
);

app.get(
  '/api/jobs',
  wrap(async (req) => {
    const limit = Math.min(Number(req.query.limit || 200), 1000);
    return db.jobs.slice(-limit).reverse();
  }),
);
app.get(
  '/api/jobs/:id',
  wrap(async (req) => {
    const j = getJob(param(req, 'id'));
    if (!j) throw new ProviderError('Job nicht gefunden', 404, false);
    return j;
  }),
);
app.post(
  '/api/jobs/:id/cancel',
  wrap(async (req) => {
    cancelJob(param(req, 'id'));
    return { ok: true };
  }),
);
app.post(
  '/api/jobs/:id/retry',
  wrap(async (req) => {
    const j = getJob(param(req, 'id'));
    if (!j) throw new ProviderError('Job nicht gefunden', 404, false);
    return createJob({ ...j.request, ...(req.body || {}) });
  }),
);
app.delete(
  '/api/jobs/:id',
  wrap(async (req) => {
    const id = param(req, 'id');
    cancelJob(id);
    db.jobs = db.jobs.filter((j) => j.id !== id);
    save();
    return { ok: true };
  }),
);
app.post(
  '/api/jobs/clear',
  wrap(async () => {
    db.jobs = db.jobs.filter((j) => j.status === 'running' || j.status === 'queued');
    save();
    return { ok: true };
  }),
);

// ---------------- Dateien / Bibliothek ----------------
app.post(
  '/api/upload',
  express.raw({ type: () => true, limit: '1gb' }),
  wrap(async (req) => {
    const buf = req.body as Buffer;
    if (!Buffer.isBuffer(buf) || !buf.length) throw new ProviderError('Leere Datei', 400, false);
    const name = String(req.query.name || 'upload');
    const ct = String(req.headers['content-type'] || '');
    const mime = ct && ct !== 'application/octet-stream' ? ct : guessMimeFromName(name);
    if (!/^(image|video|audio)\//.test(mime) && mime !== 'application/octet-stream') throw new ProviderError('Nur Bilder, Videos und Audiodateien', 400, false);
    const source = req.query.source === 'local' ? 'local' : 'upload';
    const meta = req.query.meta ? JSON.parse(String(req.query.meta)) : undefined;
    return writeAsset(buf, mime, { source, name: name.slice(0, 80), prompt: req.query.prompt ? String(req.query.prompt) : undefined, meta });
  }),
);

app.get(
  '/api/assets',
  wrap(async (req) => {
    let list = [...db.assets].reverse();
    const kind = req.query.kind ? String(req.query.kind) : '';
    const q = req.query.q ? String(req.query.q).toLowerCase() : '';
    if (kind) list = list.filter((a) => a.kind === kind);
    if (req.query.fav === '1') list = list.filter((a) => a.favorite);
    if (req.query.source) list = list.filter((a) => a.source === req.query.source);
    if (q) list = list.filter((a) => `${a.name || ''} ${a.prompt || ''} ${a.modelId || ''}`.toLowerCase().includes(q));
    return list.slice(0, Number(req.query.limit || 2000));
  }),
);
app.patch(
  '/api/assets/:id',
  wrap(async (req) => {
    const a = getAsset(param(req, 'id'));
    if (!a) throw new ProviderError('Datei nicht gefunden', 404, false);
    if (req.body.favorite !== undefined) a.favorite = !!req.body.favorite;
    if (typeof req.body.name === 'string') a.name = req.body.name.slice(0, 120);
    save();
    return a;
  }),
);
app.delete(
  '/api/assets/:id',
  wrap(async (req) => {
    const a = getAsset(param(req, 'id'));
    if (!a) return { ok: true };
    deleteAssetFile(a);
    db.assets = db.assets.filter((x) => x.id !== a.id);
    for (const c of db.characters) c.refAssetIds = c.refAssetIds.filter((id) => id !== a.id);
    save();
    return { ok: true };
  }),
);

// ---------------- Charaktere ----------------
app.get('/api/characters', wrap(async () => db.characters));
app.post(
  '/api/characters',
  wrap(async (req) => {
    const { name, description = '', refAssetIds = [] } = req.body || {};
    if (!name) throw new ProviderError('Name fehlt', 400, false);
    const c = { id: uid('c_'), name: String(name).slice(0, 60), description: String(description).slice(0, 1000), refAssetIds, createdAt: Date.now() };
    db.characters.push(c);
    save();
    return c;
  }),
);
app.patch(
  '/api/characters/:id',
  wrap(async (req) => {
    const c = db.characters.find((x) => x.id === param(req, 'id'));
    if (!c) throw new ProviderError('Charakter nicht gefunden', 404, false);
    Object.assign(c, {
      ...(req.body.name ? { name: String(req.body.name).slice(0, 60) } : {}),
      ...(req.body.description !== undefined ? { description: String(req.body.description).slice(0, 1000) } : {}),
      ...(Array.isArray(req.body.refAssetIds) ? { refAssetIds: req.body.refAssetIds } : {}),
    });
    save();
    return c;
  }),
);
app.delete(
  '/api/characters/:id',
  wrap(async (req) => {
    db.characters = db.characters.filter((x) => x.id !== param(req, 'id'));
    save();
    return { ok: true };
  }),
);

// ---------------- Verbindungen ----------------
app.post(
  '/api/connections',
  wrap(async (req) => {
    const { type, name, apiKey, baseUrl, options, enabled = true } = req.body || {};
    const ad = ADAPTERS[type as ProviderType];
    if (!ad) throw new ProviderError('Unbekannter Anbieter', 400, false);
    if (!ad.info.multi) {
      const existing = db.connections.find((c) => c.type === type);
      if (existing) {
        if (apiKey !== undefined && apiKey !== maskKey(existing.apiKey)) existing.apiKey = encrypt(String(apiKey).trim());
        if (baseUrl !== undefined) existing.baseUrl = String(baseUrl).trim() || undefined;
        if (options) existing.options = { ...(existing.options || {}), ...options };
        existing.enabled = enabled;
        if (name) existing.name = name;
        save();
        await refreshDynamic();
        return publicConnection(existing);
      }
    }
    const c: Connection = {
      id: uid('cn_'),
      type,
      name: String(name || ad.info.label).slice(0, 80),
      enabled: !!enabled,
      apiKey: apiKey ? encrypt(String(apiKey).trim()) : undefined,
      baseUrl: baseUrl ? String(baseUrl).trim() : undefined,
      options: options || {},
      createdAt: Date.now(),
    };
    db.connections.push(c);
    save();
    await refreshDynamic();
    return publicConnection(c);
  }),
);
app.patch(
  '/api/connections/:id',
  wrap(async (req) => {
    const c = db.connections.find((x) => x.id === param(req, 'id'));
    if (!c) throw new ProviderError('Verbindung nicht gefunden', 404, false);
    const { name, apiKey, baseUrl, options, enabled } = req.body || {};
    if (name !== undefined) c.name = String(name).slice(0, 80);
    if (apiKey !== undefined && apiKey !== maskKey(c.apiKey)) c.apiKey = apiKey ? encrypt(String(apiKey).trim()) : undefined;
    if (baseUrl !== undefined) c.baseUrl = String(baseUrl).trim() || undefined;
    if (options !== undefined) c.options = options;
    if (enabled !== undefined) c.enabled = !!enabled;
    save();
    await refreshDynamic();
    return publicConnection(c);
  }),
);
app.delete(
  '/api/connections/:id',
  wrap(async (req) => {
    db.connections = db.connections.filter((x) => x.id !== param(req, 'id'));
    db.customModels = db.customModels.filter((x) => x.connectionId !== param(req, 'id'));
    save();
    await refreshDynamic();
    return { ok: true };
  }),
);
app.post(
  '/api/connections/:id/test',
  wrap(async (req) => {
    const c = db.connections.find((x) => x.id === param(req, 'id'));
    if (!c) throw new ProviderError('Verbindung nicht gefunden', 404, false);
    const ad = ADAPTERS[c.type];
    if (ad.info.needsKey && !decrypt(c.apiKey)) throw new ProviderError('Kein API-Schlüssel hinterlegt', 400, false);
    const message = ad.test ? await ad.test(c, decrypt(c.apiKey)) : 'Gespeichert';
    await refreshDynamic();
    return { ok: true, message };
  }),
);

// ---------------- Modelle ----------------
app.get(
  '/api/models',
  wrap(async (req) => {
    if (req.query.refresh) await refreshDynamic();
    return allModels().map(publicModel);
  }),
);
app.post(
  '/api/models',
  wrap(async (req) => {
    const b = req.body || {};
    if (!ADAPTERS[b.provider as ProviderType]) throw new ProviderError('Unbekannter Anbieter', 400, false);
    if (!ALL_TASKS.includes(b.task)) throw new ProviderError('Unbekannte Aufgabe', 400, false);
    if (!b.model) throw new ProviderError('Modell-ID fehlt', 400, false);
    const mod: ModelDef = {
      id: `custom:${uid()}`,
      provider: b.provider,
      connectionId: b.connectionId || undefined,
      task: b.task,
      label: String(b.label || b.model).slice(0, 80),
      model: String(b.model).trim(),
      quality: Number(b.quality ?? 85),
      speed: Number(b.speed ?? 3),
      cost: Number(b.cost ?? 0),
      features: b.features || {},
      params: b.params || undefined,
      inputMap: b.inputMap || undefined,
      formats: b.formats || undefined,
      custom: true,
      notes: b.notes,
    };
    db.customModels.push(mod);
    save();
    return publicModel(mod);
  }),
);
app.delete(
  '/api/models/:id',
  wrap(async (req) => {
    db.customModels = db.customModels.filter((x) => x.id !== param(req, 'id'));
    save();
    return { ok: true };
  }),
);
app.patch(
  '/api/models/:id',
  wrap(async (req) => {
    const id = param(req, 'id');
    const o = (db.modelOverrides[id] = db.modelOverrides[id] || {});
    if (req.body.disabled !== undefined) o.disabled = !!req.body.disabled;
    if (req.body.quality !== undefined) o.quality = req.body.quality === null ? undefined : Number(req.body.quality);
    save();
    return { ok: true };
  }),
);
app.get(
  '/api/models/available',
  wrap(async (req) => availableModels(req.query.task as Task | undefined).map(publicModel)),
);

// ---------------- Einstellungen ----------------
app.patch(
  '/api/settings',
  wrap(async (req) => {
    const allowed: (keyof Settings)[] = ['routing', 'llmModelId', 'judgeModelId', 'autoEnhance', 'autoFallback', 'concurrency', 'language', 'publicUrl'];
    for (const k of allowed) if (req.body[k] !== undefined) (db.settings as any)[k] = req.body[k];
    db.settings.concurrency = Math.max(1, Math.min(16, Number(db.settings.concurrency) || 4));
    save();
    return db.settings;
  }),
);

// ---------------- KI-Regie (LLM) ----------------
app.post(
  '/api/llm/enhance',
  wrap(async (req) => {
    const { prompt, task = 'text-to-image', image, modelLabel } = req.body || {};
    if (!prompt?.trim()) throw new ProviderError('Prompt fehlt', 400, false);
    return enhancePrompt(prompt, task, { image: mediaInput(image), modelLabel });
  }),
);
app.post(
  '/api/llm/variations',
  wrap(async (req) => {
    const { prompt, task = 'text-to-image', n = 4 } = req.body || {};
    if (!prompt?.trim()) throw new ProviderError('Prompt fehlt', 400, false);
    return promptVariations(prompt, task, Math.min(8, Number(n) || 4));
  }),
);
app.post(
  '/api/llm/describe',
  wrap(async (req) => {
    const img = mediaInput(req.body?.image);
    if (!img) throw new ProviderError('Bild fehlt', 400, false);
    return describeImage(img);
  }),
);

// ---------------- Arena & Pipelines ----------------
app.post(
  '/api/arena',
  wrap(async (req) => {
    const { modelIds, judge = true, ...rest } = req.body || {};
    if (!Array.isArray(modelIds) || modelIds.length < 2) throw new ProviderError('Mindestens zwei Modelle wählen', 400, false);
    const base = validateRequest(rest);
    return createArena(base, modelIds.slice(0, 8), !!judge);
  }),
);
app.get('/api/arenas', wrap(async () => [...db.arenas].reverse().slice(0, 100)));
app.post(
  '/api/pipelines',
  wrap(async (req) => {
    const { name = 'Workflow', steps, base = {} } = req.body || {};
    if (!Array.isArray(steps) || !steps.length) throw new ProviderError('Keine Schritte', 400, false);
    for (const s of steps) if (!ALL_TASKS.includes(s.task)) throw new ProviderError(`Ungültige Aufgabe ${s.task}`, 400, false);
    return createPipeline(String(name), steps, base);
  }),
);
app.get('/api/pipelines', wrap(async () => [...db.pipelines].reverse().slice(0, 100)));

// ---------------- Gratis-Assistent ----------------
app.get(
  '/api/free',
  wrap(async () => {
    const counts: Record<string, number> = {};
    for (const m of availableModels()) if (isFree(m) && m.provider !== 'demo') counts[m.task] = (counts[m.task] || 0) + 1;
    return {
      presets: FREE_PRESETS,
      status: presetStatus(),
      spaces: HF_SPACES,
      comfyTemplates: COMFY_TEMPLATES.map(({ workflow: _w, ...t }) => t),
      freeCounts: counts,
    };
  }),
);
app.post(
  '/api/free/apply',
  wrap(async (req) => applyPreset(req.body || {})),
);
app.get(
  '/api/free/comfy/:id',
  wrap(async (req) => {
    const t = COMFY_TEMPLATES.find((x) => x.id === param(req, 'id'));
    if (!t) throw new ProviderError('Vorlage nicht gefunden', 404, false);
    return t;
  }),
);

// ---------------- Stimmen ----------------
const OPENAI_VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse'];
const GEMINI_VOICES = ['Kore', 'Puck', 'Charon', 'Fenrir', 'Aoede', 'Leda', 'Orus', 'Zephyr', 'Sulafat', 'Achird'];
app.get(
  '/api/voices',
  wrap(async (req) => {
    const provider = String(req.query.provider || '');
    if (provider === 'elevenlabs') {
      const c = db.connections.find((x) => x.type === 'elevenlabs' && x.enabled && decrypt(x.apiKey));
      if (!c) return [];
      return listElevenVoices(c.baseUrl, decrypt(c.apiKey));
    }
    if (provider === 'openai' || provider === 'openai-compatible' || provider === 'pollinations') return OPENAI_VOICES.map((v) => ({ id: v, name: v }));
    if (provider === 'google') return GEMINI_VOICES.map((v) => ({ id: v, name: v }));
    return [];
  }),
);

// ---------------- Statistik / Kosten ----------------
app.get(
  '/api/stats',
  wrap(async () => {
    const byProvider: Record<string, number> = {};
    const byDay: Record<string, number> = {};
    let total = 0;
    for (const l of db.ledger) {
      total += l.cost;
      byProvider[l.provider] = (byProvider[l.provider] || 0) + l.cost;
      const day = new Date(l.at).toISOString().slice(0, 10);
      byDay[day] = (byDay[day] || 0) + l.cost;
    }
    const counts = { image: 0, video: 0, audio: 0 };
    for (const a of db.assets) counts[a.kind]++;
    const jobs = { total: db.jobs.length, succeeded: db.jobs.filter((j) => j.status === 'succeeded').length, failed: db.jobs.filter((j) => j.status === 'failed').length };
    return { total, byProvider, byDay, counts, jobs, ledger: db.ledger.slice(-200).reverse() };
  }),
);

// ---------------- Medien & Web-Oberfläche ----------------
app.use('/media', express.static(MEDIA_DIR, { maxAge: '7d', immutable: true }));

if (fs.existsSync(WEB_DIST)) {
  app.use(express.static(WEB_DIST, { index: false, maxAge: '1h' }));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api') || req.path.startsWith('/media')) return next();
    res.sendFile(path.join(WEB_DIST, 'index.html'));
  });
} else {
  app.get('/', (_req, res) => {
    res.type('html').send('<p>MUSII Studio API läuft. Starte die Oberfläche mit <code>npm run dev</code> oder baue sie mit <code>npm run build</code>.</p>');
  });
}

app.use('/api', (_req, res) => res.status(404).json({ error: 'Nicht gefunden' }));

await refreshDynamic();
app.listen(PORT, HOST, () => {
  console.log(`\n  MUSII Studio läuft auf http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}\n`);
});
