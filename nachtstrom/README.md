# NACHTSTROM v2 – 145 BPM · F-Phrygisch · raw / hypnotic / trippy

Hypnotic Groove Techno, angelehnt an Alarico, Chlär und Janamasté. Alle Sounds sind selbst synthetisiert: keine Samples, keine Presets, kein Acid.
Bewusst nicht enthalten sind EDM-Elemente wie Snare-Rolls, Riser, Impacts, Crashes, Akkordfolgen, ein Melodie-Hook oder Stille vor dem Drop.

## Öffnen
1. `NACHTSTROM_v2.zip` aus dem Chat in **Downloads** entpacken. Es entsteht `Downloads/NACHTSTROM_v2/`.
2. `NACHTSTROM.als` doppelklicken.
3. Falls „Sample Offline“ erscheint: rechts **Ordner wählen** → Ordner `NACHTSTROM_v2` → **Los** → **Sichern**, dann mit **Cmd+S** speichern.

Nur anhören: `bounce/NACHTSTROM_master.mp3`

## Wie der Track lebt (statt Monotonie)
- **Groove:** 16tel mit ca. 56 % Shuffle, euklidische Tribal-Percussion (Toms, Congas, Rims), die alle 8 Takte rotiert, Ghost-Notes und Mikro-Timing.
- **Polymetrik:** Die Hypno-Sequenz läuft in 7/16 gegen 4/4, in MAIN 1B und MAIN 2B in 5/16. Die metallische Perc läuft in 3/16, die Shaker in Triolen.
- **Mutation:** Die Sequenz ändert alle 8 Takte einen Ton, im Finale alle 4 Takte. Bass- und Rumble-Patterns wechseln alle 8 Takte.
- **Trippy:** Tape-Delay mit Wow (Echos eiern in der Tonhöhe), Phaser, Auto-Pan, Formant-Stimme (a-o-i-u-e) und Filter-LFOs mit 13, 19, 23, 29 und 37 Beats, also nie taktgleich.
- **Low End:** runde, verzerrte Kick, rollendes Rumble und ein warmer, dreckiger Bass mit geschlossenem Filter und Röhren-Sättigung.

## Arrangement
| Takt | Teil | Was passiert |
|---|---|---|
| 1–16 | INTRO | Kick, Rumble, Rims im Dub-Delay; ab 9 die Sequenz, noch zu |
| 17–32 | GROOVE | Dirty Bass, Hats, Toms; die Stimme blitzt auf |
| 33–48 | DRIVE | Clap mit Raum, 3/16-Metall, Sequenz öffnet sich |
| 49–64 | MAIN 1 | volle Hypnose, Congas |
| 65–80 | MAIN 1B | Sequenz in 5/16, Rumble galoppiert, Voice-Chops, Phaser |
| 81–92 | TRIP | Kick und Bass raus, Sequenz im eiernden Delay, Chant, Rausch-Nebel |
| 93–96 | RETURN | die Kick kommt gefiltert zurück |
| 97–112 | MAIN 2 | alles plus Ride |
| 113–128 | MAIN 2B | 5/16 mit Oktaven, Shaker-Triolen |
| 129–136 | TRIP 2 | nur Sequenz, Metall, Stimme |
| 137–160 | FINAL | Mutationen alle 4 Takte |
| 161–192 | OUTRO / DJ TOOL | Abbau; am Ende Kick, Rumble, Hats und Perc |

Master: −9,4 LUFS, True Peak −1 dBTP. Die Stems haben Headroom; für den Bounce-Sound gehören Glue Compressor und Limiter auf den Master.

## Neu rendern
```
pip install numpy numba scipy soundfile
cd src && python3 render.py && python3 export_midi.py && python3 build_als.py
```
