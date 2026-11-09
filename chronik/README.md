# MIKKANER — EINE CHRONIK

Epische Chronik-Doku (41 s, 1920×1080, 30 fps) über die Entstehung des Tracks *Mikkaner*.
Alle Inhalte stammen aus `../mikkaner.als`: 130 BPM, 4/4, 156 Takte, neun Spuren,
die Clip-Positionen des Arrangements, das Violinen-Motiv aus der MIDI-Spur
(C · Es · B · As) und der Master bei -1,5 dB.

**Video:** [`out/mikkaner-chronik.mp4`](out/mikkaner-chronik.mp4)

## Aufbau

| Zeit | Szene |
| --- | --- |
| 0–5 s | Prolog: goldglühende Inschrift, Ring mit 156er-Skala, Flamme mit Funken |
| 5–35 s | 12 Meilensteine à 2,5 s, alle beginnend mit „UND DANN KAM …“: Kick, Clap, Bass, Harmonie, Violine, Refrain, Motiv, Aufbau, Drop, Stille, Form, Schliff |
| 35–41 s | Epilog: Inschrift, Eckdaten, Markenlinie |

Der HUD-Rahmen zeigt das Kapitel, den Projekttitel, den Taktzähler (bis 156), eine Zeitleiste
mit roter Fortschrittslinie und den Pegel in dBFS mit Mini-Skala (endet bei -1,5).

## Rendern

```bash
npm install
npm run render      # -> out/mikkaner-chronik.mp4
npm run stills      # -> out/stills/*.png (Kontrollbilder)
```

Voraussetzungen: Node, Playwright mit Chromium und ffmpeg. Zur Vorschau im Browser
`index.html` über einen lokalen Server öffnen; mit `?f=300` erscheint ein Einzelbild.

Alles ist deterministisch: Papier, Flecken und Strichzittern haben feste Startwerte, das
Filmkorn hat einen eigenen Startwert pro Bild. Farben und Markenfarbe (`BRAND`) stehen
oben in `scene.js`.
