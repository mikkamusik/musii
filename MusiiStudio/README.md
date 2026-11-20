# Musii Studio – Videoschnitt für den Mac

Native macOS-App (Swift, SwiftUI, AVFoundation, Core Image) für Videoschnitt im Stil
mobiler Schnitt-Apps – **alle Funktionen frei, ohne Wasserzeichen, ohne Abo, ohne Konto**.

- Läuft ab **macOS 12 Monterey** (getestet für 12.7.6) und neuer
- **Universal-App**: Intel-Macs und Apple Silicon (M1 – M4)
- Alles läuft lokal auf dem Mac, keine Cloud

## Installation

1. Unter **Releases** (oder Actions › Artefakt `MusiiStudio-dmg`) die Datei `MusiiStudio.dmg` laden.
2. DMG öffnen, **Musii Studio** in den Ordner **Programme** ziehen.
3. Beim ersten Start: **Rechtsklick › Öffnen › Öffnen** (die App ist nicht bei Apple notariell beglaubigt).
   Falls nötig: *Systemeinstellungen › Sicherheit › „Dennoch öffnen“*.

## Funktionen

| Bereich | Funktionen |
|---|---|
| Projekte | Projektübersicht mit Vorschaubildern, automatisch speichern, umbenennen, duplizieren, als Datei sichern/importieren |
| Formate | 16:9, 9:16 (TikTok/Reels/Shorts), 1:1, 4:5, 4:3, 3:4, 21:9, 2:1 · 24/25/30/50/60 fps |
| Timeline | Hauptspur (magnetisch), beliebig viele Bild-in-Bild-, Text-, Sticker-, Effekt- und Audiospuren · Ziehen, Trimmen, Teilen, Duplizieren, Löschen · Einrasten · Zoom · Filmstreifen & Wellenformen · Rückgängig/Wiederholen |
| Clip | Position, Größe, Drehung, Deckkraft, Spiegeln, Zuschneiden, Einpassen/Füllen, **Keyframes**, Mischmodi (12) |
| Tempo | 0,1× – 10× mit Tonhöhenkorrektur · **Rückwärts** · **Standbild** |
| Animation | 14 Ein-/Ausblend-Animationen + 9 Dauerschleifen (Ken Burns, Pulsieren, Wackeln …) für Clips, Texte und Sticker |
| Farbe | 28 Filter mit Stärke · 14 Regler (Helligkeit, Kontrast, Sättigung, Belichtung, Temperatur, Tint, Lichter, Schatten, Dynamik, Farbton, Schärfe, Vignette, Körnung, Verblassen) |
| Effekte | 32 Effekte als Ebene oder pro Clip (Glitch, VHS, Schnee, Regen, Funkeln, Lichteinfall, Kaleidoskop, Split-Screen, Alter Film …) |
| Übergänge | 28 Übergänge mit einstellbarer Dauer, automatische Ton-Überblendung |
| Masken | Kreis, Rechteck, Linear, Spiegel, Herz – mit weicher Kante, Drehung, Umkehren |
| Freistellen | **KI-Hintergrundentfernung** (Personen) · Chroma-Key (Greenscreen/Bluescreen) |
| Text | 16 Stilvorlagen, alle Systemschriften, Kontur, Schatten/Leuchten, Hintergrundbox, Abstände, Schreibmaschinen-Effekt |
| Sticker | 128 Emojis, 40 Symbole, eigene PNGs als Überlagerung |
| Audio | Musik importieren, Lautstärke, Ein-/Ausblenden, Ton vom Video trennen, **Voiceover-Aufnahme**, **Text-zu-Sprache** |
| Untertitel | **Automatische Untertitel** per Spracherkennung (12 Sprachen), Stil für alle ändern |
| Hintergrund | Farbe oder unscharfer Hintergrund |
| Export | MP4 / MOV · H.264, HEVC, ProRes 422 · 480p bis **4K** · bis 60 fps · 4 Qualitätsstufen · GIF · nur Audio (M4A) · Einzelbild (PNG) |

## Tastenkürzel

| Taste | Aktion |
|---|---|
| Leertaste | Abspielen / Pause |
| ← / → (⇧ für 10 Bilder) | Bildweise springen |
| ⌘B oder S | Am Abspielkopf teilen |
| ⌫ | Auswahl löschen |
| ⌘D | Duplizieren |
| ⌘Z / ⇧⌘Z | Rückgängig / Wiederholen |
| ⌥K | Keyframe setzen/entfernen |
| ⌘I | Medien importieren |
| ⌘E | Exportieren |
| ⌘+ / ⌘- / ⌘0 | Timeline zoomen / ganzes Projekt |
| J / K / L | 1 s zurück / Pause / Abspielen |

## Selbst bauen

Auf einem Mac mit Xcode 15 oder neuer:

```bash
cd MusiiStudio
./scripts/build-app.sh          # erzeugt build/Musii Studio.app und build/MusiiStudio.dmg
"build/Musii Studio.app/Contents/MacOS/MusiiStudio" --selftest /tmp/musii-test   # Engine-Selbsttest
```

Der GitHub-Workflow `.github/workflows/musii-studio.yml` baut die App bei jedem Push auf einem
macOS-Runner, führt den Selbsttest aus (Import, alle Filter/Effekte/Übergänge, Export in allen
Formaten, Rückwärts, Standbild …) und lädt das DMG als Artefakt hoch.

## Aufbau

```
Sources/MusiiStudio/
  App/      Start, Menüs, Tastatur, Selbsttest
  Model/    Projekt-Datenmodell, Editor-Logik (Undo, Schneiden …), Speicherung
  Engine/   Komposition (AVFoundation), Frame-Renderer (Core Image), Filter/Effekte/Übergänge,
            Text-Rendering, Export, Rückwärts/Standbild, Untertitel, Sprachausgabe, Aufnahme
  UI/       Startseite, Editor, Vorschau, Timeline, Bibliothek, Eigenschaften, Export
```
