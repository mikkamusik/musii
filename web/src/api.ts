import type { Asset } from './types';

export class ApiError extends Error {
  status: number;
  auth?: boolean;
  constructor(msg: string, status: number, auth?: boolean) {
    super(msg);
    this.status = status;
    this.auth = auth;
  }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: opts.method || (opts.body !== undefined ? 'POST' : 'GET'),
    headers: opts.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
  });
  const text = await res.text();
  let data: any;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = { error: text };
  }
  if (!res.ok) throw new ApiError(data?.error || `Fehler ${res.status}`, res.status, data?.auth);
  return data as T;
}

export async function upload(
  file: Blob,
  name: string,
  opts: { source?: 'upload' | 'local'; prompt?: string; meta?: Record<string, unknown> } = {},
): Promise<Asset> {
  const qs = new URLSearchParams({ name });
  if (opts.source) qs.set('source', opts.source);
  if (opts.prompt) qs.set('prompt', opts.prompt.slice(0, 800));
  if (opts.meta) qs.set('meta', JSON.stringify(opts.meta));
  const res = await fetch(`/api/upload?${qs}`, {
    method: 'POST',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data?.error || `Upload fehlgeschlagen (${res.status})`, res.status);
  return data as Asset;
}

export const mediaUrl = (a: Pick<Asset, 'file'>) => `/media/${a.file}`;

export function download(a: Asset) {
  const link = document.createElement('a');
  link.href = mediaUrl(a);
  const ext = a.file.split('.').pop();
  link.download = `${(a.name || a.id).replace(/[^\w\-äöüÄÖÜß ]+/g, '').trim().slice(0, 50) || a.id}.${ext}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export function fmtMoney(v: number) {
  return v < 0.01 && v > 0 ? '< 0,01 $' : `${v.toFixed(2).replace('.', ',')} $`;
}

export function timeAgo(ts: number) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'gerade eben';
  if (s < 3600) return `vor ${Math.round(s / 60)} Min.`;
  if (s < 86400) return `vor ${Math.round(s / 3600)} Std.`;
  return new Date(ts).toLocaleDateString('de-DE');
}
