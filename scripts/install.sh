#!/bin/bash
# MIKKA STUDIO REMOTE - Installation auf dem Mac (macOS Monterey 12+)
# Veraendert NICHTS an der Ableton-Installation. Das Remote Script wird nur nach
# Rueckfrage in die User Library kopiert.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PY="${PYTHON:-python3}"
if ! command -v "$PY" >/dev/null 2>&1; then
  echo "python3 nicht gefunden. Installieren mit: xcode-select --install"; exit 1
fi
"$PY" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)' || {
  echo "Python >= 3.8 erforderlich (gefunden: $("$PY" --version))"; exit 1; }

echo "==> Virtuelle Umgebung in agent/.venv"
"$PY" -m venv agent/.venv
agent/.venv/bin/pip install --quiet --upgrade pip
agent/.venv/bin/pip install --quiet -r agent/requirements.txt

echo "==> Konfiguration in ~/.mikka-studio"
mkdir -p "$HOME/.mikka-studio" && chmod 700 "$HOME/.mikka-studio"
mkdir -p "$HOME/Music/MIKKA Exports"

echo
read -r -p "Remote Script 'MikkaRemote' in die Ableton User Library kopieren? [j/N] " ans
if [[ "$ans" =~ ^[jJyY]$ ]]; then
  "$ROOT/scripts/install_remote_script.sh"
else
  echo "Uebersprungen. Spaeter: ./scripts/install_remote_script.sh"
fi

echo
"$ROOT/scripts/check.sh" || true
echo
echo "Fertig. Agent starten mit: ./scripts/start.sh"
