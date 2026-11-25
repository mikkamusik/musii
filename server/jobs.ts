import { connectionFor, getModel, rankModels } from './catalog.js';
import { emit } from './events.js';
import { getAsset, mediaInput, outputToBuffer, writeAsset } from './files.js';
import { characterRefs, composePrompt, enhancePrompt, judgeImages } from './llm.js';
import { ADAPTERS } from './providers/index.js';
import type { ResolvedRequest } from './providers/types.js';
import { db, decrypt, save } from './store.js';
import type { Arena, Asset, GenRequest, Job, ModelDef, Pipeline, PipelineStep, Task } from './types.js';
import { errMsg, ProviderError, uid } from './util.js';

// ---------------- Warteschlange ----------------
const controllers = new Map<string, AbortController>();
const waiters = new Map<string, ((j: Job) => void)[]>();
const queue: string[] = [];
let running = 0;

function publish(job: Job) {
  save();
  emit('job', job);
}

export function getJob(id: string) {
  return db.jobs.find((j) => j.id === id);
}

export function createJob(request: GenRequest, extra: Partial<Job> = {}): Job {
  const job: Job = {
    id: uid('j_'),
    task: request.task,
    status: 'queued',
    request,
    attempts: [],
    outputs: [],
    createdAt: Date.now(),
    groupId: request.groupId,
    ...extra,
  };
  db.jobs.push(job);
  publish(job);
  queue.push(job.id);
  pump();
  return job;
}

export function waitForJob(id: string): Promise<Job> {
  const j = getJob(id);
  if (j && ['succeeded', 'failed', 'canceled'].includes(j.status)) return Promise.resolve(j);
  return new Promise((resolve) => {
    const list = waiters.get(id) || [];
    list.push(resolve);
    waiters.set(id, list);
  });
}

function finish(job: Job) {
  job.finishedAt = Date.now();
  job.progress = undefined;
  publish(job);
  for (const w of waiters.get(job.id) || []) w(job);
  waiters.delete(job.id);
}

export function cancelJob(id: string) {
  const job = getJob(id);
  if (!job) return;
  const qi = queue.indexOf(id);
  if (qi >= 0) queue.splice(qi, 1);
  controllers.get(id)?.abort();
  if (job.status === 'queued' || job.status === 'running') {
    job.status = 'canceled';
    job.error = 'Abgebrochen';
    finish(job);
  }
}

function pump() {
  const limit = Math.max(1, db.settings.concurrency || 4);
  while (running < limit && queue.length) {
    const id = queue.shift()!;
    const job = getJob(id);
    if (!job || job.status !== 'queued') continue;
    running++;
    runJob(job)
      .catch((e) => {
        job.status = 'failed';
        job.error = errMsg(e);
        finish(job);
      })
      .finally(() => {
        running--;
        controllers.delete(id);
        pump();
      });
  }
}

// ---------------- Ausführung ----------------
function resolveRequest(req: GenRequest, prompt: string, negative?: string): ResolvedRequest {
  const refs = characterRefs(req);
  return {
    ...req,
    prompt,
    negativePrompt: negative,
    image: mediaInput(req.image),
    endImage: mediaInput(req.endImage),
    refImages: refs.map((id) => mediaInput(id)!).filter(Boolean),
    video: mediaInput(req.video),
    audio: mediaInput(req.audio),
    mask: mediaInput(req.mask),
    maskAlpha: mediaInput(req.maskAlpha),
  };
}

/** Aufgabe anpassen: Charakter/Referenzen bei Text-zu-Bild -> Bearbeitungsmodelle mit Referenzen zulassen */
function candidateModels(job: Job): ModelDef[] {
  const req = job.request;
  const wantsFallback = req.fallback ?? db.settings.autoFallback;
  const refs = characterRefs(req);
  const reqWithRefs = { ...req, refImages: refs };
  if (req.modelId && req.modelId !== 'auto') {
    const m = getModel(req.modelId);
    if (!m) throw new ProviderError(`Modell ${req.modelId} nicht gefunden`, 404, false);
    if (!connectionFor(m)) throw new ProviderError(`Für ${m.label} ist keine aktive Verbindung (API-Schlüssel) eingerichtet`, 400, false);
    if (!wantsFallback) return [m];
    const rest = rankModels(m.task, reqWithRefs).filter((x) => x.id !== m.id && x.provider !== 'demo');
    return [m, ...rest];
  }
  let list = rankModels(req.task, reqWithRefs);
  if (req.task === 'text-to-image' && refs.length) {
    // Charakter-Konsistenz: beste Referenz-fähige Modelle aus beiden Kategorien
    const edit = rankModels('image-edit', reqWithRefs).filter((x) => x.features?.refs);
    list = [...list, ...edit].sort((a, b) => b.quality - a.quality);
  }
  if (req.task === 'image-to-video' && !req.image) list = rankModels('text-to-video', req);
  if (!list.length) {
    throw new ProviderError(
      `Kein verbundenes Modell kann „${req.task}“${req.endImage ? ' mit Endframe' : ''}${req.mask ? ' mit Maske' : ''}. Verbinde unter „Verbindungen“ einen passenden Anbieter.`,
      400,
      false,
    );
  }
  return wantsFallback ? list.slice(0, 4) : list.slice(0, 1);
}

async function runJob(job: Job) {
  const ctrl = new AbortController();
  controllers.set(job.id, ctrl);
  job.status = 'running';
  job.startedAt = Date.now();
  job.progress = 'Vorbereitung …';
  publish(job);

  const req = job.request;
  const { prompt: composed, negative } = composePrompt(req);
  let prompt = composed;
  const candidates = candidateModels(job);

  // Prompt-Regie durch ein Sprachmodell
  if ((req.enhance ?? db.settings.autoEnhance) && prompt && !['remove-bg', 'upscale-image', 'upscale-video'].includes(req.task)) {
    try {
      job.progress = 'KI-Regie optimiert den Prompt …';
      publish(job);
      const r = await enhancePrompt(prompt, req.task, { modelLabel: candidates[0]?.label, image: mediaInput(req.image) }, ctrl.signal);
      prompt = r.prompt;
    } catch (e) {
      job.progress = `Prompt-Optimierung übersprungen (${errMsg(e).slice(0, 80)})`;
    }
  }
  job.finalPrompt = prompt;

  for (const model of candidates) {
    if (ctrl.signal.aborted) return;
    const conn = connectionFor(model);
    if (!conn) continue;
    const attempt = { modelId: model.id, startedAt: Date.now() } as Job['attempts'][number];
    job.attempts.push(attempt);
    job.modelId = model.id;
    job.progress = `${model.label} startet …`;
    publish(job);
    try {
      let effTask: Task = model.task;
      const resolved = resolveRequest({ ...req, task: effTask }, prompt, negative);
      if (model.task === 'image-edit' && req.task === 'text-to-image' && !resolved.image && resolved.refImages.length) {
        effTask = 'image-edit';
      }
      const adapter = ADAPTERS[model.provider];
      const ctxBase = {
        conn,
        apiKey: decrypt(conn.apiKey),
        model,
        req: resolved,
        signal: ctrl.signal,
        progress: (msg: string) => {
          job.progress = `${model.label}: ${msg}`;
          emit('job', job);
        },
      };
      // Mehrere Varianten: Modelle ohne Batch-Unterstützung parallel aufrufen
      const count = Math.max(1, Math.min(req.count || 1, 4));
      const batched = model.features?.batch || ['tts', 'sfx', 'music', 'remove-bg', 'upscale-image', 'upscale-video', 'lipsync'].includes(effTask);
      const runs = batched ? [adapter.run(ctxBase)] : Array.from({ length: count }, (_, i) => adapter.run({ ...ctxBase, req: { ...resolved, seed: resolved.seed != null ? resolved.seed + i : resolved.seed } }));
      const outputs = (await Promise.all(runs)).flat();
      if (!outputs.length) throw new ProviderError('Keine Ausgabe erhalten');
      job.progress = 'Speichere Ergebnis …';
      emit('job', job);
      const assets: Asset[] = [];
      for (const out of outputs) {
        const { buf, mime } = await outputToBuffer(out, ctrl.signal);
        assets.push(
          writeAsset(buf, mime, {
            source: 'generated',
            prompt,
            modelId: model.id,
            jobId: job.id,
            name: (req.prompt || model.label).slice(0, 60),
            meta: {
              task: req.task,
              aspectRatio: req.aspectRatio,
              camera: req.camera,
              effect: req.effect,
              style: req.style,
              characterId: req.characterId,
              originalPrompt: req.prompt,
              ...(out.meta || {}),
            },
          }),
        );
      }
      attempt.finishedAt = Date.now();
      job.outputs = assets.map((a) => a.id);
      job.status = 'succeeded';
      job.error = undefined;
      job.cost = model.cost * (batched ? Math.max(1, assets.length) : count);
      db.ledger.push({ id: uid('l_'), at: Date.now(), provider: model.provider, modelId: model.id, task: req.task, cost: job.cost, jobId: job.id });
      finish(job);
      return;
    } catch (e) {
      attempt.finishedAt = Date.now();
      attempt.error = errMsg(e);
      if (ctrl.signal.aborted) return;
      job.progress = `${model.label} fehlgeschlagen – versuche nächstes Modell …`;
      publish(job);
      if (e instanceof ProviderError && e.status === 400 && candidates.length === 1) break;
    }
  }
  job.status = 'failed';
  job.error = job.attempts.length
    ? job.attempts.map((a) => `${getModel(a.modelId)?.label || a.modelId}: ${a.error}`).join(' · ')
    : 'Kein passendes Modell verfügbar';
  finish(job);
}

// ---------------- Arena / Modellvergleich ----------------
export function createArena(base: GenRequest, modelIds: string[], judge: boolean): Arena {
  const arena: Arena = {
    id: uid('ar_'),
    task: base.task,
    prompt: base.prompt || '',
    entries: [],
    judge,
    status: 'running',
    createdAt: Date.now(),
  };
  db.arenas.push(arena);
  for (const modelId of modelIds) {
    const job = createJob({ ...base, modelId, fallback: false, count: 1, groupId: arena.id }, { groupId: arena.id });
    arena.entries.push({ modelId, jobId: job.id });
  }
  save();
  emit('arena', arena);
  void (async () => {
    const jobs = await Promise.all(arena.entries.map((e) => waitForJob(e.jobId)));
    const ok = jobs.filter((j) => j.status === 'succeeded' && j.outputs[0]);
    if (!ok.length) {
      arena.status = 'failed';
      arena.error = 'Kein Modell lieferte ein Ergebnis';
      save();
      emit('arena', arena);
      return;
    }
    const imgs = ok.map((j) => getAsset(j.outputs[0])).filter((a): a is Asset => !!a && a.kind === 'image');
    if (judge && imgs.length >= 1) {
      arena.status = 'judging';
      emit('arena', arena);
      try {
        const okWithImg = ok.filter((j) => getAsset(j.outputs[0])?.kind === 'image');
        const res = await judgeImages(arena.prompt, okWithImg.map((j) => mediaInput(j.outputs[0])!));
        arena.judgeModelId = res.modelId;
        arena.judgeSummary = res.summary;
        for (const s of res.scores) {
          const job = okWithImg[s.index];
          const entry = job && arena.entries.find((e) => e.jobId === job.id);
          if (entry) {
            entry.score = Math.round(Number(s.score));
            entry.reason = s.reason;
          }
        }
        const best = [...arena.entries].filter((e) => e.score != null).sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];
        arena.winnerJobId = best?.jobId;
      } catch (e) {
        arena.error = `KI-Jury: ${errMsg(e)}`;
      }
    }
    arena.status = 'done';
    save();
    emit('arena', arena);
  })();
  return arena;
}

// ---------------- Pipelines (Workflows) ----------------
export function createPipeline(name: string, steps: PipelineStep[], base: Partial<GenRequest> = {}): Pipeline {
  const pipe: Pipeline = { id: uid('p_'), name, steps, jobIds: [], current: 0, status: 'running', createdAt: Date.now() };
  db.pipelines.push(pipe);
  save();
  emit('pipeline', pipe);
  void (async () => {
    const outputs: string[][] = [];
    try {
      for (let i = 0; i < steps.length; i++) {
        pipe.current = i;
        emit('pipeline', pipe);
        const step = steps[i];
        const req: GenRequest = {
          ...base,
          ...(step.options || {}),
          task: step.task,
          modelId: step.modelId || 'auto',
          prompt: step.prompt ?? base.prompt,
          groupId: pipe.id,
        };
        for (const [field, idx] of Object.entries(step.from || {})) {
          const src = outputs[idx as number]?.[0];
          if (!src) throw new Error(`Schritt ${i + 1}: Eingabe aus Schritt ${(idx as number) + 1} fehlt`);
          (req as any)[field] = src;
        }
        const job = createJob(req, { pipelineId: pipe.id, groupId: pipe.id });
        pipe.jobIds.push(job.id);
        save();
        emit('pipeline', pipe);
        const done = await waitForJob(job.id);
        if (done.status !== 'succeeded') throw new Error(`Schritt ${i + 1} (${step.task}): ${done.error || done.status}`);
        outputs.push(done.outputs);
      }
      pipe.status = 'succeeded';
      pipe.current = steps.length;
    } catch (e) {
      pipe.status = 'failed';
      pipe.error = errMsg(e);
    }
    save();
    emit('pipeline', pipe);
  })();
  return pipe;
}
