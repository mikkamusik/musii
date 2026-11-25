import crypto from 'node:crypto';

export function uid(prefix = ''): string {
  return prefix + crypto.randomBytes(8).toString('hex');
}

export const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Abgebrochen'));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new Error('Abgebrochen'));
      },
      { once: true },
    );
  });

export class ProviderError extends Error {
  status?: number;
  retryable: boolean;
  constructor(message: string, status?: number, retryable = true) {
    super(message);
    this.status = status;
    this.retryable = retryable;
  }
}

function snippet(text: string, max = 600): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max) + '…' : t;
}

function extractErrorMessage(text: string): string {
  try {
    const j = JSON.parse(text);
    const m =
      j?.error?.message ??
      j?.error?.detail ??
      j?.detail?.[0]?.msg ??
      j?.detail?.message ??
      j?.detail ??
      j?.message ??
      j?.error ??
      j?.errors?.[0] ??
      j?.title;
    if (typeof m === 'string') return m;
    if (m) return JSON.stringify(m);
  } catch {
    /* kein JSON */
  }
  return snippet(text);
}

export interface HttpOpts {
  method?: string;
  headers?: Record<string, string>;
  json?: unknown;
  body?: BodyInit;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export async function http(url: string, opts: HttpOpts = {}): Promise<Response> {
  const headers: Record<string, string> = { ...(opts.headers || {}) };
  let body = opts.body;
  if (opts.json !== undefined) {
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
    body = JSON.stringify(opts.json);
  }
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 120_000);
  const onAbort = () => ctrl.abort();
  opts.signal?.addEventListener('abort', onAbort, { once: true });
  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method || (body ? 'POST' : 'GET'),
      headers,
      body,
      signal: ctrl.signal,
    });
  } catch (e) {
    if (opts.signal?.aborted) throw new ProviderError('Abgebrochen', undefined, false);
    const msg = (e as Error)?.name === 'AbortError' ? 'Zeitüberschreitung' : (e as Error).message;
    throw new ProviderError(`Netzwerkfehler bei ${new URL(url).host}: ${msg}`);
  } finally {
    clearTimeout(timeout);
    opts.signal?.removeEventListener('abort', onAbort);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const retryable = res.status === 429 || res.status >= 500;
    throw new ProviderError(
      `${new URL(url).host} antwortete mit ${res.status}: ${extractErrorMessage(text) || res.statusText}`,
      res.status,
      retryable,
    );
  }
  return res;
}

export async function httpJson<T = any>(url: string, opts: HttpOpts = {}): Promise<T> {
  const res = await http(url, opts);
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ProviderError(`Ungültige JSON-Antwort von ${new URL(url).host}: ${snippet(text, 200)}`);
  }
}

export interface PollOpts {
  intervalMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/** Pollt fn, bis sie einen Wert != undefined liefert. */
export async function poll<T>(fn: () => Promise<T | undefined>, opts: PollOpts = {}): Promise<T> {
  const interval = opts.intervalMs ?? 3000;
  const deadline = Date.now() + (opts.timeoutMs ?? 20 * 60_000);
  let wait = Math.min(1500, interval);
  while (Date.now() < deadline) {
    const r = await fn();
    if (r !== undefined) return r;
    await sleep(wait, opts.signal);
    wait = Math.min(interval, wait * 1.5);
  }
  throw new ProviderError('Zeitüberschreitung beim Warten auf das Ergebnis');
}

/** Sammelt alle http(s)-URLs aus beliebig verschachtelten Ausgaben (Replicate, HTTP-Adapter …). */
export function collectUrls(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') {
    if (/^https?:\/\//.test(value) || value.startsWith('data:')) out.push(value);
  } else if (Array.isArray(value)) {
    value.forEach((v) => collectUrls(v, out));
  } else if (value && typeof value === 'object') {
    Object.values(value).forEach((v) => collectUrls(v, out));
  }
  return out;
}

/** Liest einen Pfad wie "data.0.url" oder "output[0]" aus einem Objekt */
export function getPath(obj: unknown, path: string): unknown {
  if (!path) return obj;
  const parts = path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean);
  let cur: any = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

export function mimeFromExt(file: string): string {
  const ext = file.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    mp4: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    m4a: 'audio/mp4',
    flac: 'audio/flac',
  };
  return map[ext] || 'application/octet-stream';
}

export function extFromMime(mime: string): string {
  const m = mime.split(';')[0].trim().toLowerCase();
  const map: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/svg+xml': 'svg',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/quicktime': 'mov',
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/wave': 'wav',
    'audio/ogg': 'ogg',
    'audio/mp4': 'm4a',
    'audio/flac': 'flac',
    'audio/webm': 'webm',
  };
  return map[m] || 'bin';
}

export function kindFromMime(mime: string): 'image' | 'video' | 'audio' {
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'image';
}

/** Sniffing anhand der Magic Bytes, falls ein Provider keinen sauberen Content-Type liefert */
export function sniffMime(buf: Buffer): string | undefined {
  if (buf.length < 12) return undefined;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WAVE') return 'audio/wav';
  if (buf.toString('ascii', 0, 3) === 'GIF') return 'image/gif';
  if (buf.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buf.toString('ascii', 8, 12);
    if (brand.startsWith('M4A')) return 'audio/mp4';
    if (brand === 'qt  ') return 'video/quicktime';
    return 'video/mp4';
  }
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'video/webm';
  if (buf.toString('ascii', 0, 3) === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) return 'audio/mpeg';
  if (buf.toString('ascii', 0, 4) === 'OggS') return 'audio/ogg';
  if (buf.toString('ascii', 0, 4) === 'fLaC') return 'audio/flac';
  const head = buf.toString('utf8', 0, Math.min(256, buf.length)).trimStart();
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return 'image/svg+xml';
  return undefined;
}

export function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

export function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
