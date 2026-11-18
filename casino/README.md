# Lucky Musii Casino

Spielgeld-Casino im Browser mit fünf eigenen Slots. Kein Echtgeld, keine Auszahlung.

| Slot | Spielprinzip |
| --- | --- |
| Pharaoh's Codex | 5×3, 10 Linien. Codex = Wild + Scatter, 10 Freispiele mit expandierendem Bonussymbol |
| Angler's Fortune | 5×3, 10 Linien. Geld-Fische, Angler-Wild sammelt sie in den Freispielen, Multiplikator bis x10 |
| Sugar Storm | 6×5, Gewinne überall ab 8 Symbolen, Kaskaden, Multiplikator-Bomben bis 100x in den Freispielen |
| Moon Wolf | 5×3, 20 Linien. Hold & Spin mit Mond-Werten und MINI / MAJOR / GRAND Jackpot |
| Inferno 7 | 5×3, 5 Linien. Klassischer Früchte-Slot mit Stern-Scatter und Risiko-Spiel (Rot/Schwarz) |

Weitere Funktionen: Autoplay, Turbo, Gewinnlinien-Anzeige, Big-Win-Animation, Sound, Bonus-Münzen alle 4 Stunden, Gratis-Nachladen bei leerem Konto. Kontostand und Einstellungen bleiben im Browser gespeichert.

## Starten

Keine Installation nötig. Im Ordner `casino` einen kleinen Webserver starten und im Browser öffnen:

```bash
cd casino
python3 -m http.server 8000
# dann http://localhost:8000 öffnen
```

## Auszahlungsquote prüfen

Die Spiellogik (`engine.js`) läuft auch in Node. Der Simulator spielt viele Runden und gibt RTP, Bonus-Häufigkeit und Trefferquote aus:

```bash
node casino/tools/sim.js 500000          # alle Slots
node casino/tools/sim.js 500000 sugar    # nur ein Slot
```

Alle Slots sind auf etwa 96 % abgestimmt. Wegen seltener Großgewinne schwanken einzelne Läufe um ein paar Prozentpunkte.

## Dateien

- `index.html` – Seitenstruktur
- `style.css` – Design
- `engine.js` – Spiellogik und Gewinntabellen (ohne DOM)
- `app.js` – Oberfläche, Animationen, Sound, Speicherstand
- `tools/sim.js`, `tools/inferno_exact.js` – RTP-Simulation und exakte Berechnung für Inferno 7
