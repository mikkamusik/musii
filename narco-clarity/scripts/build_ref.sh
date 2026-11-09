#!/bin/bash
# script.json -> finished MP4 in the interview staging (animate_ref.py).
# Run from the directory that holds script.json:
#   bash ../scripts/build_ref.sh teaser.mp4
set -euo pipefail
S="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="${1:-folge.mp4}"

python3 -c "import piper" 2>/dev/null || pip install --break-system-packages -q piper-tts
# the display type; without it PIL cannot open the fonts and the render stops
[ -f /usr/share/texmf/fonts/opentype/public/tex-gyre/texgyreheroscn-bold.otf ] \
  || { apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq fonts-texgyre; }

echo "[1/3] Sprache"
python3 -I "$S/narrate.py"
echo "[2/3] Tonbett"
python3 -I "$S/score.py"
echo "[3/3] Bild und Mischung"
bash "$S/build_video.sh" "$S/animate_ref.py" "$OUT" 4 ref
