# Produktion Folge 02 – reproduzierbar

Alle Schritte laufen offline, sobald Rohmaterial und Rohstimme geladen sind
(`quellen_urls.txt`). `WORKDIR` enthält `stock/raw/`, `voice/` und `build/`.

1. Rohmaterial nach `WORKDIR/stock/raw/`, Rohstimme nach `WORKDIR/voice/vo_raw.mp3`
2. `ffmpeg -i voice/vo_raw.mp3 -ac 1 -ar 48000 -c:a pcm_f32le voice/vo_raw48.wav`
3. `python3 asr.py voice/vo_raw.mp3 medium` – Wortzeiten (faster-whisper)
4. `python3 voice_build.py WORKDIR` – Sätze schneiden, 5 % ruhiger (Rubber Band, Tonhöhe bleibt), Pausen setzen → `build/voice_dry.wav`, `build/timeline.json`
5. `python3 score.py WORKDIR` – Musik → `build/music.wav`
6. `bash mix.sh WORKDIR` – Stimmkette, Ducking, −14 LUFS / −1 dBTP → `build/mix.wav`
7. `python3 render.py WORKDIR --probe 1,7,22` – Probebilder ansehen, dann
   `python3 render.py WORKDIR --render | ffmpeg -f rawvideo -pix_fmt rgb24 -s 1080x1920 -r 30 -i - … build/picture.mp4`
8. `python3 render.py WORKDIR --srt folge02.srt` – Untertitel als SRT
9. Bild und Ton zusammenführen (AAC 48 kHz)

Schnittliste, Bildausschnitte, Farblook (LUT), Titel und Untertitel stehen
oben in `render.py`. Die Untertitel werden aus dem exakten Skripttext gebaut
und an den gemessenen Satzzeiten der fertigen Stimme ausgerichtet; ein
`assert` bricht ab, falls ein Untertitel vom Skript abweicht.
