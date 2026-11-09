# Narco Clarity

Material für den Kanal. `teaser/` enthält den Kanal-Teaser, `scripts/` die
Werkzeuge, mit denen er gebaut wurde.

## Teaser neu bauen

```bash
cd narco-clarity/teaser
bash ../scripts/build_ref.sh narco-clarity-teaser.mp4
```

Das erzeugt aus `script.json` Sprache, Tonbett, Bild und Mischung. Beim ersten
Lauf wird das Stimmmodell (ca. 110 MB) nach `voices/` geladen.

## Was wo liegt

| Datei | Zweck |
| --- | --- |
| `teaser/script.json` | Sprechertext, Kapitel, Stichpunkte |
| `teaser/beschreibung.txt` | Titel, Videobeschreibung, Ich-Fassung zum Selbst-Einsprechen |
| `scripts/narrate.py` | Text zu Sprache; `"sprich"` gibt eine abweichende Aussprache vor, die Untertitel zeigen weiter `"text"` |
| `scripts/score.py` | Tonbett |
| `scripts/animate_ref.py` | Bild im Interview-Look: sitzende Figur vor dem Fenster, Kinobalken |
| `scripts/animate.py` | Bild im ursprünglichen Kanal-Look (Profil, Stichpunkte rechts) |
| `scripts/build_video.sh` | rendert in mehreren Teilen parallel und mischt den Ton |

Probebilder vor einem vollen Render:

```bash
python3 ../scripts/animate_ref.py --probe 6,20,33,44,52
```
