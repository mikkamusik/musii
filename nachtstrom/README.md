# NACHTSTROM v6 – 147 BPM · Cis-Phrygisch · minimal

Gebaut nach dem vermessenen Bauplan deiner Referenz, die Details stehen in `REFERENZ_ANALYSE.md`.
v6 ist bewusst minimal: wenige Elemente, jedes mit einer klaren Rolle, kein Durcheinander.
Sounds, Noten und Patterns sind eigen und selbst synthetisiert.

## In Ableton öffnen
1. `NACHTSTROM_v6.zip` aus dem Chat im Ordner **Downloads** doppelklicken. Es entsteht `Downloads/NACHTSTROM_v6/`.
2. `NACHTSTROM_v6/NACHTSTROM.als` öffnen.
3. Falls „Sample Offline“ erscheint: rechts **Ordner wählen** → `NACHTSTROM_v6` → **Los** → **Sichern**, dann **Cmd+S**.
4. A/B-Vergleich: **00 REFERENZ** und **00 MASTER BOUNCE** abwechselnd solo hören.

## Die Elemente
| Rolle | Element |
|---|---|
| Fundament | Kick (tief und rund, per Fit an die Referenz) + Offbeat-Bass (fast reiner Sinus) |
| Groove | Offbeat-Hat (kurz → mittel → offen), leiser Tick auf der 2. 16tel, Clap auf 2 & 4 |
| Hypnose | **eine** Wand: 3× Grundton + 1× b2 (Main 2 und Peak B: Tritonus), Puls auf dem Offbeat, Filter öffnet über 16 Takte |
| Farbe | ein Rim (2 Schläge pro Takt) nur in Main 1B, Main 2 und Peak |
| Breaks | Drone, die im Aufbau steigt |
| FX | Reverse-Crash vor neuen Phrasen, Crash an den beiden Drops, Downlifter am Break-Anfang, ein weicher Riser vor dem zweiten Drop |

Rausgeflogen sind Stab, Wide-Textur, Toms, Congas, Fills, Zaps, Whooshes, Delay-Throws, Tape-Stopps und Stutter. Der Mix hat deutlich weniger Hall.

## Aufbau
| Takte | Teil | Was passiert |
|---|---|---|
| 1–16 | Intro | Kick, Bass, kurzer Offbeat-Hat |
| 17–32 | Groove | + Clap, + Tick |
| 33–40 | Drive | + Wand (Filter öffnet sich) |
| 41–48 | Break 1 | Kick und Bass raus, Drone steigt, Pickup-Kick |
| 49–64 | Main 1 | alles Kern-Elemente; Takt 64 Kick-Stopp |
| 65–78 | Main 1B | + Rim |
| 79–80 | Stopp | Kick weg, Wand liegt frei |
| 81–96 | Main 2 | Wand mit Tritonus |
| 97–114 | Breakdown | Kick-Stottern, Drone, Aufbau mit 8tel-Hats, kurzem Kick-Roll und Riser, Höhen-Loch |
| 115–146 | Peak | offener Hat, Wand am hellsten; Stopps 122, 130, 146 |
| 147–162 | Main 3 | ohne Rim |
| 163–178 | Outro | ohne Wand; Kick, Bass und Hats bis zum Ende |

## Neu rendern
```
pip install numpy numba scipy soundfile pyloudnorm
cd src && python3 render.py /pfad/zur/referenz.mp3 && python3 export_midi.py && python3 build_als.py
```
