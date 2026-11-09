# Sicherheitskonzept

**Keine offenen Ports.** Der Agent lauscht auf `127.0.0.1:8765`, das Remote Script auf `127.0.0.1:9878`.
Von außen ist nur das Tailnet erreichbar (`tailscale serve`, WireGuard-verschlüsselt, HTTPS mit gültigem
Zertifikat). Kein Port-Forwarding am Router, kein Tailscale Funnel.

**Gerätefreigabe.** Ein neues Gerät braucht einen 6-stelligen Einmal-Code, der nur am Mac erzeugt werden kann
(`./scripts/pair.sh`): 5 Minuten gültig, nach 5 Fehlversuchen ungültig, Rate-Limit je IP und global.

**Geräte-Token.** 256 Bit Zufall, gespeichert wird nur der SHA-256-Hash (`~/.mikka-studio/devices.json`, Modus 0600).
Widerruf in der App (Settings) oder am Mac (`./scripts/devices.sh revoke <ID>`) trennt aktive Verbindungen sofort.
Token verfallen nach `device_inactivity_days` (Standard 30) ohne Nutzung.

**Kein Token in URLs.** Die WebSocket-Anmeldung erfolgt in der ersten Nachricht. Audio-Stream und Downloads
nutzen kurzlebige Einmal-Tickets (30–120 s).

**Lokale Absicherung.** Das Remote Script akzeptiert nur Clients mit dem Geheimnis aus
`~/.mikka-studio/live_secret` (0600), damit andere lokale Programme Ableton nicht steuern können.

**Befehls-Whitelist.** Nur definierte Befehle werden weitergereicht; Werte werden im Remote Script geprüft und
begrenzt. Dateizugriffe sind auf den Exportordner beschränkt (Pfad-Traversal-Schutz), Konvertierungen
überschreiben nie bestehende Dateien.

**Zuverlässigkeit.** Jeder Befehl hat eine eindeutige ID; Wiederholungen werden nicht erneut ausgeführt.
Die App puffert keine Befehle: Ohne Verbindung schlagen sie sofort fehl, nach einem Abbruch wird nichts
nachträglich ausgeführt. Verbindungsabbrüche beenden weder Ableton noch das Projekt. Nach der Wiederverbindung
wird der tatsächliche Zustand aus Ableton neu geladen.

**Browser.** Strikte Content-Security-Policy (nur eigene Skripte), `X-Frame-Options: DENY`, kein Referrer,
`Cache-Control: no-store` für die API. Es gibt keine fest eingebauten Passwörter oder API-Schlüssel.
