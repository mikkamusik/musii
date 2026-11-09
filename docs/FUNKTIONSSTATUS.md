# Funktionsstatus (Version 0.1)

Legende Teststatus:
- **AT** – automatisiert getestet (`python3 -m pytest`, 34 Tests). Der Ende-zu-Ende-Test läuft mit dem echten
  Agent und dem echten Remote-Script-Code; nur Ableton ist durch ein LOM-Test-Double ersetzt.
- **UI** – im Browser (Chromium, Pixel-7-Emulation) gegen den laufenden Agent durchgeklickt.
- **MAC** – muss noch am Studiorechner mit echtem Ableton Live 12.4.6 bestätigt werden.
  Das war in der Entwicklungsumgebung nicht möglich (kein macOS, kein Ableton).

Keine Funktion verwendet Mock- oder Beispieldaten. Fehlt Ableton, zeigt die App „nicht verbunden“.

## Phase 1 – Analyse

| Funktion | Status | Test |
|---|---|---|
| Systemprüfung `scripts/check.sh` (OS, Python, Ableton-Version, Live läuft, MikkaRemote, AbletonMCP, ffmpeg-Encoder, BlackHole, Tailscale, Bildschirmfreigabe) | fertig | MAC |
| Dokumentation der API-Grenzen | fertig | `docs/EINSCHRAENKUNGEN.md` |

## Phase 2 – Funktionsfähige Verbindung

| Funktion | Status | Test |
|---|---|---|
| Remote Script im Live-Hauptthread, nicht-blockierender lokaler Server, Geheimnis-Anmeldung | fertig | AT, MAC |
| Agent ↔ Ableton mit automatischer Wiederverbindung | fertig | AT, MAC |
| Ableton-Erkennung (Prozess „Live“, Version via LOM) | fertig | AT (Version), MAC (Prozess) |
| Gerätekopplung (Einmal-Code), Geräte-Token, Widerruf, Inaktivitäts-Timeout | fertig | AT, UI |
| Play / Stop / Continue / Record | fertig | AT, UI, MAC |
| BPM setzen, ±1/±0.1, Presets 130–160, Tap Tempo, Taktart | fertig | AT, UI, MAC |
| Mixer: Volume, Pan, Sends, Mute, Solo, Arm, Umbenennen, Returns, Master, Gruppenanzeige | fertig | AT, UI, MAC |
| Echtzeit-Rückmeldung (Änderungen am Mac erscheinen am Phone, ~200 ms) | fertig | AT, MAC |
| Pegelanzeigen (Output-Meter je Spur, ~10 Hz) | fertig | UI, MAC |
| Schutz vor doppelter Ausführung (Befehls-IDs), keine nachträgliche Ausführung nach Abbruch | fertig | AT |

## Phase 3 – Erweiterte Fernsteuerung

| Funktion | Status | Test |
|---|---|---|
| Session View: Clips/Szenen starten, Spur stoppen, alle stoppen, Szene erstellen, Aufnahme in leere Slots (nur bei Arm), Quantisierung | fertig | AT, UI, MAC |
| Clip-Name/-Farbe/-Loop, Szenen-Name/-Farbe (Protokoll) | fertig (noch ohne UI) | AT |
| Arrangement: Position springen, Loop an/aus/Start/Länge, Marker setzen/löschen/anspringen, Session-Rec, Overdub, Undo/Redo | fertig | UI, MAC |
| Arrangement: Clips verschieben/kopieren/duplizieren/Längen, Automation | **nicht implementiert** → Remote Desktop | – |
| Devices: alle Geräte inkl. Rack-Ketten (3 Ebenen), alle Parameter dynamisch, Wertanzeige wie in Ableton, gesperrte Parameter erkannt | fertig | AT, UI, MAC |
| VST/AU-Parameter (soweit in Ableton freigegeben/„Configure“) | über dieselbe Geräte-Schnittstelle | MAC |
| Drum-Rack-Pads gezielt auswählen | **nicht implementiert** (Ketten sind als Liste sichtbar) | – |
| Projekt speichern / Speichern unter / Export-Dialog | Tastaturkürzel-Methode (ausdrücklich gekennzeichnet, unbestätigt) | MAC |
| Projekte öffnen, Versionen, Backups, Liste letzter Projekte | **nicht implementiert** | – |
| Remote Desktop | macOS-Bildschirmfreigabe + VNC-Client über Tailscale, Link in der App | MAC |

## Phase 4 – Audio

| Funktion | Status | Test |
|---|---|---|
| Master-Monitoring (BlackHole → ffmpeg → Opus/WebM, HTTP-Stream) | fertig | AT (mit Testsignal), MAC |
| Qualitätsstufen 48/96/160 kbit/s, automatische Herabstufung bei Aussetzern, Lautstärke, Mute, Pufferanzeige, Latenzbegrenzung | fertig | UI |
| WebRTC-Transport (geringere Latenz) | **nicht implementiert** (aktuell ca. 1–3 s Latenz) | – |
| Umschalten auf andere Monitoring-Signale | **nicht implementiert** | – |
| Sicherer Download/Anhören/Teilen von Exporten (Einmal-Tickets) | fertig | AT, UI |

## Phase 5 – AI Studio Engineer & Mastering

| Funktion | Status | Test |
|---|---|---|
| Deutsche Textbefehle: Tempo (absolut/relativ), Play/Stop, Metronom, Loop, Szene starten, Lautstärke ±dB / auf x dB je Spur (Namen + Instrument-Aliase), Mute/Solo/Arm, Rückgängig, Speichern, Analyse | fertig | AT, UI |
| Plan → Bestätigung → Ausführung → Rückmeldung des tatsächlich gesetzten Werts durch Ableton | fertig | AT, UI |
| Vorher-Nachher (A/B: Vorher-Zustand wiederherstellen), Änderungsprotokoll (`~/.mikka-studio/history.jsonl`) | fertig | AT, UI |
| Spracheingabe (Chrome Web Speech API, de-DE) | fertig (optional) | – |
| Klangliche Anweisungen („druckvoller“, „Resonanzen“, „Break bauen“, „Mixing optimieren“) | **nicht implementiert** – werden ehrlich abgelehnt, keine Änderung | AT |
| Messung: Integrated/Short-Term-max/Momentary-max LUFS, True Peak, Sample Peak, RMS, LRA, Crest-Faktor (ffmpeg ebur128/astats) | fertig, gegen Referenzton verifiziert | AT |
| Konvertierung WAV 24-Bit, WAV 32-Float, FLAC 24-Bit, MP3 320; 44,1/48/88,2/96 kHz; überschreibt nie | fertig | AT |
| Mastering-Profile (Streaming/Club/Radio/Dynamic), automatische Mastering-Bearbeitung | **nicht implementiert** | – |
| Mixing-Analyse je Spur (Spektrum, Konflikte, Phase, Stereo) | **nicht implementiert** | – |

## Phase 6 – Produktionstest

Der vollständige Ablauf (Mobilfunk → Tailscale → Agent → Ableton → Abhören → Speichern → Export) muss am
Studiorechner durchgeführt werden. Checkliste: `docs/INSTALLATION.md`, Abschnitt 7.
