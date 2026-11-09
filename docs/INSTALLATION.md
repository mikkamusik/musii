# Installationsanleitung

Zielumgebung: MacBook Pro (Intel, 2015), macOS Monterey 12.7.6, Ableton Live 12 Suite, Google Pixel 9 Pro.

Alle Schritte verändern weder die Ableton-Installation noch bestehende Projekte. Das Remote Script wird in die
**User Library** kopiert (nicht in das Programmpaket) und kann jederzeit wieder gelöscht werden.

---

## 1. Voraussetzungen am Mac

| Software | Zweck | Kosten | Prüfen |
|---|---|---|---|
| Python 3 (≥ 3.8) | Agent | kostenlos | `python3 --version` (sonst `xcode-select --install`) |
| ffmpeg | Monitoring, Messung, Konvertierung | kostenlos | `ffmpeg -version` (bereits vorhanden) |
| BlackHole 2ch | virtuelles Audio-Routing | kostenlos, Open Source | https://existential.audio/blackhole/ – unterstützt macOS 10.10+ |
| Tailscale | sichere Verbindung von unterwegs | kostenlos (Personal) | siehe Abschnitt 5 |

Repository herunterladen (z.B. nach `~/mikka-studio-remote`) und im Terminal:

```bash
cd ~/mikka-studio-remote
```

```bash
./scripts/install.sh
```

Das Skript legt `agent/.venv` an, installiert `aiohttp`, erstellt `~/.mikka-studio/` und `~/Music/MIKKA Exports/`,
fragt **vor** dem Kopieren des Remote Scripts nach und führt danach die Systemprüfung aus.

### Systemprüfung (Phase 1)

```bash
./scripts/check.sh
```

Zeigt macOS-/Python-Version, gefundene Ableton-Version, ob Live läuft, ob MikkaRemote aktiv ist, ob AbletonMCP
installiert ist (wird nicht angefasst), ffmpeg-Encoder (libopus, libmp3lame, FLAC), BlackHole, Tailscale und
Bildschirmfreigabe. Die Prüfung liest nur, sie verändert nichts. `--json` liefert maschinenlesbare Ausgabe.

---

## 2. Ableton einrichten

1. Ableton Live neu starten (damit das neue Remote Script gefunden wird).
2. **Einstellungen › Link, Tempo & MIDI › Control Surface**: in einem freien Slot **MikkaRemote** wählen,
   Eingang und Ausgang **Keine**.
3. In der Statuszeile von Live erscheint „MIKKA STUDIO REMOTE bereit (127.0.0.1:9878)“.

Hinweise:
- AbletonMCP (falls installiert) nutzt Port 9877 und kann parallel in einem anderen Slot aktiv bleiben.
- Fehler stehen in Lives `Log.txt` (`~/Library/Preferences/Ableton/Live 12.x/Log.txt`, Suchbegriff „MikkaRemote“).
- Beim ersten Laden legt das Script `~/.mikka-studio/live_secret` an (nur für deinen Benutzer lesbar).

---

## 3. Agent starten

```bash
./scripts/start.sh
```

Beim ersten Start ohne gekoppeltes Gerät wird ein Kopplungscode angezeigt. Weitere Codes:

```bash
./scripts/pair.sh
```

Optional als Hintergrunddienst bei jeder Anmeldung (mit Rückfrage, entfernbar mit `--remove`):

```bash
./scripts/install_launchagent.sh
```

Konfiguration: `~/.mikka-studio/config.json` (wird beim ersten Start angelegt). Wichtige Schlüssel:

| Schlüssel | Standard | Bedeutung |
|---|---|---|
| `port` | 8765 | lokaler Port des Agents (nur 127.0.0.1) |
| `exports_dir` | `~/Music/MIKKA Exports` | Ordner für Exporte (Messen, Konvertieren, Download) |
| `audio_input` | `["-f","avfoundation","-i",":BlackHole 2ch"]` | ffmpeg-Eingang für das Monitoring |
| `allow_keystrokes` | `false` | Tastaturkürzel (Speichern, Export-Dialog) an Ableton senden |
| `device_inactivity_days` | 30 | Geräte-Token verfallen nach so vielen Tagen ohne Nutzung |
| `remote_desktop_host` | leer | Hostname für den VNC-Link (leer = Tailscale-Name aus der App-Adresse) |

---

## 4. Audio-Monitoring einrichten (Master abhören)

Ziel: Der Mac spielt weiter ganz normal über Lautsprecher/Interface, **zusätzlich** geht eine Kopie an BlackHole.

1. BlackHole 2ch installieren (Installer von existential.audio, kostenlos).
2. **Audio-MIDI-Setup** öffnen › „+“ › **Gerät mit mehreren Ausgängen erstellen**.
   Haken bei deinem Interface/den Lautsprechern **und** bei BlackHole 2ch.
   Dein Interface als **Hauptgerät** wählen, bei BlackHole „Drift-Korrektur“ aktivieren.
3. In Ableton: **Einstellungen › Audio › Ausgabegerät** = dieses Multi-Output-Gerät.
   (Alternativ ohne Systemänderung: Interface als Ausgang lassen und nur das Monitoring testen, indem
   `audio_input` auf ein anderes Eingabegerät zeigt.)
4. Beim ersten Stream fragt macOS, ob Terminal/Python auf das „Mikrofon“ (Audioeingang) zugreifen darf → erlauben.
   Ohne diese Freigabe liefert ffmpeg Stille bzw. einen Fehler.
5. Geräteliste prüfen: `ffmpeg -f avfoundation -list_devices true -i ""`

Die Mac-Ausgabe wird dadurch nicht unterbrochen. Der Stream ist Opus-komprimiert und **nur zum Abhören** gedacht;
Messungen und Exporte basieren immer auf den unkomprimierten Dateien am Mac.

---

## 5. Sichere Verbindung von unterwegs (Tailscale)

Tailscale baut ein privates, WireGuard-verschlüsseltes Netz zwischen Mac und Pixel – auch hinter Heimroutern,
ohne Portfreigaben. Der Agent selbst lauscht nur auf `127.0.0.1` und ist nie direkt aus dem Internet erreichbar.

**Kompatibilität mit Monterey:** Tailscale gibt für die aktuelle macOS-App macOS 12 als Mindestversion an.
Bitte vor der Installation auf https://tailscale.com/kb/1016/install-mac prüfen; das Ergebnis zeigt auch
`./scripts/check.sh`. Falls eine künftige Version Monterey nicht mehr unterstützt: ältere Tailscale-Version
(Release-Archiv) oder die Open-Source-CLI `tailscale`/`tailscaled` über Homebrew verwenden; Alternative ohne
Fremdanbieter-Koordination: Headscale (selbst gehostet) oder ein reines WireGuard-VPN zum Heimrouter.

1. Tailscale auf Mac und Pixel installieren, mit demselben Konto anmelden.
2. In der Tailscale-Admin-Konsole **MagicDNS** und **HTTPS Certificates** aktivieren.
3. Am Mac den Agent ins Tailnet freigeben (nur Tailnet, **nicht** Funnel/öffentlich):

```bash
tailscale serve --bg 8765
```

4. Die angezeigte Adresse `https://<mac-name>.<tailnet>.ts.net` auf dem Pixel in Chrome öffnen.
5. Kopplungscode eingeben (`./scripts/pair.sh`), dann im Chrome-Menü **„App installieren“** bzw.
   „Zum Startbildschirm hinzufügen“ wählen. Die App startet danach wie eine native App.

Ohne Tailscale im Heimnetz testen: In `config.json` `"host": "0.0.0.0"` setzen und `http://<Mac-IP>:8765`
öffnen. Das ist **unverschlüsselt** und nur für Tests im vertrauenswürdigen WLAN gedacht (die App zeigt das an);
die PWA-Installation und der Service Worker benötigen ohnehin HTTPS.

---

## 6. Remote-Desktop-Fallback

1. Mac: **Systemeinstellungen › Freigaben › Bildschirmfreigabe** aktivieren, Zugriff nur für deinen Benutzer.
2. Pixel: kostenlosen VNC-Client installieren, z.B. **AVNC** (Open Source).
3. In der App unter **Remote Desktop** „VNC-Verbindung öffnen“ – Ziel ist der Tailscale-Name des Macs.
   Bildschirmfreigabe ist nur im Tailnet erreichbar, nicht im Internet.

Tastaturkürzel (Speichern, Speichern unter, Export-Dialog) sind optional: `"allow_keystrokes": true` und unter
**Systemeinstellungen › Sicherheit › Bedienungshilfen** Terminal bzw. Python freigeben.

---

## 7. Produktionsablauf (Phase-6-Szenario)

1. Mac zu Hause: Ableton offen, MikkaRemote aktiv, Agent läuft, `tailscale serve` aktiv.
2. Pixel im Mobilfunk: Tailscale an, App öffnen → „MAC“ und „LIVE“ grün.
3. Studio: Play/Stop, Tempo. Mixer: Fader, Mute/Solo. Studio › Monitor: „Abhören“.
4. Speichern: Studio › Projekt › „Speichern (Cmd+S)“ (Tastaturkürzel-Methode) oder per Remote Desktop.
5. Export: Export-Dialog per Tastaturkürzel öffnen, im Remote Desktop in `~/Music/MIKKA Exports` rendern.
6. Mastering-Tab: Datei messen (LUFS, True Peak …), konvertieren (WAV/FLAC/MP3), anhören, herunterladen, teilen.

Dieser Ablauf ist in den automatisierten Tests bis einschließlich Agent und Remote-Script-Code abgedeckt
(mit einem LOM-Test-Double statt Ableton). Der Test mit echtem Ableton und Mobilfunk muss am Studiorechner
erfolgen – siehe `docs/FUNKTIONSSTATUS.md`.

---

## Deinstallation

```bash
./scripts/install_launchagent.sh --remove
```

```bash
rm -rf "$HOME/Music/Ableton/User Library/Remote Scripts/MikkaRemote" "$HOME/.mikka-studio"
```

```bash
tailscale serve reset
```
