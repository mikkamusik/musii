# 🎵 Musii

Ein kostenloser Musik-Streaming-Player im Stil moderner Musik-Apps – ohne Abo, ohne Werbung, ohne Anmeldung.

## Features

- **Millionen komplette Songs gratis & legal** – über die offene [Audius](https://audius.co)-API (unabhängige Artists, kein API-Key nötig)
- **Startseite** mit Trending, Underground-Hits, beliebten Playlists, Lo-Fi, Electronic, Hip-Hop
- **Suche** nach Songs, Artists, Playlists und Alben (Live-Suche beim Tippen)
- **24 Genres** zum Stöbern, **Charts** (Woche / Monat / Allzeit)
- **Artist-Seiten** und **Playlist-/Album-Seiten**
- **Lieblingssongs** (♥) und **eigene Playlists** erstellen, umbenennen, löschen, Playlists speichern
- **Eigene Dateien** abspielen (MP3, M4A, WAV, FLAC, OGG …) – per Drag & Drop, bleiben privat im Browser
- **Player**: Play/Pause, Vor/Zurück, Zufall, Wiederholen (alle/eins), Spulen, Lautstärke, Warteschlange
- **Vollbild-Player** mit Audio-Visualizer
- Steuerung über Sperrbildschirm / Medientasten (Media Session API)
- **Handy-optimiert** und als App installierbar (PWA)

## Starten

Einfach einen lokalen Webserver im Ordner starten:

```bash
python3 -m http.server 8000
```

Dann <http://localhost:8000> öffnen. Alternativ GitHub Pages für das Repo aktivieren – dann läuft Musii direkt im Browser und lässt sich aufs Handy installieren.

## Tastenkürzel

| Taste | Aktion |
|---|---|
| Leertaste | Play / Pause |
| ← / → | 5 Sek. spulen |
| Shift + ← / → | Vorheriger / nächster Song |
| ↑ / ↓ | Lautstärke |
| S / R / M / L / F | Zufall / Wiederholen / Stumm / Like / Vollbild |
| / | Suche |

## Hinweis zur Musik

Musii streamt ausschließlich Musik, die Artists selbst frei auf Audius veröffentlicht haben, plus deine eigenen Dateien. Songs großer Labels (die nur bei Bezahldiensten lizenziert sind) gibt es hier nicht – dafür alles legal und gratis.
