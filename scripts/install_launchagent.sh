#!/bin/bash
# Optional: Agent als Hintergrunddienst bei der Anmeldung starten (launchd).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PLIST="$HOME/Library/LaunchAgents/com.mikka.studio-remote.plist"
if [ "${1:-}" = "--remove" ]; then
  launchctl unload "$PLIST" 2>/dev/null || true; rm -f "$PLIST"; echo "Entfernt."; exit 0
fi
read -r -p "Agent bei jeder Anmeldung automatisch starten? [j/N] " ans
[[ "$ans" =~ ^[jJyY]$ ]] || { echo "Abgebrochen."; exit 0; }
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/.mikka-studio"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.mikka.studio-remote</string>
  <key>ProgramArguments</key><array>
    <string>$ROOT/agent/.venv/bin/python</string><string>-m</string><string>mikka_agent</string><string>run</string>
  </array>
  <key>WorkingDirectory</key><string>$ROOT/agent</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>Nice</key><integer>5</integer>
  <key>StandardOutPath</key><string>$HOME/.mikka-studio/agent.log</string>
  <key>StandardErrorPath</key><string>$HOME/.mikka-studio/agent.log</string>
</dict></plist>
PL
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
echo "Installiert. Log: ~/.mikka-studio/agent.log  Entfernen: $0 --remove"
