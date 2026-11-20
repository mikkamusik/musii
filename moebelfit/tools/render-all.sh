#!/usr/bin/env bash
# Rendert alle Workout-Videos nacheinander nach videos/.
set -e
cd "$(dirname "$0")/.."
python3 build.py
for id in sieben-minuten erster-schritt stuhl-zirkel kuechen-kraft sofa-po wohnzimmer-hiit band-hantel bibliothek; do
  node tools/render.js "$id"
done
