# Musii Studio für Android

Videoschnitt-App für Android-Smartphones und -Tablets – **alle Funktionen frei, ohne Wasserzeichen, ohne Abo**.
Native Kotlin-App (Jetpack Compose + Media3 mit eigenen GPU-Shadern).

- Läuft ab **Android 8.0** (API 26)
- Vorschau und Export laufen hardwarebeschleunigt direkt auf dem Gerät

## Installation

1. Unter *Actions › Musii Studio (Android-App)* das Artefakt **MusiiStudio-Android-apk** laden
   (oder aus einem Release) und auf das Handy kopieren.
2. APK antippen → „Installation aus unbekannten Quellen“ für den Browser/Dateimanager erlauben → **Installieren**.

## Funktionen

| Bereich | Funktionen |
|---|---|
| Projekte | Startseite mit Vorschaubildern, automatisch speichern, umbenennen, duplizieren, löschen |
| Formate | 9:16, 16:9, 1:1, 4:5, 4:3, 3:4, 21:9 · 24–60 fps |
| Timeline | Mittiger Abspielkopf wie in mobilen Schnitt-Apps · Wischen zum Spulen · Zwei-Finger-Zoom · lange drücken zum Verschieben · Griffe zum Trimmen · Einrasten · Rückgängig/Wiederholen |
| Spuren | Hauptspur (magnetisch), Bild-in-Bild-, Text-, Sticker-, Effekt- und Audiospuren |
| Clip | Teilen, Duplizieren, Löschen, Tempo 0,1×–10× (Tonhöhe bleibt), Lautstärke bis 200 %, Ein-/Ausblenden, Ton trennen, Standbild |
| Bild | Position/Größe/Drehung per Fingergeste oder Regler, **Keyframes**, Deckkraft, Einpassen/Füllen, Spiegeln, Zuschneiden |
| Farbe | 24 Filter mit Stärke · 14 Regler (Helligkeit, Kontrast, Sättigung, Belichtung, Temperatur, Tint, Lichter, Schatten, Dynamik, Farbton, Schärfe, Vignette, Körnung, Verblassen) |
| Effekte | 30 Effekte als Ebene oder pro Clip (Glitch, VHS, Schnee, Regen, Funkeln, Lichteinfall, Kaleidoskop, Split-Screen, Alter Film, Wärmebild …) |
| Übergänge | 21 Übergänge (Überblenden, Schwarz-/Weißblende, Wischen, Schieben, Gleiten, Zoom, Kreis, Drehung, Pixel, Blitz, Glitch …) mit einstellbarer Dauer |
| Animation | 14 Ein-/Ausblend-Animationen + 9 Dauerschleifen für Clips, Texte und Sticker |
| Masken & Freistellen | Kreis, Rechteck, Linear, Spiegel, Herz · Greenscreen/Bluescreen (Chroma-Key) |
| Text | 16 Stilvorlagen, Schriften, Farbe, Kontur, Schatten/Leuchten, Hintergrundbox, Schreibmaschinen-Effekt |
| Sticker | 144 Emojis |
| Audio | Musik importieren, Sprachaufnahme (Voiceover), Text-zu-Sprache |
| Hintergrund | Farbe oder unscharfer Hintergrund |
| Export | MP4 · H.264 oder HEVC · 480p bis 4K · bis 60 fps · 4 Qualitätsstufen · speichert in der Galerie (Filme › Musii Studio) · Teilen |

## Selbst bauen

```bash
cd MusiiAndroid
./gradlew assembleRelease      # app/build/outputs/apk/release/app-release.apk
```

Benötigt JDK 17 und das Android SDK (Plattform 35). Der Workflow `.github/workflows/musii-android.yml`
baut die App, startet einen Android-Emulator und prüft dort Import, Export (16:9, 9:16, alle Übergänge
und Effekte) und die Oberfläche.
