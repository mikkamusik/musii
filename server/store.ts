import fs from 'node:fs';
import crypto from 'node:crypto';
import { DB_FILE, SECRET_FILE } from './config.js';
import type { DbShape, Settings } from './types.js';
import { uid } from './util.js';

const DEFAULT_SETTINGS: Settings = {
  routing: 'quality',
  llmModelId: 'auto',
  judgeModelId: 'auto',
  autoEnhance: false,
  autoFallback: true,
  concurrency: 4,
  language: 'de',
  publicUrl: '',
};

function emptyDb(): DbShape {
  return {
    version: 1,
    connections: [
      {
        id: 'demo',
        type: 'demo',
        name: 'Demo (offline, kostenlos)',
        enabled: true,
        createdAt: Date.now(),
      },
    ],
    customModels: [],
    modelOverrides: {},
    jobs: [],
    assets: [],
    characters: [],
    arenas: [],
    pipelines: [],
    ledger: [],
    settings: { ...DEFAULT_SETTINGS },
  };
}

function load(): DbShape {
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Partial<DbShape>;
    const base = emptyDb();
    return {
      ...base,
      ...parsed,
      settings: { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) },
    } as DbShape;
  } catch {
    return emptyDb();
  }
}

export const db: DbShape = load();

// Laufende Jobs nach einem Neustart sauber abschließen
for (const j of db.jobs) {
  if (j.status === 'queued' || j.status === 'running') {
    j.status = 'failed';
    j.error = 'Server wurde neu gestartet – bitte erneut ausführen.';
    j.finishedAt = Date.now();
  }
}
for (const p of db.pipelines) if (p.status === 'running') p.status = 'failed';
for (const a of db.arenas) if (a.status === 'running' || a.status === 'judging') a.status = 'failed';

let saveTimer: NodeJS.Timeout | null = null;
export function save(immediate = false) {
  const write = () => {
    saveTimer = null;
    // Größe begrenzen
    if (db.jobs.length > 1000) db.jobs.splice(0, db.jobs.length - 1000);
    if (db.ledger.length > 5000) db.ledger.splice(0, db.ledger.length - 5000);
    if (db.arenas.length > 300) db.arenas.splice(0, db.arenas.length - 300);
    if (db.pipelines.length > 300) db.pipelines.splice(0, db.pipelines.length - 300);
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db, null, 1));
    fs.renameSync(tmp, DB_FILE);
  };
  if (immediate) {
    if (saveTimer) clearTimeout(saveTimer);
    write();
    return;
  }
  if (!saveTimer) saveTimer = setTimeout(write, 400);
}
process.on('exit', () => {
  if (saveTimer) {
    clearTimeout(saveTimer);
    try {
      fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 1));
    } catch {
      /* ignore */
    }
  }
});

// ---------- Verschlüsselung der API-Schlüssel (AES-256-GCM) ----------
function secretKey(): Buffer {
  if (process.env.MUSII_SECRET) return crypto.createHash('sha256').update(process.env.MUSII_SECRET).digest();
  try {
    const s = fs.readFileSync(SECRET_FILE);
    if (s.length === 32) return s;
  } catch {
    /* neu erzeugen */
  }
  const k = crypto.randomBytes(32);
  fs.writeFileSync(SECRET_FILE, k, { mode: 0o600 });
  return k;
}
const KEY = secretKey();

export function encrypt(plain: string): string {
  if (!plain) return '';
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  const tag = c.getAuthTag();
  return 'enc:' + Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decrypt(value?: string): string {
  if (!value) return '';
  if (!value.startsWith('enc:')) return value;
  try {
    const raw = Buffer.from(value.slice(4), 'base64');
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const enc = raw.subarray(28);
    const d = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
  } catch {
    return '';
  }
}

export function maskKey(value?: string): string {
  const plain = decrypt(value);
  if (!plain) return '';
  if (plain.length <= 8) return '••••';
  return plain.slice(0, 4) + '••••' + plain.slice(-4);
}

/** HMAC-Token für den optionalen Passwortschutz */
export function authToken(password: string): string {
  return crypto.createHmac('sha256', KEY).update('musii:' + password).digest('hex');
}

export { uid };
