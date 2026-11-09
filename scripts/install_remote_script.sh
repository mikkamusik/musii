#!/bin/bash
# Kopiert das Remote Script in die User Library (nicht ins Programmpaket).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$HOME/Music/Ableton/User Library/Remote Scripts/MikkaRemote"
if [ -e "$DEST" ]; then
  BACKUP="$DEST.backup-$(date +%Y%m%d-%H%M%S)"
  echo "Vorhandene Version wird gesichert: $BACKUP"
  mv "$DEST" "$BACKUP"
fi
mkdir -p "$(dirname "$DEST")"
cp -R "$ROOT/remote_script/MikkaRemote" "$DEST"
find "$DEST" -name '__pycache__' -prune -exec rm -rf {} +
echo "Installiert: $DEST"
echo "Ableton neu starten, dann: Einstellungen > Link, Tempo & MIDI > Control Surface: MikkaRemote (Eingang/Ausgang: Keine)"
