# MöbelFit

**Dein Wohnzimmer ist dein Gym.** Eine Fitness-App, die aus sechs Fotos einer Wohnung entstanden ist:
Stühle, Sofa, Küchenzeile, Wand, Geschirrtuch, Kissen und das Equipment vom Boden (Kurzhantel,
Widerstandsbänder, Liegestützgriffe, Springseil) werden zu Trainingsgeräten.

## Was drin ist

| Bereich | Inhalt |
| --- | --- |
| **Videos** | 7 Video-Workouts mit animiertem Vorturner, Timer-Ring, Pausen, Rundenanzeige, Sprachansage (Deutsch) und Pieptönen |
| **Übungen** | 27 Übungen, filterbar nach Möbelstück/Gerät, jede mit Animation, Schritt-für-Schritt-Anleitung und Sicherheitstipp |
| **Dart** | Dart-Roulette: Pfeile auf die echte Scheibe werfen, Treffer antippen, Zahl = Wiederholungen (Double ×2, Triple ×3) |
| **Advent** | Fit-Adventskalender: ab 1. Dezember jeden Tag eine Tür, am Wochenende ganze Workouts |
| **Start** | Tagesvorschlag, Wochenstatistik, Serie und das „Gym-Inventar“ |

### Die Workouts

| Video | Dauer | Geräte |
| --- | --- | --- |
| Stuhl-Zirkel | 18 Min | Stuhl, Wand, Kurzhantel |
| Küchen-Kraft | 18 Min | Küchenzeile, Kurzhantel, Wand |
| Sofa, Po & Beine | 19 Min | Sofa, Kissen, Handtuch, Kurzhantel |
| Wohnzimmer-HIIT | 17 Min | Springseil, Handtuch, Boden |
| Band & Hantel | 20 Min | Bänder mit Türanker, Kurzhantel, Liegestützgriffe |
| 7 Minuten Feierabend | 8 Min | einmal quer durch die Wohnung |
| Erster Schritt | 11 Min | Wand, Stuhl, Kissen (Einsteiger) |

Die fertigen MP4-Videos (720×1280, Hochformat, mit Beat und Countdown-Tönen) liegen in [`videos/`](videos/),
plus `bibliothek.mp4` mit allen 27 Übungen nacheinander.

## Benutzen

`index.html` im Browser öffnen, fertig. Die Datei ist eigenständig (alles inline, nur die Schriften kommen
von Google Fonts). Auf dem Handy: „Zum Home-Bildschirm hinzufügen“. Fortschritt wird im Browser gespeichert.

Die Fotos der Wohnung sind bewusst **nicht** im (öffentlichen) Repository; ohne sie zeigt die App Icons.
Mit Fotos bauen: `python3 build.py --photos <ordner-mit-webp>`.

## Entwickeln

```
src/figure.js   Strichfigur, Gelenk-Kinematik (2-Knochen-IK), Möbel als SVG-Requisiten
src/data.js     Inventar, 27 Übungen mit Keyframes, Workouts, Adventskalender, Dart-Belegung
src/app.js      Ansichten, Video-Player, Sprachansage, Dart-Scheibe, Speicher
src/styles.css  Design (Dartscheiben-Palette, Big Shoulders Display + DM Sans)
build.py        baut index.html
tools/render.js rendert ein Workout als MP4 (Playwright + ffmpeg), tools/audio.py macht die Tonspur
```

Videos neu rendern: `./tools/render-all.sh` (braucht Node mit Playwright, ffmpeg, Python mit numpy).

Eine neue Übung ist ein Eintrag in `EXERCISES` mit zwei oder mehr Posen: Hüfte, Oberkörperwinkel,
Fuß- und Handpositionen. Knie und Ellbogen rechnet die Kinematik selbst aus.

**Sicherheit:** Glastisch nie belasten, Stühle mit der Lehne an die Wand, bei Schmerzen abbrechen.
Die App ersetzt keine ärztliche Beratung.
