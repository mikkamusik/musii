#!/bin/bash
# Startet MUSII Studio im Codespace im Hintergrund (Port 8787 wird automatisch weitergeleitet)
cd "$(dirname "$0")/.."
[ -f dist/server/index.js ] || npm run build
pkill -f "node dist/server/index.js" 2>/dev/null || true
HOST=0.0.0.0 nohup node dist/server/index.js > /tmp/musii.log 2>&1 &
echo "MUSII Studio startet – öffne den Tab „Ports“ und klicke bei 8787 auf das Globus-Symbol."
