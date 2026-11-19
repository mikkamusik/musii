# NACHTSTROM v11 – 147 BPM · Cis · ein durchgehender Track mit dreckigem Sub

Gebaut nach dem vermessenen Bauplan deiner Referenz, die Details stehen in `REFERENZ_ANALYSE.md`.

Neu in v11, nicht mehr progressiv und nicht mehr „wie 3 Tracks gleichzeitig“:
- **Ein Grundton (Cis)** für den ganzen Track, ohne Tonartwechsel.
- **Ein Bass:** ein dreckiger Offbeat-Sub. Sinus-Sub mit Saw-Anteil, Sättigung und einem parallelen Grit-Layer zwischen 100 und 900 Hz. Dazu ein lauteres, raueres Rumble. Den Low-End-Bereich lässt der Match-EQ bewusst in Ruhe.
- **Ein Riff** für den ganzen Track, mit einer Antwort alle 4 Takte. Der Filter öffnet sich über jeweils 16 Takte.
- **Eine Percussion-Familie:** Toms und Rim. Im Peak wird sie nur dichter, durch Congas und Ride.
- **Was raus ist:** Metall-Loop, Shaker, Stab-Hook und die wechselnden Bassmuster.
- **Abwechslung** entsteht nur noch über die Dramaturgie: Elemente kommen und gehen, Filter, der Fill alle 8 Takte, Highlights und Breaks.
- **Vocals:** auf **Spanisch** („Corriente nocturna“, „Más profundo“, „Déjate caer“, „Sigue“). Die Plätze im Arrangement stehen, die Shots kommen von ElevenLabs. Die alten deutschen Shots liegen in `Samples/Vocals/alt_deutsch/`.

## In Ableton öffnen
1. `NACHTSTROM_v11.zip` aus dem Chat im Ordner **Downloads** doppelklicken. Es entsteht `Downloads/NACHTSTROM_v11/`.
2. `NACHTSTROM_v11/NACHTSTROM.als` öffnen.
3. Falls „Sample Offline“ erscheint: rechts **Ordner wählen** → `NACHTSTROM_v11` → **Los** → **Sichern**, dann **Cmd+S**.
4. A/B-Vergleich: **00 REFERENZ** und **00 MASTER BOUNCE** abwechselnd solo hören.

## Highlights (Takt-Nummern wie in Ableton)
| Takt | Highlight |
|---|---|
| 16 | Filter-Dive in den Groove, Crash, der Clap kommt |
| 25 | Dub-Stab mit langem Echo als Teaser |
| 41–48 | Break 1: Tape-Stopp, Toms in Halbtempo im großen Raum, Drone, Tom-Roll als Aufbau, Pickup-Kick |
| 49 | Drop mit Sub-Drop und Crash |
| 56, 126 | Stutter-Fills |
| 64 → 65 | Kick-Stopp mit Echo-Throw, Ping |
| 79–80 | Stopp: Riff-Solo mit Resonanz-Sweep |
| 96 | Hochpass-Fahrt in den Breakdown |
| 97–114 | Breakdown: Kick-Stottern, lange Töne, Dub-Echos; Aufbau mit Riser, Kick-Roll, Höhen-Loch und Beat-Cut |
| 115 | großer Drop mit Sub-Drop, Crash, Ride, offene Hats |
| 130 | Stopp: Riff-Solo mit Resonanz-Sweep, Ping |
| 131–146 | Dub-Stabs alle 2 Takte |
| alle 8 Takte | ein Fill im Wechsel: Tom-Fill, ausgelassene Kick, Hat-Roll, Reverse-Becken |

## Vocal-Shots (Spanisch)
| Takt | Shot |
|---|---|
| 29 | „Corriente nocturna“ (geflüstert) |
| 45 | „Más profundo“ in Break 1 |
| 80 | „Sigue“ im Stopp |
| 106 | „Déjate caer“ (geflüstert) im Breakdown |
| 114 → 115 | „Más profundo“ über das Höhen-Loch und den Beat-Cut in den Drop |
| 130 | „Sigue“ im Stopp |
| 138, 142 | „Corr…“-Chop als Call |
| 167 | „Corriente nocturna“ im Outro |

## Neu rendern
```
pip install numpy numba scipy soundfile pyloudnorm
cd src && python3 render.py /pfad/zur/referenz.mp3 && python3 export_midi.py && python3 build_als.py
```
