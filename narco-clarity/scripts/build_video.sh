#!/bin/bash
# Picture + mix for an existing voice.wav / bed.wav / timeline.json.
#   build_video.sh <animate script> <output.mp4> [parallel parts] [tag]
# Run from the working directory that holds timeline.json.
set -euo pipefail
S="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ANIM="$1"; OUT="$2"; N="${3:-3}"; TAG="${4:-v}"

pids=()
for p in $(seq 0 $((N-1))); do
  ( python3 -I "$S/partrender.py" "$ANIM" "$p" "$N" \
    | ffmpeg -nostdin -loglevel error -y -f rawvideo -pix_fmt rgb24 -s 1920x1080 -r 30 -i - \
        -c:v libx264 -crf 18 -preset veryfast -pix_fmt yuv420p -g 60 "${TAG}_part$p.mp4" ) &
  pids+=($!)
done
for pid in "${pids[@]}"; do wait "$pid"; done

: > "${TAG}_list.txt"
for p in $(seq 0 $((N-1))); do echo "file '${TAG}_part$p.mp4'" >> "${TAG}_list.txt"; done
ffmpeg -nostdin -loglevel error -y -f concat -safe 0 -i "${TAG}_list.txt" -c copy "${TAG}_stumm.mp4"

# The bed is sidechained under the voice so speech stays intelligible on
# phone speakers without having to mix the music down to inaudibility.
ffmpeg -nostdin -loglevel error -y -i "${TAG}_stumm.mp4" -i voice.wav -i bed.wav \
 -filter_complex "[1:a]asplit=2[v1][v2];\
[2:a][v1]sidechaincompress=threshold=0.03:ratio=8:attack=15:release=400[bd];\
[bd][v2]amix=inputs=2:normalize=0[mx];\
[mx]loudnorm=I=-14:TP=-1.0:LRA=11,aresample=48000[a]" \
 -map 0:v -map "[a]" -c:v copy -ar 48000 -c:a aac -b:a 192k -movflags +faststart -shortest "$OUT.part.mp4"
mv "$OUT.part.mp4" "$OUT"
rm -f "${TAG}_part"*.mp4 "${TAG}_list.txt"
ffprobe -v error -count_frames -select_streams v:0 -show_entries stream=nb_read_frames -of default=noprint_wrappers=1 "$OUT"
ffprobe -v error -show_entries format=duration,size -of default=noprint_wrappers=1 "$OUT"
echo "fertig: $(pwd)/$OUT"
