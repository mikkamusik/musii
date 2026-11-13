#!/usr/bin/env bash
# Baut das komplette TikTok-Video: Frames rendern -> Audio synthetisieren -> MP4 muxen.
set -euo pipefail
cd "$(dirname "$0")"
WORK="${WORK:-$(mktemp -d)}"
mkdir -p out

echo "1/4 Frames rendern ..."
node render.js "$WORK/frames"

echo "2/4 Soundtrack synthetisieren ..."
python3 audio.py "$WORK/audio.wav"

echo "3/4 MP4 bauen ..."
ffmpeg -loglevel error -y -framerate 30 -i "$WORK/frames/f_%05d.jpg" -i "$WORK/audio.wav" \
  -c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p -profile:v high -movflags +faststart \
  -c:a aac -b:a 192k -shortest out/bass-kater-nanuka.mp4

echo "4/4 Cover-Bild ..."
ffmpeg -loglevel error -y -i "$WORK/frames/f_00060.jpg" out/cover.png

echo "Fertig: out/bass-kater-nanuka.mp4"
