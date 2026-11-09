#!/bin/bash
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/agent" && exec ./.venv/bin/python -m mikka_agent run "$@"
