#!/bin/bash
# Gekoppelte Geraete anzeigen; widerrufen mit: ./scripts/devices.sh revoke <ID>
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/agent"
if [ "${1:-}" = "revoke" ]; then exec ./.venv/bin/python -m mikka_agent revoke "$2"; fi
exec ./.venv/bin/python -m mikka_agent devices
