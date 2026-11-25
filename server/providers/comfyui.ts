import type { ProviderOutput } from '../files.js';
import type { Connection, ModelDef, Task } from '../types.js';
import { httpJson, poll, ProviderError, uid } from '../util.js';
import { fillTemplate, templateVars } from './template.js';
import type { ProviderAdapter } from './types.js';

const DEFAULT_BASE = 'http://127.0.0.1:8188';

const WORKFLOW_TASKS: Task[] = ['text-to-image', 'image-edit', 'image-to-video', 'text-to-video', 'upscale-image', 'remove-bg', 'lipsync'];

function base(conn: Connection) {
  return (conn.baseUrl || DEFAULT_BASE).replace(/\/$/, '');
}

function workflows(conn: Connection): Partial<Record<Task, string>> {
  return (conn.options?.workflows as Partial<Record<Task, string>>) || {};
}

export const comfyAdapter: ProviderAdapter = {
  info: {
    type: 'comfyui',
    label: 'ComfyUI (lokal / eigener Server)',
    description:
      'Eigene Workflows (API-Format) mit Platzhaltern wie "{{prompt}}", "{{seed}}", "{{width}}", "{{height}}", "{{image}}" – damit läuft jedes lokale Modell (SDXL, FLUX, Wan, HunyuanVideo, LTX …).',
    website: 'https://github.com/comfyanonymous/ComfyUI',
    tasks: WORKFLOW_TASKS,
    needsKey: false,
    baseUrl: { default: DEFAULT_BASE, required: true },
    multi: true,
    fields: WORKFLOW_TASKS.map((t) => ({
      key: `workflows.${t}`,
      label: `Workflow: ${t}`,
      type: 'json' as const,
      placeholder: '{ "3": { "class_type": "KSampler", "inputs": { "seed": "{{seed}}" … } } }',
      help: 'In ComfyUI: „Save (API Format)“. Platzhalter: {{prompt}} {{negative_prompt}} {{seed}} {{width}} {{height}} {{image}} {{end_image}} {{audio}} {{video}} {{duration}}',
    })),
  },
  async run(ctx) {
    const { conn, model, req, signal, apiKey } = ctx;
    const wf = workflows(conn)[model.task];
    if (!wf) throw new ProviderError(`Kein ComfyUI-Workflow für ${model.task} hinterlegt`, 400, false);
    const headers: Record<string, string> = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
    const b = base(conn);

    async function upload(m?: { blob(): Blob; filename: string }) {
      if (!m) return '';
      const fd = new FormData();
      fd.set('image', m.blob(), m.filename);
      fd.set('overwrite', 'true');
      const j = await httpJson(`${b}/upload/image`, { body: fd, headers, signal });
      return j?.subfolder ? `${j.subfolder}/${j.name}` : j?.name;
    }
    const vars = templateVars(req, {
      image: await upload(req.image),
      end_image: await upload(req.endImage),
      mask: await upload(req.mask),
      audio: await upload(req.audio),
      video: await upload(req.video),
    });
    let prompt: unknown;
    try {
      prompt = JSON.parse(fillTemplate(wf, vars));
    } catch (e) {
      throw new ProviderError(`Workflow ist kein gültiges JSON: ${(e as Error).message}`, 400, false);
    }
    const sub = await httpJson(`${b}/prompt`, { json: { prompt, client_id: uid('musii_') }, headers, signal });
    if (sub?.error) throw new ProviderError(JSON.stringify(sub.error), 400, false);
    const id = sub?.prompt_id;
    if (!id) throw new ProviderError('Keine prompt_id von ComfyUI');
    const hist = await poll(
      async () => {
        const h = await httpJson(`${b}/history/${id}`, { headers, signal });
        const entry = h?.[id];
        if (!entry) {
          ctx.progress('In der ComfyUI-Warteschlange …');
          return undefined;
        }
        if (entry.status?.status_str === 'error') {
          const msg = entry.status?.messages?.find((m: any) => m[0] === 'execution_error')?.[1]?.exception_message;
          throw new ProviderError(`ComfyUI-Fehler: ${msg || 'Ausführung fehlgeschlagen'}`, undefined, false);
        }
        return entry.status?.completed || entry.outputs ? entry : undefined;
      },
      { intervalMs: 2000, signal },
    );
    const out: ProviderOutput[] = [];
    for (const node of Object.values<any>(hist.outputs || {})) {
      for (const key of ['images', 'gifs', 'videos', 'audio']) {
        for (const f of node?.[key] || []) {
          if (f?.type === 'temp' && key === 'images' && Object.keys(hist.outputs).length > 1) continue;
          const qs = new URLSearchParams({ filename: f.filename, subfolder: f.subfolder || '', type: f.type || 'output' });
          out.push({ url: `${b}/view?${qs}`, headers });
        }
      }
    }
    if (!out.length) throw new ProviderError('Der Workflow erzeugte keine Ausgabe (fehlt ein Save-Node?)');
    return out;
  },
  async listModels(conn) {
    return Object.entries(workflows(conn))
      .filter(([, wf]) => wf && String(wf).trim())
      .map(
        ([task]): ModelDef => ({
          id: `comfyui:${conn.id}:${task}`,
          provider: 'comfyui',
          connectionId: conn.id,
          task: task as Task,
          label: `${conn.name} – Workflow`,
          model: task,
          quality: Number(conn.options?.quality ?? 75),
          speed: 3,
          cost: 0,
          features: { refs: false, negative: true, endFrame: true, inputImage: true, inputVideo: true },
        }),
      );
  },
  async test(conn, apiKey) {
    const j = await httpJson(`${base(conn)}/system_stats`, { headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {}, timeoutMs: 8000 });
    const dev = j?.devices?.[0];
    return `Verbunden – ComfyUI ${j?.system?.comfyui_version || ''}${dev ? ` auf ${dev.name}` : ''}`;
  },
};
