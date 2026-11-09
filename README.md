# MIKKA STUDIO REMOTE
### Your Studio. Anywhere.

Ableton Live 12 vom Smartphone aus steuern – zu Hause im WLAN und unterwegs über Mobilfunk.
Der Mac steht im Studio und führt Ableton aus, das Pixel übernimmt die Steuerung.

> **Status: Version 0.1 – funktionsfähige Grundversion (Phase 1–2 vollständig, Phase 3–5 teilweise).**
> Was genau funktioniert und was noch nicht: [`docs/FUNKTIONSSTATUS.md`](docs/FUNKTIONSSTATUS.md).
> Alles, was nicht implementiert ist, ist auch in der App sichtbar als „Noch nicht implementiert“ markiert.

## Architektur

```
 Pixel 9 Pro (PWA, Chrome)
      │  HTTPS/WSS, nur im eigenen Tailnet (WireGuard-verschlüsselt)
      ▼
 tailscale serve  ──►  Mac Studio Agent (Python, 127.0.0.1:8765)
                          │  ├─ Geräte-Kopplung, Tokens, Widerruf
                          │  ├─ AI Engineer (deutsche Befehle)
                          │  ├─ Audio-Monitoring (ffmpeg → Opus)
                          │  └─ Export-Messung/-Konvertierung (ffmpeg)
                          │  TCP 127.0.0.1:9878, JSON Lines, lokales Geheimnis
                          ▼
                 MikkaRemote (Ableton Remote Script, Live Object Model)
                          ▼
                    Ableton Live 12 Suite
```

| Komponente | Ordner | Technik |
|---|---|---|
| Ableton-Integrationsmodul | `remote_script/MikkaRemote` | MIDI Remote Script (Python in Live), Live Object Model, keine Threads |
| Mac Studio Agent | `agent/mikka_agent` | Python ≥ 3.8, aiohttp (einzige Abhängigkeit) |
| Mobile Remote App | `agent/web` | Installierbare PWA, Vanilla JS, kein Build-Schritt |
| Sichere Verbindung | – | Tailscale (WireGuard) + Gerätekopplung + Tokens |
| Audio-Monitoring | `agent/mikka_agent/audio.py` | BlackHole → ffmpeg → Opus/WebM |
| Tests | `tests/` | pytest, inkl. Ende-zu-Ende-Test |

## Schnellstart

```bash
./scripts/install.sh
```

```bash
./scripts/start.sh
```

Ausführlich auf Deutsch: **[`docs/INSTALLATION.md`](docs/INSTALLATION.md)**

## Dokumentation

- [`docs/INSTALLATION.md`](docs/INSTALLATION.md) – Installationsanleitung (Mac, Ableton, Tailscale, Pixel)
- [`docs/FUNKTIONSSTATUS.md`](docs/FUNKTIONSSTATUS.md) – jede Funktion mit Teststatus
- [`docs/EINSCHRAENKUNGEN.md`](docs/EINSCHRAENKUNGEN.md) – technische Bestandsaufnahme & Grenzen der APIs
- [`docs/SICHERHEIT.md`](docs/SICHERHEIT.md) – Sicherheitskonzept
- [`docs/PROTOKOLL.md`](docs/PROTOKOLL.md) – Befehlsprotokoll zwischen App, Agent und Ableton

## Tests

```bash
pip install -r agent/requirements-dev.txt && python3 -m pytest
```

## Kosten

Alle verwendeten Komponenten sind kostenlos: Python, aiohttp, ffmpeg, BlackHole (Open Source),
Tailscale Personal-Plan (kostenlos; Open-Source-Alternative: Headscale bzw. reines WireGuard),
macOS-Bildschirmfreigabe, AVNC (Open-Source-VNC-Client für Android). Keine kostenpflichtigen DAW-Erweiterungen.
