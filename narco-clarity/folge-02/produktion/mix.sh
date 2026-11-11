#!/bin/bash
# voice chain + ducked music bed -> loudness-normalised stereo mix (-14 LUFS, -1 dBTP)
set -euo pipefail
B="${1:-$PWD}/build"
VOICE="highpass=f=70,equalizer=f=170:t=q:w=0.9:g=1.5,equalizer=f=3400:t=q:w=1.2:g=1.2,deesser=i=0.35,acompressor=threshold=-21dB:ratio=2.6:attack=6:release=140:makeup=2.5dB,alimiter=limit=0.94:attack=3:release=60"
ffmpeg -nostdin -loglevel error -y -i $B/voice_dry.wav -i $B/music.wav -filter_complex "\
[0:a]aresample=48000,${VOICE},pan=stereo|c0=c0|c1=c0,asplit=2[v][vk];\
[1:a]aresample=48000,highpass=f=28,volume=-13dB[m];\
[m][vk]sidechaincompress=threshold=0.03:ratio=2:attack=90:release=650:makeup=1[md];\
[v][md]amix=inputs=2:normalize=0:duration=longest[mx]" -map "[mx]" -c:a pcm_s24le -ar 48000 $B/mix_pre.wav
# two-pass loudnorm (linear) to -14 LUFS / -1 dBTP
J=$(ffmpeg -nostdin -hide_banner -i $B/mix_pre.wav -af loudnorm=I=-14:TP=-1.0:LRA=11:print_format=json -f null - 2>&1 | sed -n '/^{/,/^}/p')
MI=$(echo "$J" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d['input_i'],d['input_tp'],d['input_lra'],d['input_thresh'],d['target_offset'])")
read II ITP ILRA ITH OFF <<< "$MI"
ffmpeg -nostdin -loglevel error -y -i $B/mix_pre.wav -af "loudnorm=I=-14:TP=-1.0:LRA=11:measured_I=$II:measured_TP=$ITP:measured_LRA=$ILRA:measured_thresh=$ITH:offset=$OFF:linear=true,aresample=48000" -c:a pcm_s24le -ar 48000 $B/mix.wav
ffmpeg -nostdin -hide_banner -i $B/mix.wav -af ebur128=peak=true -f null - 2>&1 | grep -A12 Summary | grep -E "I:|Peak:|LRA:"
