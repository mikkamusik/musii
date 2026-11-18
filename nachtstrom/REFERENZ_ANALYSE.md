# Referenz-Analyse → Bauplan für NACHTSTROM (v3/v4)

Referenz: „CANT STOP ME WHILE IM BREATHING“, vom Nutzer bereitgestellt.
Die Audiodatei selbst liegt nicht im Repo. Gemessen wurden nur Kennwerte, kein Audio und keine Melodie wurde übernommen.

## Messwerte
| Kennwert | Referenz | NACHTSTROM v3 |
|---|---|---|
| Tempo | **147,00 BPM** (Comb-Analyse, eindeutig) | 147 BPM |
| Länge | 178 Takte (4:54) | 178 Takte |
| Lautheit | −6,4 LUFS, True Peak +0,9 dBTP (geclippt) | −7,5 LUFS, −0,2 dBTP |
| Kick | Pitch-Sweep ~230→54 Hz in ~150 ms, Sub-Fahne bis ½ Beat | Sweep →52 Hz (G#1) |
| Bass | Offbeat (0,5–0,95 Beat), konstant eine **Quarte über dem Kick-Ton** | C#2 über G#1-Kick, gleiche Quarte |
| Groove | Hat auf **jedem Offbeat**, Clap auf **2 & 4** | gleiches Raster |
| Stereo | Sub/Bass mono (Side −28/−15 dB), Mitten sehr breit (−3…−6 dB) | Bass-Mono < 150 Hz, Mitten breit |
| Balance Main | Low (60–150 Hz) ist das lauteste Band | per Match-EQ angeglichen (meist ≤ 1,5 dB) |

## Arrangement-System (beat-genau gemessen)
| Takte | Teil | System |
|---|---|---|
| 1–8 | Intro | Kick + Bass mono, leise Offbeat-Hats |
| 9–16 | Layer | Stereo-Feld öffnet sich |
| 17–32 | Groove | Hats lauter, Clap 2 & 4, Akzent alle 4 Takte |
| 33–40 | Drive | neues Element ab Takt 33 |
| 41–48 | Break | Kick weg nach Beat 2, einzelne Kick-Hits (44, 45, 48), Höhen in 47–48 raus |
| 49–64 | Main 1 | Mitten dichter; Takt 64: Kick-Stopp auf Beat 4 |
| 65–78 | Main 1B | heller (Top-Layer) |
| 79–80 | Stopp | 2 Takte, Kick nur 79/1–2 und 80/3–4, maximale Breite |
| 81–96 | Main 2 | deutlich breiter |
| 97–114 | Breakdown | Kick-Stottern 97–104, dann nur Mitten + tiefe Einzel-Hits |
| 115–130 | Peak | hellster Teil; Takt 122 Beat 3 raus, Takt 130 Stopp nach Beat 2 |
| 131–146 | Peak B | Takt 146 Stopp nach Beat 2 |
| 147–162 | Main 3 | etwas weniger Höhen |
| 163–178 | Outro | Höhen und Breite nehmen ab, Kick bis zum Ende |

**Regel:** Jede Änderung sitzt auf einer 4-, 8- oder 16-Takt-Grenze. Es gibt nichts Zufälliges.

## Tiefenanalyse für v4
- **Kick:** Der Sweep startet bei etwa 300 Hz. Bei 30 ms liegt er um 150–200 Hz, bei 60 ms um 100 Hz, ab etwa 100 ms sitzt er auf 52–55 Hz. Die Obertöne kommen aus Verzerrung (2. Teilton etwa −20 dB).
- **Mitten:** Im Seitensignal liegt eine verzerrte, chromatische Synth-„Wand“ (Chroma verteilt über F, A, A#, B, F#, G#). Sie springt im Beat-Raster in Halbtonstufen und liegt zwischen 150 und 400 Hz. Ein Melodie-Hook ist das nicht.
- **Stopps:** Kick und Sub fallen weg, oft gehen auch die Höhen weg (Tiefpass). Die Wand liegt dann frei.
- **Break 1:** Drone mit Teiltönen, Hats nur bis Takt 46, einzelne Kick-Hits (44/4, 45/1–2) und eine Pickup-Kick auf 48/4.
- **Breakdown:** Kick-Stottern 97–104, danach Drone und Rauschen. In den Takten 107 und 113 kommen rhythmische Hits, auf Takt 114 ein Höhen-Loch, dann der Drop.
- **Dynamik:** Die Breaks liegen etwa 12–14 dB unter den Mains (LRA 7,3 LU). Diesen Kontrast macht v4 bewusst nach: Erst wird es leise, dann folgt ein Crescendo bis zum Drop.
