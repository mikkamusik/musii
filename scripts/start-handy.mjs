// Startet MUSII Studio so, dass Handy & Tablet im selben WLAN (oder per Tailscale) zugreifen können.
// - lauscht auf allen Netzwerkadressen (HOST=0.0.0.0)
// - schützt den Zugriff mit einem Passwort (wird einmalig erzeugt und gespeichert)
// - der eigene Rechner selbst braucht kein Passwort
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.resolve(process.env.MUSII_DATA_DIR || path.join(root, 'data'));
fs.mkdirSync(dataDir, { recursive: true });
const port = process.env.PORT || '8787';

let password = process.env.APP_PASSWORD;
const pwFile = path.join(dataDir, 'handy-passwort.txt');
if (!password) {
  if (fs.existsSync(pwFile)) password = fs.readFileSync(pwFile, 'utf8').trim();
  if (!password) {
    const words = ['sonne', 'kamera', 'wolke', 'studio', 'film', 'regen', 'blitz', 'welle', 'stern', 'traum', 'licht', 'farbe'];
    password = `${words[crypto.randomInt(words.length)]}-${words[crypto.randomInt(words.length)]}-${crypto.randomInt(100, 999)}`;
    fs.writeFileSync(pwFile, password + '\n', { mode: 0o600 });
  }
}

const urls = [];
for (const list of Object.values(os.networkInterfaces())) {
  for (const a of list || []) {
    if (a.family === 'IPv4' && !a.internal) urls.push(`http://${a.address}:${port}`);
  }
}

const line = '─'.repeat(60);
console.log(`\n${line}\n  📱 MUSII Studio – Handy-Modus\n${line}`);
console.log(`  Auf diesem Rechner:   http://127.0.0.1:${port}   (ohne Passwort)`);
if (urls.length) {
  console.log('  Auf dem Handy öffnen (gleiches WLAN):');
  for (const u of urls) console.log(`     ${u}`);
} else {
  console.log('  ⚠️  Keine Netzwerkadresse gefunden – ist das WLAN verbunden?');
}
console.log(`  Passwort fürs Handy:  ${password}`);
console.log('  Tipp: In der App unten links auf „📱 Aufs Handy“ klicken – dort gibt es einen QR-Code.');
console.log(`${line}\n`);

const child = spawn(process.execPath, [path.join(root, 'dist', 'server', 'index.js')], {
  stdio: 'inherit',
  env: { ...process.env, HOST: '0.0.0.0', PORT: port, APP_PASSWORD: password, MUSII_TRUST_LOCALHOST: '1', MUSII_DATA_DIR: dataDir },
});
const stop = () => child.kill('SIGTERM');
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
child.on('exit', (code) => process.exit(code ?? 0));
