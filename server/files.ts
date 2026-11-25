import fs from 'node:fs';
import path from 'node:path';
import { MEDIA_DIR, PUBLIC_URL_ENV } from './config.js';
import { db, save } from './store.js';
import type { Asset, AssetKind } from './types.js';
import { extFromMime, http, kindFromMime, mimeFromExt, ProviderError, sniffMime, uid } from './util.js';
import { emit } from './events.js';

export interface ProviderOutput {
  url?: string;
  b64?: string;
  buffer?: Buffer;
  mime?: string;
  /** Header zum Herunterladen (z. B. Auth bei OpenAI-/Google-Videos) */
  headers?: Record<string, string>;
  meta?: Record<string, unknown>;
}

export function assetPath(asset: Asset): string {
  return path.join(MEDIA_DIR, asset.file);
}

export function getAsset(id?: string): Asset | undefined {
  if (!id) return undefined;
  return db.assets.find((a) => a.id === id);
}

export function requireAsset(id: string): Asset {
  const a = getAsset(id);
  if (!a) throw new ProviderError(`Datei ${id} nicht gefunden`, 404, false);
  if (!fs.existsSync(assetPath(a))) throw new ProviderError(`Datei ${a.file} fehlt auf der Festplatte`, 404, false);
  return a;
}

export function writeAsset(
  buf: Buffer,
  mime: string,
  info: Partial<Asset> & { source: Asset['source'] },
): Asset {
  const sniffed = sniffMime(buf);
  let finalMime = mime && mime !== 'application/octet-stream' && !mime.startsWith('binary/') ? mime : sniffed || mime;
  // Provider liefern manchmal text/plain o. ä. für Medien
  if (sniffed && (!finalMime.match(/^(image|video|audio)\//) || finalMime === 'application/octet-stream')) finalMime = sniffed;
  finalMime = finalMime.split(';')[0].trim();
  const kind: AssetKind = info.kind || kindFromMime(finalMime);
  const id = uid('a_');
  const file = `${id}.${extFromMime(finalMime)}`;
  fs.writeFileSync(path.join(MEDIA_DIR, file), buf);
  const asset: Asset = {
    id,
    kind,
    file,
    mime: finalMime,
    size: buf.length,
    createdAt: Date.now(),
    ...info,
  };
  asset.kind = kind;
  db.assets.push(asset);
  save();
  emit('asset', asset);
  return asset;
}

export async function outputToBuffer(out: ProviderOutput, signal?: AbortSignal): Promise<{ buf: Buffer; mime: string }> {
  if (out.buffer) return { buf: out.buffer, mime: out.mime || sniffMime(out.buffer) || 'application/octet-stream' };
  if (out.b64) {
    const buf = Buffer.from(out.b64, 'base64');
    return { buf, mime: out.mime || sniffMime(buf) || 'image/png' };
  }
  if (out.url) {
    if (out.url.startsWith('data:')) {
      const m = out.url.match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
      if (!m) throw new ProviderError('Ungültige Data-URL im Ergebnis');
      const buf = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]));
      return { buf, mime: m[1] || sniffMime(buf) || 'application/octet-stream' };
    }
    const res = await http(out.url, { headers: out.headers, signal, timeoutMs: 10 * 60_000 });
    const buf = Buffer.from(await res.arrayBuffer());
    const ct = res.headers.get('content-type') || '';
    const fromUrl = mimeFromExt(new URL(out.url).pathname);
    const mime =
      out.mime ||
      (ct && !ct.startsWith('application/octet-stream') && !ct.startsWith('binary/') ? ct : '') ||
      sniffMime(buf) ||
      fromUrl;
    return { buf, mime };
  }
  throw new ProviderError('Provider lieferte kein Ergebnis');
}

export function publicUrlFor(asset: Asset): string | undefined {
  const base = (db.settings.publicUrl || PUBLIC_URL_ENV || '').replace(/\/$/, '');
  if (!base) return undefined;
  return `${base}/media/${asset.file}`;
}

/** Komfortable Darstellung einer Eingabedatei für Provider */
export class MediaInput {
  asset: Asset;
  private _buf?: Buffer;
  constructor(asset: Asset) {
    this.asset = asset;
  }
  get mime() {
    return this.asset.mime;
  }
  get filename() {
    return this.asset.file;
  }
  get kind() {
    return this.asset.kind;
  }
  get size() {
    return this.asset.size;
  }
  buffer(): Buffer {
    if (!this._buf) this._buf = fs.readFileSync(assetPath(this.asset));
    return this._buf;
  }
  base64(): string {
    return this.buffer().toString('base64');
  }
  dataUri(): string {
    return `data:${this.mime};base64,${this.base64()}`;
  }
  blob(): Blob {
    return new Blob([new Uint8Array(this.buffer())], { type: this.mime });
  }
  publicUrl(): string | undefined {
    return publicUrlFor(this.asset);
  }
}

export function mediaInput(id?: string): MediaInput | undefined {
  if (!id) return undefined;
  return new MediaInput(requireAsset(id));
}

export function deleteAssetFile(asset: Asset) {
  try {
    fs.unlinkSync(assetPath(asset));
  } catch {
    /* schon weg */
  }
}

export function guessMimeFromName(name: string) {
  return mimeFromExt(name);
}
