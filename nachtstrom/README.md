# NACHTSTROM v7 – 147 BPM · Cis-Phrygisch · schlanker Kern + Abwechslung + Highlights

Gebaut nach dem vermessenen Bauplan deiner Referenz, die Details stehen in `REFERENZ_ANALYSE.md`.
Der Groove bleibt schlank wie in v6, also kein Durcheinander. Neu sind Abwechslung alle 8 Takte und gezielt gesetzte Highlights.
Sounds, Noten und Patterns sind eigen und selbst synthetisiert.

## In Ableton öffnen
1. `NACHTSTROM_v7.zip` aus dem Chat im Ordner **Downloads** doppelklicken. Es entsteht `Downloads/NACHTSTROM_v7/`.
2. `NACHTSTROM_v7/NACHTSTROM.als` öffnen.
3. Falls „Sample Offline“ erscheint: rechts **Ordner wählen** → `NACHTSTROM_v7` → **Los** → **Sichern**, dann **Cmd+S**.
4. A/B-Vergleich: **00 REFERENZ** und **00 MASTER BOUNCE** abwechselnd solo hören.

## Highlights (Takt-Nummern wie in Ableton)
| Takt | Highlight |
|---|---|
| 16 | **Filter-Dive**: der ganze Groove taucht ab, mit Reverse-Crash und Crash in den Groove, der Clap kommt |
| 25 | erster **Dub-Stab** mit langem Echo als Teaser |
| 41 | **Tape-Stopp** in Break 1, Downlifter, Drone steigt |
| 48 → 49 | Reverse-Crash, Pickup-Kick, dann **Drop mit Sub-Drop und Crash** |
| 56 | **Stutter-Fill** |
| 64 → 65 | Kick-Stopp mit **Echo-Throw der Wand**, dann ein **Ping** mit langem Raum, der Rim kommt |
| 73–78 | die Hats öffnen sich auf 16tel |
| 79–80 | Stopp: **Solo der Wand mit Resonanz-Sweep** nach oben, dann ein Crash |
| 81–96 | Wand mit Tritonus, Bass mit **Oktav-Sprüngen** |
| 96 | **Hochpass-Fahrt** und Echo-Throw in den Breakdown |
| 97–114 | Kick-Stottern, dann **lange Wand-Töne im großen Raum** mit Dub-Stabs, Aufbau mit 8tel-Hats, kurzem Roll und Riser, Höhen-Loch und **Beat-Cut** |
| 115 | **großer Drop** mit Sub-Drop und Crash, Ride, offene Hats, Wand mit Oktav-Sprung |
| 122 | Echo-Throw |
| 123–129 | 16tel-Hats |
| 126 | Stutter-Fill |
| 130 | Stopp: **Solo der Wand mit Resonanz-Sweep**, Ping |
| 131–146 | **Dub-Stabs** alle 2 Takte, Bass mit Oktav-Sprüngen |
| 146 | Reverse-Crash und Crash |
| 162 | Echo-Throw und letzter Dub-Stab ins Outro |

## Abwechslung im Kern (alle 8 Takte genau eine Änderung)
- **Wand** in vier Varianten: A (Grundton/b2), B (Tritonus), C (Oktav-Sprung), D (lange Töne).
- **Hats:** kurz → mittel → offen, 16tel-Öffnungen, Ride im Peak.
- **Rim:** zwei Schläge pro Takt, im Peak vier.
- **Bass:** Oktav-Sprünge in Main 2 und Peak B.

## Neu rendern
```
pip install numpy numba scipy soundfile pyloudnorm
cd src && python3 render.py /pfad/zur/referenz.mp3 && python3 export_midi.py && python3 build_als.py
```
