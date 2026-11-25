import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// server/ (tsx) oder dist/server/ (kompiliert) -> Projektwurzel finden
function findRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 5; i++) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}

export const ROOT = findRoot(here);
export const DATA_DIR = path.resolve(process.env.MUSII_DATA_DIR || path.join(ROOT, 'data'));
export const MEDIA_DIR = path.join(DATA_DIR, 'media');
export const DB_FILE = path.join(DATA_DIR, 'db.json');
export const SECRET_FILE = path.join(DATA_DIR, '.secret');
export const WEB_DIST = path.join(ROOT, 'dist', 'web');

export const PORT = Number(process.env.PORT || 8787);
export const HOST = process.env.HOST || '127.0.0.1';
export const APP_PASSWORD = process.env.APP_PASSWORD || '';
/** Anfragen direkt vom eigenen Rechner (127.0.0.1) ohne Passwort zulassen – wird vom Handy-Modus gesetzt */
export const TRUST_LOCALHOST = process.env.MUSII_TRUST_LOCALHOST === '1';
/** Öffentliche Basis-URL (z. B. https://studio.example.com), damit Provider Eingabedateien per URL laden können */
export const PUBLIC_URL_ENV = process.env.PUBLIC_URL || '';

fs.mkdirSync(MEDIA_DIR, { recursive: true });
