# NACHTSTROM v3 – 147 BPM · Cis-Phrygisch · gebaut nach Referenz

Der Track folgt dem vermessenen Bauplan deiner Referenz, die Details stehen in `REFERENZ_ANALYSE.md`.
Übernommen sind Tempo, Kick-Bass-Verhältnis, Groove-Raster, Arrangement-System, Stereo-Bild, Klangbalance und Lautheit.
Sounds, Noten und Patterns sind eigen und selbst synthetisiert.

## In Ableton öffnen
1. `NACHTSTROM_v3.zip` aus dem Chat im Ordner **Downloads** doppelklicken. Es entsteht `Downloads/NACHTSTROM_v3/`.
2. `NACHTSTROM_v3/NACHTSTROM.als` öffnen.
3. Falls „Sample Offline“ erscheint: rechts **Ordner wählen** → `NACHTSTROM_v3` → **Los** → **Sichern**, dann **Cmd+S**.

## Spuren
| Spur | Inhalt |
|---|---|
| 00 REFERENZ (A/B) | deine Referenz, taktgenau auf 147 BPM; **aus**, zum Vergleichen einschalten |
| 00 MASTER BOUNCE | fertiger Master; **aus** |
| 01–10 | Stems: Kick, Rumble, Bass, Hats, Clap, Perc, Stab, Atmos, FX, Wide |
| 11–13 | MIDI: Stab, Bass, Drums (für eigene Synths und Drum Rack) |

Tipp für den A/B-Vergleich: 00 REFERENZ einschalten und solo hören, dann 00 MASTER BOUNCE solo.
Die Stems ergeben in der Summe den Mix vor dem Master.
Für den Bounce-Sound kommen auf die Master-Spur **Glue Compressor** (2:1) und **Limiter** (Ceiling −0,3 dB, ca. 8 dB Gain).

## Das System
- **Kick und Bass:** 4/4-Kick, auf jedem Offbeat ein dreckiger Bass eine Quarte über dem Kick-Ton. Am Ende jeder 8er-Phrase geht der Bass einen Halbton hoch (b2).
- **Hats und Clap:** Hat auf jedem Offbeat, Clap auf 2 und 4, 16tel ab Takt 17, ein Top-Layer in den hellen Teilen.
- **Stab:** Variante A, B oder C (3/16) je nach Phrase. Im 8. Takt jeder Phrase kommt die Antwort, über jeweils 16 Takte öffnet sich das Filter.
- **FX:** ein Sweep alle 4 Takte, ein Swell vor jeder 8er-Phrase, ein Wash bei jedem Kick-Stopp.
- **Übergänge:** Kick-Stopps an denselben Stellen wie in der Referenz (Takte 64, 79–80, 122, 130, 146).

## Neu rendern
```
pip install numpy numba scipy soundfile pyloudnorm
cd src && python3 render.py /pfad/zur/referenz.mp3 && python3 export_midi.py && python3 build_als.py
```
