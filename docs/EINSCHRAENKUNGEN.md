# Technische Bestandsaufnahme & Einschränkungen

## Geprüfte Schnittstellen

| Schnittstelle | Ergebnis | Verwendung |
|---|---|---|
| **Live Object Model über MIDI Remote Script** | In Live 12 Suite ohne Zusatzkosten nutzbar. Python 3 läuft in Live; Zugriff auf Song, Tracks, Mixer, Clip-Slots, Szenen, Cue-Points, Geräte und Parameter. | Hauptschnittstelle (`remote_script/MikkaRemote`) |
| Max for Live | In Suite enthalten, nutzt dasselbe LOM. Bietet für unsere Zwecke keine zusätzlichen Steuerfunktionen, benötigt aber ein Gerät in jedem Projekt. | nicht verwendet |
| Ableton-MCP | Ebenfalls ein Remote Script (Port 9877) mit kleinerem Funktionsumfang. Bleibt unverändert und kann parallel aktiv sein. | nicht verwendet, nicht verändert |
| Ableton Link / MIDI | Nur Tempo-Sync bzw. Noten/CC – keine Projektsteuerung. | nicht verwendet |
| AppleScript / System Events | Kann Tastaturkürzel an Live senden (Bedienungshilfen-Freigabe nötig). Keine Rückmeldung. | Fallback für Speichern/Export-Dialog, standardmäßig aus |
| macOS-Bildschirmfreigabe (VNC) | In Monterey enthalten. | Remote-Desktop-Fallback |

Die Bestandsaufnahme am konkreten Rechner liefert `./scripts/check.sh`. Das beigefügte Projekt
`mikkaner.als` wurde mit **Live 12.1.10** gespeichert (8 Audio-, 1 MIDI-Spur: „01 KICK“, „03 BASS“ …); Live 12.4.6
öffnet es, beim Speichern wird es auf das neuere Format gehoben (Ableton fragt dabei nach).

## Was das LOM NICHT kann (und wie die App damit umgeht)

| Vorgang | Grund | Alternativer Weg |
|---|---|---|
| Projekt speichern / „Speichern unter“ / öffnen | Keine LOM-Funktion | Tastaturkürzel-Methode (gekennzeichnet) bzw. Remote Desktop |
| Audio exportieren/rendern | Keine LOM-Funktion | Export-Dialog per Tastaturkürzel öffnen, Einstellungen im Remote Desktop |
| Plug-in-Fenster bedienen | Nur Parameter sind zugänglich, keine GUI | Parameter in DEVICES; Oberfläche per Remote Desktop |
| VST/AU-Parameter | Nur die in Ableton freigegebenen (bis zu 128, „Configure“) | Remote Desktop |
| Arrangement-Clips verschieben/zuschneiden | In Live 12 nur eingeschränkt (z.B. `duplicate_clip_to_arrangement`, Clip-Start/Ende) – in dieser Version nicht umgesetzt | Remote Desktop |
| Lautstärke in dB setzen | Ableton-Kurve ist nicht dokumentiert | Bisektion über `str_for_value` – exakt Abletons eigene Anzeige |
| Audio des Masters abgreifen | Remote Scripts haben keinen Audiozugriff | BlackHole + Multi-Output-Gerät |

## Plattform-Einschränkungen

- **Intel-Mac 2015 / Monterey:** Remote Script läuft im Live-Hauptthread, macht pro Tick nur einen Zustandsvergleich
  und sendet nur Änderungen; ohne verbundenen Agent tut es nichts außer neue Verbindungen anzunehmen.
  Mixer/Transport werden ca. alle 200 ms, Clips/Szenen alle 400 ms, Meter alle 100 ms verglichen.
  Bei sehr großen Projekten (> 100 Spuren × 100 Szenen) kann der Clip-Abgleich spürbar werden – dann bitte melden.
- **Python:** Agent ist kompatibel mit Python 3.8 (Xcode Command Line Tools auf Monterey).
- **Tailscale:** aktuelle macOS-App setzt macOS 12 voraus; Ausweichwege siehe INSTALLATION.md Abschnitt 5.
- **Audio-Latenz:** HTTP-Streaming über das `<audio>`-Element hat 1–3 s Latenz. WebRTC (z.B. via `aiortc`) würde
  < 300 ms erlauben, benötigt auf dem alten Intel-Mac aber eine aufwendige Kompilierung (libvpx/opus/srtp) – als
  nächster Schritt geplant.
- **Mikrofon-Freigabe:** ffmpeg braucht die macOS-Freigabe „Mikrofon“ für Terminal/Python, um BlackHole zu lesen.
- **Track-Referenzen:** Spuren werden über Index **und** Namen adressiert; wurde eine Spur zwischenzeitlich am Mac
  verschoben/umbenannt, wird der Befehl abgelehnt statt eine falsche Spur zu ändern.

## AI Studio Engineer – bewusste Grenzen

Stufe 1 ist regelbasiert und deterministisch: Jeder ausgeführte Schritt ist ein konkreter Ableton-Befehl, dessen
Ergebnis Ableton zurückmeldet. Klangliche Anweisungen benötigen (a) Spur-Audioanalyse – nicht über das LOM
verfügbar, nur über Re-Rendering/Resampling – und (b) ein Sprachmodell. Beides ist nicht umgesetzt; solche
Befehle werden mit Erklärung abgelehnt, ohne etwas zu verändern. Eine spätere Anbindung eines Sprachmodells
(z.B. Claude API) wäre optional und kostenpflichtig; der API-Schlüssel gehört dann in die Konfiguration, nie in den Code.
