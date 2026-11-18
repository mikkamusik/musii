# NACHTSTROM v4 – 147 BPM · Cis-Phrygisch · Referenz-Sound + Spannungsbögen

Gebaut nach dem vermessenen Bauplan deiner Referenz, die Details stehen in `REFERENZ_ANALYSE.md`.
Neu in v4: eine Kick wie in der Referenz, eine verzerrte Stereo-Wand in den Mitten, ein komplettes FX-System und zwei große Spannungsbögen.
Sounds, Noten und Patterns sind eigen und selbst synthetisiert.

## In Ableton öffnen
1. `NACHTSTROM_v4.zip` aus dem Chat im Ordner **Downloads** doppelklicken. Es entsteht `Downloads/NACHTSTROM_v4/`.
2. `NACHTSTROM_v4/NACHTSTROM.als` öffnen.
3. Falls „Sample Offline“ erscheint: rechts **Ordner wählen** → `NACHTSTROM_v4` → **Los** → **Sichern**, dann **Cmd+S**.
4. A/B-Vergleich: Spur **00 REFERENZ** einschalten und im Wechsel mit **00 MASTER BOUNCE** solo hören.

## Spannungsbögen
**Break 1 (Takte 41–49)**
1. Tape-Stopp im Groove, Kick und Bass weg, Drone und lange Stabs im Raum.
2. Einzelne Kick-Hits als Teaser, dazu Zaps.
3. Aufbau ab Takt 45:
   - Industrial-Riser mit Gate, das von 16teln auf 32tel beschleunigt.
   - Drone steigt um 5 Halbtöne.
   - Kick-Roll 8tel → 16tel → 32tel, der lauter und dünner wird.
   - Crescendo.
4. Eine volle Pickup-Kick, Reverse-Crash, dann der Drop mit Impact.

**Breakdown (Takte 97–114)**
1. Kick-Stottern mit Dub-Delay, die Wand schließt den Filter.
2. Leiser, dunkler Drone-Teil mit tiefen Booms.
3. Aufbau ab Takt 111:
   - Kick-Roll Viertel → 8tel → 16tel → 32tel.
   - Hat-Roll.
   - Riser, Drone +12 Halbtöne, Crescendo.
4. Höhen-Loch, Reverse-Crash, dann der Drop mit Impact.

**Stopps** (Takte 64, 79–80, 122, 130, 146): Tape-Stopp oder Filter-Loch mit Wash, danach liegt die Wand frei, wie in der Referenz.

## Keine langweiligen Passagen
- **FX-Akzente:** Alle 4 Takte kommt ein anderer – Zap, Whoosh, Delay-Throw oder Reverse-Crash. Vor jeder 16er-Phrase kommt immer der große.
- **Stutter-Edits:** in den Takten 24, 60, 92 und 138.
- **Hochpass-Fahrten:** in den Takten 32 und 96.
- **Tom-Fills:** am Ende jeder 8er-Phrase.
- **Filter:** Wand und Stab öffnen sich über jeweils 16 Takte.
- **Wand:** Ihr 6-Beat-Zyklus läuft gegen den 4/4-Takt und verschiebt sich ständig.

## Spuren
| Spur | Inhalt |
|---|---|
| 00 REFERENZ / 00 MASTER BOUNCE | zum A/B-Vergleich, standardmäßig aus |
| 01–12 | Kick, Rumble, Bass, Hats, Clap, Perc, Wall, Stab, Atmos, FX, Riser, Wide |
| 13–16 | MIDI: Wall, Stab, Bass, Drums (inklusive Kick-Rolls) |

Die Stems ergeben in der Summe den Mix vor dem Master.
Für den Bounce-Sound kommen auf die Master-Spur **Glue Compressor** (2:1) und **Limiter** (−0,3 dB).

## Neu rendern
```
pip install numpy numba scipy soundfile pyloudnorm
cd src && python3 render.py /pfad/zur/referenz.mp3 && python3 export_midi.py && python3 build_als.py
```
