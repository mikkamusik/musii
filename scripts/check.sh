#!/bin/bash
# Phase 1: technische Bestandsaufnahme (liest nur, veraendert nichts).
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PY="$ROOT/agent/.venv/bin/python"; [ -x "$PY" ] || PY=python3
cd "$ROOT/agent" && exec "$PY" -m mikka_agent check "$@"
