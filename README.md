# Musii – mobile DAW für Android

Musii ist eine eigenständige Musikproduktions-App für Android im Stil einer Live-DAW:
Clips in der **Session-Ansicht** live starten, im **Arrangement** zu einem Song anordnen,
mit **Synth**, **Drum-Kit** und **Audio-Spuren** produzieren und das Ergebnis als **WAV** exportieren.
Bestehende Projekte im `.als`-Format lassen sich importieren.

## Installieren

1. `releases/Musii-1.1.apk` auf das Android-Gerät laden (Android 8.0 oder neuer).
2. Öffnen und „Installation aus unbekannten Quellen“ für den Browser/Dateimanager erlauben.
3. Musii starten – beim ersten Start wird ein Demo-Song geladen.

## Funktionen

| Bereich | Was geht |
|---|---|
| **Session** | Clip-Raster mit Szenen, Launch-Quantisierung (aus, 1/4, 1 Takt, 2 Takte), Szenen starten, Spuren/alle stoppen, Clips duplizieren/kopieren/einfügen |
| **Arrangement** | Zeitleiste mit Takt-Lineal, Markern, Loop-Bereich (unten im Lineal ziehen), Clips verschieben (auch zwischen Spuren), Länge ziehen, teilen, duplizieren, Zoom, „Zurück zum Arrangement“ |
| **Clip-Editor** | Piano Roll (ein Finger zeichnet/verschiebt, zwei Finger scrollen, Tippen löscht, rechter Rand = Länge), Step-Sequencer für Drums (lang drücken = Velocity), Quantisieren, Transponieren, Inhalt ×2 |
| **Instrumente** | Subtraktiver Synth (2 Oszillatoren + Sub, Filter mit Hüllkurve, ADSR, 6 Presets), synthetisches 8-Pad-Drum-Kit (Tune/Decay/Level pro Pad), Audio-Clips mit Warp (Tempo-Anpassung) |
| **Effekte** | Pro Spur: 3-Band-EQ, Filter (TP/HP/BP), Sättigung, Kompressor; Return A = Hall, Return B = Tempo-Delay; Master-Limiter |
| **Mixer** | Fader mit Pegelanzeige, Pan, Sends, Mute/Solo/Arm, Returns, Master |
| **Aufnahme** | Audio vom Mikrofon in einen Session-Slot (Spur scharf schalten ●, auf leeren Slot tippen), MIDI-Overdub über Keyboard/Pads |
| **Projekt** | Auto-Sicherung, Speichern/Öffnen, Undo/Redo, `.als`-Import, Samples verknüpfen, Szenen → Arrangement, WAV-Export (in `Downloads/Musii`), `.musii`-Projektdatei |

### `.als`-Projekte importieren

Menü → *Ableton-Projekt (.als) importieren* (auch `.zip` mit `.als` darin). Übernommen werden Tempo,
Spuren (Name, Farbe, Lautstärke, Pan, Mute), MIDI-Clips mit Noten, Audio-Clips mit Warp-Tempo und
Startpunkt, Szenen, Session-Clips und Locator-Marker. Audio-Dateien sind nicht in einer `.als`
enthalten – nach dem Import die WAV-Dateien aus dem `Samples`-Ordner des Projekts auswählen,
sie werden über den Dateinamen automatisch zugeordnet. Plug-ins und Ableton-eigene Geräte werden
nicht übernommen; MIDI-Spuren spielen mit dem eingebauten Synth bzw. Drum-Kit.

## Aufbau

```
app/src/main/java/com/musii/app/MainActivity.kt   Android-Hülle (WebView, Mikrofon, Datei-Auswahl, Speichern)
app/src/main/assets/www/                          App: Web-Audio-Engine und Touch-UI
  js/engine.js      Instrumente, Kanalzüge, Effekte, Master
  js/transport.js   Look-ahead-Scheduler, Clip-Launching, Loop, Aufnahme, Offline-Render
  js/als.js         .als/.zip-Import
  js/ui-*.js        Session, Arrangement, Mixer, Editor, Geräte, Spielen
```

## Selbst bauen

Voraussetzungen: JDK 17+, Android SDK (Platform 35).

```bash
echo "sdk.dir=/pfad/zum/android-sdk" > local.properties
./gradlew assembleDebug        # -> app/build/outputs/apk/debug/app-debug.apk
```

Die Web-App lässt sich auch im Browser testen: `cd app/src/main/assets/www && python3 -m http.server`
und `http://localhost:8000` öffnen.
