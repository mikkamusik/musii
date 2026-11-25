import type { MediaInput, ProviderOutput } from '../files.js';
import { collectUrls, httpJson, poll, ProviderError } from '../util.js';
import { buildGenericInput } from './generic-input.js';
import type { ProviderAdapter, RunCtx } from './types.js';

const BASE = 'https://api.replicate.com/v1';

async function fileRef(ctx: RunCtx, m: MediaInput): Promise<string> {
  const pub = m.publicUrl();
  if (pub) return pub;
  if (m.size < 256 * 1024) return m.dataUri();
  // Größere Dateien über die Replicate Files API hochladen
  const fd = new FormData();
  fd.set('content', m.blob(), m.filename);
  const j = await httpJson(`${base(ctx)}/files`, {
    body: fd,
    headers: { Authorization: `Bearer ${ctx.apiKey}` },
    signal: ctx.signal,
    timeoutMs: 5 * 60_000,
  });
  const url = j?.urls?.get;
  if (!url) throw new ProviderError('Upload zu Replicate fehlgeschlagen');
  return url;
}

function base(ctx: RunCtx) {
  return (ctx.conn.baseUrl || BASE).replace(/\/$/, '');
}

export const replicateAdapter: ProviderAdapter = {
  info: {
    type: 'replicate',
    label: 'Replicate',
    description:
      'Zugriff auf tausende Open-Source- und Partner-Modelle: Flux, Kling, Hailuo, Seedance, Wan, Lipsync, Upscaler u. v. m. Eigene Modelle per „owner/name“ oder „owner/name:version“ hinzufügen.',
    website: 'https://replicate.com',
    keyUrl: 'https://replicate.com/account/api-tokens',
    tasks: ['text-to-image', 'image-edit', 'text-to-video', 'image-to-video', 'lipsync', 'upscale-image', 'upscale-video', 'remove-bg', 'tts', 'music', 'sfx'],
    needsKey: true,
    baseUrl: { default: BASE },
  },
  async run(ctx) {
    const { model, req, apiKey, signal } = ctx;
    const input = await buildGenericInput(req, model, 'replicate', (m) => fileRef(ctx, m));
    const isVersion = model.model.includes(':');
    const url = isVersion ? `${base(ctx)}/predictions` : `${base(ctx)}/models/${model.model}/predictions`;
    const body = isVersion ? { version: model.model.split(':')[1], input } : { input };
    const headers = { Authorization: `Bearer ${apiKey}`, Prefer: 'wait=30' };
    let pred = await httpJson(url, { json: body, headers, signal, timeoutMs: 90_000 });
    const getUrl = pred?.urls?.get || (pred?.id ? `${base(ctx)}/predictions/${pred.id}` : '');
    if (pred.status !== 'succeeded') {
      if (!getUrl) throw new ProviderError('Keine Vorhersage-ID von Replicate');
      pred = await poll(
        async () => {
          const p = await httpJson(getUrl, { headers: { Authorization: `Bearer ${apiKey}` }, signal });
          if (p.status === 'succeeded') return p;
          if (p.status === 'failed' || p.status === 'canceled') {
            throw new ProviderError(typeof p.error === 'string' ? p.error : JSON.stringify(p.error || p.status), undefined, false);
          }
          const lastLog = typeof p.logs === 'string' ? p.logs.trim().split('\n').pop() : '';
          ctx.progress(p.status === 'starting' ? 'Modell startet …' : lastLog ? lastLog.slice(0, 120) : 'Rendert …');
          return undefined;
        },
        { intervalMs: 4000, signal },
      );
    }
    const urls = collectUrls(pred.output);
    if (!urls.length) throw new ProviderError('Replicate lieferte keine Datei');
    return urls.map(
      (u): ProviderOutput => ({
        url: u,
        headers: u.startsWith('https://api.replicate.com') ? { Authorization: `Bearer ${apiKey}` } : undefined,
      }),
    );
  },
  async test(conn, apiKey) {
    const j = await httpJson(`${(conn.baseUrl || BASE).replace(/\/$/, '')}/account`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeoutMs: 20_000,
    });
    return `Verbunden als ${j?.username || 'Replicate-Nutzer'}`;
  },
};
