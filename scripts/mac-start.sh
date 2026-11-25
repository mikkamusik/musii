#!/bin/bash
# Gemeinsamer Start für den Mac (wird von den .command-Dateien aufgerufen)
# Aufruf: mac-start.sh [handy]
set -e
cd "$(dirname "$0")/.."
MODE="${1:-}"

# Daten außerhalb des Projektordners speichern – so gehen sie bei Updates nicht verloren
export MUSII_DATA_DIR="${MUSII_DATA_DIR:-$HOME/MUSII-Daten}"
export PORT="${PORT:-8787}"

echo ""
echo "  MUSII Studio wird gestartet …"
echo "  Deine Bilder, Videos und Einstellungen liegen in: $MUSII_DATA_DIR"
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo "  ❌ Node.js ist noch nicht installiert."
  echo "     Ich öffne jetzt die Download-Seite. Lade dort die LTS-Version für macOS (.pkg),"
  echo "     installiere sie und starte diese Datei danach noch einmal."
  open "https://nodejs.org/de/download" || true
  read -r -p "  Drücke Enter zum Schließen …" _
  exit 1
fi

NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "  ❌ Node.js $(node -v) ist zu alt – bitte die aktuelle LTS-Version von nodejs.org installieren."
  open "https://nodejs.org/de/download" || true
  read -r -p "  Drücke Enter zum Schließen …" _
  exit 1
fi

if [ ! -d node_modules ] || [ package.json -nt node_modules ]; then
  echo "  📦 Installiere Bausteine (nur beim ersten Start, dauert 1–2 Minuten) …"
  npm install --no-fund --no-audit
  touch node_modules
fi

if [ ! -f dist/server/index.js ] || [ -n "$(find server web/src package.json -newer dist/server/index.js -print -quit 2>/dev/null)" ]; then
  echo "  🔧 Baue die App …"
  npm run build
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "  ℹ️  Optional: Mit ffmpeg funktionieren auch Demo-Videos ohne KI-Anbieter (brew install ffmpeg)."
fi

# Browser öffnen, sobald der Server läuft
( for i in $(seq 1 40); do
    if curl -s -o /dev/null "http://127.0.0.1:$PORT/api/auth"; then open "http://127.0.0.1:$PORT"; break; fi
    sleep 0.5
  done ) &

echo ""
echo "  ✅ Läuft! Dieses Fenster geöffnet lassen. Zum Beenden: Fenster schließen oder Ctrl+C."
echo ""
# Mac während der Nutzung wach halten (sonst verliert das Handy die Verbindung)
KEEP_AWAKE=""
command -v caffeinate >/dev/null 2>&1 && KEEP_AWAKE="caffeinate -i"
if [ "$MODE" = "handy" ]; then
  exec $KEEP_AWAKE node scripts/start-handy.mjs
else
  exec $KEEP_AWAKE node dist/server/index.js
fi
