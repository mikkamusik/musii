#!/bin/bash
# Erzeugt einen 6-stelligen Einmal-Kopplungscode (5 Minuten gueltig).
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/agent" && exec ./.venv/bin/python -m mikka_agent pair
