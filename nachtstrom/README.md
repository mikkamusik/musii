# NACHTSTROM – 145 BPM · f-Moll · Hard Groove / Driving Techno

Ein komplett neu produzierter Track. Alle Sounds sind selbst synthetisiert: Es gibt keine Samples, keine Presets und keine Vorlage.

## In Ableton öffnen (3 Schritte)

1. Auf GitHub den Branch `claude/tender-heisenberg-9su1ht` auswählen, dann **Code → Download ZIP** klicken und das ZIP entpacken.
2. Den Ordner `nachtstrom/` öffnen und **`NACHTSTROM.als`** doppelklicken. Tempo 145 und alle 16 Spuren sind bereits eingestellt.
3. Mit **Tab** in die Arrangement-Ansicht wechseln. Die Locators zeigen die Sections: INTRO, BUILD, DROP 1, BREAK, PEAK usw.

**Falls Live das Set nicht öffnet** (das Set wurde per Code erzeugt), geht es in einer Minute auch so:
neues Live-Set anlegen → Tempo **145** → alle Dateien aus `Samples/Stems/` markieren und gemeinsam auf Takt 1 in die Arrangement-Ansicht ziehen.
Mit gedrückter **Cmd/Strg**-Taste landen sie automatisch untereinander auf eigenen Spuren.
Die Stems laufen alle ab Takt 1, deshalb sitzt danach alles taktgenau.
Danach `midi/NACHTSTROM_ALL_PARTS.mid` hineinziehen. Das ergibt 5 MIDI-Spuren mit allen Noten.

**Nur anhören:** `bounce/NACHTSTROM_master.mp3`

## Spuren

| # | Spur | Sound |
|---|------|-------|
| 01 | KICK | 43,65 Hz (F1), Pitch-Env 270→44 Hz, Click, Sättigung |
| 02 | RUMBLE | Kick → 90 % Hall → LP 170 Hz → Distortion → Offbeat-Gate mit 16tel-Puls |
| 03 | BASS | Rolling 16tel zwischen den Kicks, Saw + Sub, Sidechain 75 % |
| 04 | CLAP | 4 Noise-Bursts, Room |
| 05 | HATS | metallische Hats, Shaker, Offbeat-Open, 10 % Swing, atmender Hochpass |
| 06 | RIDE | 8tel, nur im Peak und in Drop 3 |
| 07 | PERC | Tribal-Toms + Rim, Fills alle 8 Takte |
| 08 | HOOK | der Ohrwurm: Call/Response im 3-3-2-Rhythmus, Filterbogen, Ping-Pong 3/16 |
| 09 | ACID | 303-artig: Ladder-Filter, Accent, Slide, lange Sweeps |
| 10 | FM STABS | Spannungsakkorde Fm–Db–Eb–C; das C-Dur ist die Dominante, die in den Drop zieht |
| 11 | FX | Riser, Snare-Roll, Pitch-Riser, Impacts, Crashes |
| 12–16 | MIDI | Hook, Acid, Bass, Stabs, Drums. Ohne Instrument: eigene Synths drauflegen |

## Arrangement & Spannungsbögen

| Takt | Section | Was passiert |
|------|---------|--------------|
| 1–16 | INTRO | Kick + Rumble + Hats, DJ-freundlich |
| 17–32 | GROOVE | Rolling Bass, Toms, Shaker; der Hook kommt geschlossen als Teaser |
| 33–48 | BUILD | Clap, Hook-Filter öffnet sich von 500 Hz auf 4,2 kHz, Snare-Roll, **1 Beat Stille** |
| 49–80 | DROP 1 | voller Groove, ab Takt 65 steigt die Acid ein |
| 81–96 | BREAK | Kick raus, Hook im großen Hall, Akkorde Fm→Db→Eb→**C**, Roll von 4teln bis 32teln, Riser, Kick-Comeback mit HP-Filter, **Luftloch** |
| 97–128 | PEAK | Impact, Ride, FM-Stabs, ab 113 Hook-Variation B mit steigender Response |
| 129–136 | TENSION | Kick raus, Acid-Solo mit Sweep auf 5 kHz, Clap-Roll, Luftloch |
| 137–160 | DROP 3 | Finale: Hook oktaviert, Acid wellenförmig offen |
| 161–192 | OUTRO | Abbau Element für Element, ab 177 DJ-Tool |

## Master
Bounce: −10,5 LUFS integriert, True Peak −1 dBTP.

Die Stems haben Headroom (Summe ca. −1 dBFS). Für den Bounce-Sound kommen auf den Master **Glue Compressor** (2:1) und **Limiter** (Ceiling −1 dB).

## Neu rendern
```
pip install numpy numba scipy soundfile
cd src && python3 render.py && python3 export_midi.py && python3 build_als.py
```
Noten und Arrangement stehen in `src/compose.py`, die Sounds in `src/render.py`.
