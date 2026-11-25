import type { ProviderOutput } from '../files.js';
import type { Connection, ModelDef, Task } from '../types.js';
import { collectUrls, getPath, http, httpJson, poll, ProviderError } from '../util.js';
import { fillString, fillTemplate, templateVars } from './template.js';
import type { ProviderAdapter } from './types.js';

/**
 * Universeller HTTP-Adapter: verbindet jede beliebige KI-REST-API per Vorlage.
 * options: task, method, path, headers (JSON), body (JSON-Vorlage), resultPath,
 *          pollUrlPath, pollUrlTemplate, statusPath, doneValues, failValues, pollResultPath, quality
 */
interface HttpOptions {
  task?: Task;
  method?: string;
  path?: string;
  headers?: string;
  body?: string;
  resultPath?: string;
  pollUrlPath?: string;
  pollUrlTemplate?: string;
  idPath?: string;
  statusPath?: string;
  doneValues?: string;
  failValues?: string;
  pollResultPath?: string;
  binary?: string;
  quality?: string | number;
}

function opts(conn: Connection): HttpOptions {
  return (conn.options || {}) as HttpOptions;
}

function toOutputs(value: unknown, authHeaders: Record<string, string>): ProviderOutput[] {
  if (typeof value === 'string' && !/^https?:|^data:/.test(value) && value.length > 200) {
    return [{ b64: value }];
  }
  const urls = collectUrls(value);
  return urls.map((u) => ({ url: u, headers: u.startsWith('http') ? authHeaders : undefined }));
}

export const httpAdapter: ProviderAdapter = {
  info: {
    type: 'http',
    label: 'Eigene HTTP-API (universell)',
    description:
      'Verbinde jede KI per REST-Vorlage – inklusive asynchroner APIs mit Polling. Platzhalter: {{prompt}} {{negative_prompt}} {{image_url}} {{image_b64}} {{end_image_url}} {{audio_url}} {{video_url}} {{aspect_ratio}} {{duration}} {{seed}} {{width}} {{height}} {{api_key}}',
    tasks: ['text-to-image', 'image-edit', 'text-to-video', 'image-to-video', 'lipsync', 'upscale-image', 'upscale-video', 'remove-bg', 'tts', 'sfx', 'music', 'llm'],
    needsKey: false,
    baseUrl: { required: true },
    multi: true,
    fields: [
      { key: 'task', label: 'Aufgabe', type: 'text', placeholder: 'z. B. image-to-video' },
      { key: 'method', label: 'HTTP-Methode', type: 'text', placeholder: 'POST' },
      { key: 'path', label: 'Pfad (an Basis-URL angehängt)', type: 'text', placeholder: '/v1/generate' },
      { key: 'headers', label: 'Header (JSON)', type: 'json', placeholder: '{ "Authorization": "Bearer {{api_key}}" }' },
      { key: 'body', label: 'Body-Vorlage (JSON)', type: 'json', placeholder: '{ "prompt": "{{prompt}}", "image": "{{image_url}}" }' },
      { key: 'resultPath', label: 'Pfad zum Ergebnis (synchron)', type: 'text', placeholder: 'data.0.url', help: 'Leer lassen bei asynchronen APIs' },
      { key: 'idPath', label: 'Pfad zur Auftrags-ID (asynchron)', type: 'text', placeholder: 'id' },
      { key: 'pollUrlPath', label: 'Pfad zur Status-URL in der Antwort', type: 'text', placeholder: 'urls.get' },
      { key: 'pollUrlTemplate', label: 'oder Status-URL-Vorlage', type: 'text', placeholder: 'https://api.example.com/v1/tasks/{{id}}' },
      { key: 'statusPath', label: 'Pfad zum Status', type: 'text', placeholder: 'status' },
      { key: 'doneValues', label: 'Fertig-Werte (Komma)', type: 'text', placeholder: 'succeeded,completed,SUCCEEDED' },
      { key: 'failValues', label: 'Fehler-Werte (Komma)', type: 'text', placeholder: 'failed,error,FAILED' },
      { key: 'pollResultPath', label: 'Pfad zum Ergebnis (nach Polling)', type: 'text', placeholder: 'output' },
      { key: 'binary', label: 'Antwort ist Binärdatei? (ja/nein)', type: 'text', placeholder: 'nein' },
      { key: 'quality', label: 'Qualitäts-Score für Smart-Router (0-100)', type: 'text', placeholder: '80' },
    ],
  },
  async run(ctx) {
    const { conn, req, signal, apiKey } = ctx;
    const o = opts(conn);
    const vars = templateVars(req, { api_key: apiKey });
    const headers: Record<string, string> = o.headers ? JSON.parse(fillTemplate(o.headers, vars)) : {};
    const url = (conn.baseUrl || '').replace(/\/$/, '') + fillString(o.path || '', vars);
    const method = (o.method || 'POST').toUpperCase();
    const body = method === 'GET' ? undefined : o.body ? fillTemplate(o.body, vars) : JSON.stringify({ prompt: req.prompt });
    if (body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';

    if (/^(ja|yes|true|1)$/i.test(String(o.binary || ''))) {
      const res = await http(url, { method, headers, body, signal, timeoutMs: 10 * 60_000 });
      return [{ buffer: Buffer.from(await res.arrayBuffer()), mime: res.headers.get('content-type') || undefined }];
    }
    const first = await httpJson(url, { method, headers, body, signal, timeoutMs: 10 * 60_000 });
    const isAsync = !!(o.pollUrlPath || o.pollUrlTemplate);
    if (!isAsync) {
      const out = toOutputs(getPath(first, o.resultPath || ''), headers);
      if (!out.length) throw new ProviderError('Kein Ergebnis unter dem angegebenen Pfad gefunden');
      return out;
    }
    const id = getPath(first, o.idPath || 'id');
    const pollUrl = o.pollUrlPath ? String(getPath(first, o.pollUrlPath) || '') : fillString(o.pollUrlTemplate || '', { ...vars, id });
    if (!pollUrl) throw new ProviderError('Status-URL nicht gefunden');
    const done = (o.doneValues || 'succeeded,completed,success,SUCCEEDED,COMPLETED,done,Ready').split(',').map((s) => s.trim());
    const fail = (o.failValues || 'failed,error,FAILED,ERROR,canceled,cancelled').split(',').map((s) => s.trim());
    const result = await poll(
      async () => {
        const s = await httpJson(pollUrl, { headers, signal });
        const status = String(getPath(s, o.statusPath || 'status') ?? '');
        if (done.includes(status)) return s;
        if (fail.includes(status)) throw new ProviderError(`API meldet Status „${status}“: ${JSON.stringify(s).slice(0, 300)}`, undefined, false);
        ctx.progress(`Status: ${status || 'läuft'} …`);
        return undefined;
      },
      { intervalMs: 3000, signal },
    );
    const out = toOutputs(getPath(result, o.pollResultPath || 'output'), headers);
    if (!out.length) throw new ProviderError('Kein Ergebnis unter dem angegebenen Pfad gefunden');
    return out;
  },
  async llm(conn, apiKey, _model, call, signal) {
    const ctxReq: any = { prompt: (call.system ? call.system + '\n\n' : '') + call.prompt, refImages: [] };
    const o = opts(conn);
    const vars = templateVars(ctxReq, { api_key: apiKey });
    const headers: Record<string, string> = o.headers ? JSON.parse(fillTemplate(o.headers, vars)) : {};
    const url = (conn.baseUrl || '').replace(/\/$/, '') + fillString(o.path || '', vars);
    const body = o.body ? fillTemplate(o.body, vars) : JSON.stringify({ prompt: ctxReq.prompt });
    if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
    const j = await httpJson(url, { method: o.method || 'POST', headers, body, signal });
    const v = getPath(j, o.resultPath || '');
    return typeof v === 'string' ? v : JSON.stringify(v);
  },
  async listModels(conn) {
    const o = opts(conn);
    if (!o.task) return [];
    return [
      {
        id: `http:${conn.id}`,
        provider: 'http',
        connectionId: conn.id,
        task: o.task,
        label: conn.name,
        model: conn.id,
        quality: Number(o.quality ?? 70),
        speed: 3,
        cost: 0,
        features: { endFrame: true, refs: true, negative: true, inputImage: true, inputVideo: true, audio: true, vision: false },
      } satisfies ModelDef,
    ];
  },
  async test(conn) {
    if (!conn.baseUrl) throw new ProviderError('Basis-URL fehlt', 400, false);
    const o = opts(conn);
    if (!o.task) throw new ProviderError('Bitte eine Aufgabe festlegen (z. B. text-to-image)', 400, false);
    return `Konfiguriert für ${o.task} → ${conn.baseUrl}${o.path || ''}`;
  },
};
