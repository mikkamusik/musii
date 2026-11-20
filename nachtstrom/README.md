# NACHTSTROM v17 – 147 BPM · Cis · ein durchgehender Track, reiner Sub, dramatische Orchester-Shorts

Gebaut nach dem vermessenen Bauplan deiner Referenz, die Details stehen in `REFERENZ_ANALYSE.md`.

## Neu in v17: Dramatisches Streichorchester mit Shorts
Die Solo-Violine ist raus. Jetzt spielt ein **Streichorchester kurze Noten (Shorts)**, dramatisch wie in Film- und Trailer-Musik (`src/strings.py`, ganz ohne Samples synthetisiert).
- **Besetzung im Orchester-Setup:**
  - 1. Violinen links (6 Spieler), 2. Violinen halblinks (6), Bratschen halbrechts (4), Celli rechts (4).
  - Jeder Spieler ist leicht verstimmt und minimal versetzt, dadurch klingt es wie eine echte Gruppe.
- **Spieltechnik:**
  - 1. Violinen: treibendes **16tel-Spiccato**, akzentuiert im 3-3-2-Groove.
  - 2. Violinen und Bratschen: Achtel-Puls.
  - Celli: wuchtiges **Marcato** „DUM . . DUM . . DUM .“
  - Ein **Tutti-Schlag** auf der ersten Eins jeder Phrase.
- **Harmonie:** Cis-Moll → A → D (der dunkle Neapolitaner) → E. Die Oberstimme steigt E6 → E6 → Fis6 → Gis6, dazu ein Crescendo über 4 Takte: Die Spannung wächst, dann geht es zurück auf Cis-Moll.
- **Klang:** Bogen-Biss und Korpus-Resonanzen je nach Instrumentengröße, großer Konzertsaal-Hall. Unter 110 Hz bleibt Platz für Sub und Rumble.
- **MIDI:** Alle Streicher liegen als **12b STRINGS MIDI** im Set, zum Beispiel für BBC Symphony Orchestra Discover oder Spitfire LABS (Spiccato/Staccato).

| Takt | Streicher |
|---|---|
| 37 | Teaser: nur 1. Violinen, gefiltert |
| 57–64 | volles Orchester |
| 106 | Breakdown: leise, viel Saal |
| 115–130 | volles Orchester, 16 Takte |
| 151 | Main 3 |
| 167 | Teaser im Outro |

Hörprobe: `bounce/NACHTSTROM_strings_preview.mp3`.

## Neu in v16: Violine statt Stimme
Die Stimme ist komplett raus, Atemgeräusche inklusive. Der virale Hook ist jetzt eine **Violine**.
- **Melodie** (4 Takte, Cis-phrygisch wie das Riff): **Cis–H–Cis–E | D–Cis–H | Gis–A–H–Cis | D–Cis**.
  - Die Melodie beginnt hoch auf dem Grundton und steigt zur kleinen Terz.
  - Sie endet mit der phrygischen Kadenz D → Cis, einem dunklen, orientalischen Ohrwurm.
  - Rhythmus: punktierte Viertel, Achtel, Viertel, Viertel. Gesanglich und leicht nachzupfeifen.
- **Klang** (`src/violin.py`), ganz ohne Samples synthetisiert:
  - eine gestrichene Saite (bandbegrenzter Sägezahn mit Perioden-Jitter)
  - Geigenkorpus-Resonanzen (280 Hz, 460 Hz, 1 kHz, Bridge Hill 2,5–3,3 kHz)
  - Slides zwischen den Tönen und ein kleiner Scoop in jeden Ton
  - verzögert einsetzendes Vibrato (5,6 Hz)
  - Bogenwechsel, Bogen-Biss im Anschlag und Bogengeräusch
- **Besetzung:**
  - Im Main und Peak spielt ein Geigen-Pult: Hauptgeige, zwei leicht verstimmte Pulte links und rechts, leise Bratsche eine Oktave tiefer.
  - Im Breakdown spielt eine Solo-Geige eine Oktave tiefer, mit viel Raum: der Gänsehaut-Moment.
- **Im Mix:** Riff, Percussion, Hats, Dub-Stab und Atmos treten langsam bis zu 3 dB zurück, solange die Geige spielt.
- **Eigene Violine:** Die Melodie liegt auch als MIDI-Spur **12b VIOLIN MIDI** im Set. Damit kannst du sie mit einer echten Violin-Library spielen.

| Takt | Violine |
|---|---|
| 37 | Teaser, gefiltert und weit weg |
| 57, 61 | voller Hook, zweimal |
| 106 | Solo im Breakdown, eine Oktave tiefer |
| 115–130 | viermal im Peak |
| 151 | Main 3 |
| 167 | Teaser im Outro |

Hörprobe der Violine allein: `bounce/NACHTSTROM_violin_preview.mp3`. Die alten Vocal-Dateien liegen noch in `Samples/Vocals/`, werden aber nicht mehr verwendet.

## Neu in v15: Sub-Bass und verspulte Stimme
- **Bass = reiner Sub, nicht EDM:** Saw-Anteil und Mitten-Grit (100–900 Hz) sind raus. Ein Sinus-Sub mit sanfter Sättigung, über 190 Hz ist nichts mehr, steil abgeschnitten. Man fühlt ihn mehr, als man ihn hört. Das Rumble bleibt.
- **Stimme sexy gesprochen und verspult, nicht verzerrt:** Der gesungene Hook ist raus. Eine **tiefe, warme spanische Frauenstimme** spricht gehaucht und nah am Ohr. Die Phrasen schweben:
  - Tape-Leiern (Wow und Flutter), die Tonhöhe schwimmt leicht
  - ein leiser Oktav-Schatten darunter
  - ein langsam drehender Phaser
  - ein Reverse-Hall, der jede Phrase ansaugt
  - das letzte Wort gedehnt („caeeer…“)
  - saubere, leiernde Dub-Echos und ein großer Raum
- **Woher die Stimme kommt:** Piper TTS „es_AR-daniela-high“, lokal und kostenlos erzeugt (`src/spoken_tts.py`).
  - Datensatz: OpenSLR 61, Lizenz CC BY-SA 4.0.
  - Für eine kommerzielle Veröffentlichung bitte die Lizenz beachten. Alternativ die Zeilen neu einsprechen und die Dateien in `Samples/Vocals/spoken/` ersetzen; Arrangement und Effekte bleiben gleich.
- **Sexy-Kette** (`src/spoken.py`):
  - einen Halbton tiefer
  - nur ein Hauch LPC-Flüsterstimme darunter, ohne Rauschen
  - Nahbesprechungs-Wärme
  - weiches S: Zischlaute bleiben 24 dB unter dem lautesten Vokal
  - sanfter Kompressor
  - Gate zwischen den Silben: Ruhe statt Grundrauschen (5–11 dB weniger Rauschen als in der ersten Version)

| Takt | Stimme |
|---|---|
| 29 | „Corriente nocturna“ geflüstert |
| 37 | Teaser: „Ven… déjate caer“ / „Más profundo“, gefiltert und weit weg |
| 45 | „Más profundo“, gedehnt, mit Reverse-Hall (Break 1) |
| 57, 61 | „Ven… déjate caer“ auf der Eins, zwei Takte später „Más profundo“ |
| 80 | „No pares“ im Stopp, ganz nah |
| 106 | Breakdown: intim, viel Raum, Reverse-Hall |
| 115–130 | alle 4 Takte im Peak |
| 130 | „Sigue“ im Stopp |
| 138, 142 | „Ven“-Chops als Call |
| 151, 167 | Main 3 und Outro, dazu „Corriente nocturna“ zum Abschied |

Die einzelnen Phrasen liegen in `Samples/Vocals/spoken/`, eine Hörprobe der Stimme in `bounce/NACHTSTROM_vocal_preview.mp3`. Der alte gesungene Hook liegt noch in `Samples/Vocals/`, wird aber nicht mehr verwendet.

## Neu in v13: Studio-Klang
Alles ist hier im Chat gerechnet, ohne Bezahldienste und ohne fremde Plugins.
- **Studio-Hall statt Metall-Hall:** Ein modulierender 8-Kanal-FDN-Hall (Feedback Delay Network) ersetzt den alten Freeverb. Die Hallfahne ist dicht, nicht metallisch, links und rechts unkorreliert (Korrelation ≈ 0) und hat frequenzabhängige Dämpfung. Pegel und Nachhallzeit sind auf den alten Hall eingemessen, die Proportionen im Mix bleiben also gleich.
- **Punch:** Der Match-EQ auf die Referenz arbeitet jetzt **minimalphasig**. Die alte linearphasige Version legte vor jeden Transienten ein leises Vorecho (am Impuls gemessen −26 dB). Das ist jetzt weg, der Frequenzgang bleibt identisch. Ergebnis: Der Crest-Faktor (Abstand zwischen Spitze und Mittelwert, also die Wucht) liegt im Peak bei **7,1 dB** und damit praktisch auf dem Niveau der Referenz (7,2 dB). v12 hatte 6,4 dB.
- **Spannungsbögen wie in der Referenz, kein EDM-Crescendo:** Ich habe beide Tracks Takt für Takt in LUFS vermessen. Bei v12 war der Takt vor dem großen Drop (Takt 114) **lauter als der Drop selbst**: Riser und Atem wurden immer lauter, also klassisch EDM. In der Referenz ist dieser Takt fast still, und dann schlägt der Drop rund 13 LU drauf. Jetzt gilt:
  - Die erste Breakdown-Hälfte ist etwas voller.
  - Das A cappella ist ein leiser, intimer Moment im Raum, kein EDM-A-cappella auf Peak-Pegel.
  - Der Aufbau bleibt gedämpft, Riser und Atem sind hörbar, aber leiser.
  - Erst der Drop springt voll rein. Die Pegelstufe liegt kurz vor der Eins im Beat-Cut, damit die erste Drop-Kick ungebremst kommt.
  - Break 1 ist genauso gebaut.
- **Riff wie ein echter Analog-Synth:**
  - drei Saw-VCOs pro Seite, jeder mit eigener langsamer Tonhöhen-Drift (±3,5 Cent)
  - PWM-Sub-Oszillator
  - **4-Pol Transistor-Ladder-Filter** (Moog-Art) statt State-Variable
  - Röhrensättigung und Stereo-Chorus mit zwei Stimmen
  - Die Helligkeit ist auf v12 eingemessen (Spektralschwerpunkt 600 Hz zu 604 Hz).
- **Stereobild wie die Referenz:** Ein M/S-EQ gleicht die Breite pro Terzband automatisch an die Referenz an. Vorher war unser Track in den Mitten zu schmal und in den Höhen zu breit. Das Rumble bleibt im Sub mono und wird erst ab 150 Hz breit.

**Gemessen gegen die Referenz (gleiche Abschnitte, gleiche Methode):**

| Messung | Referenz | v12 | v13 |
|---|---|---|---|
| Sprung Breakdown → Drop | 11,2 LU | 4,3 LU | **8,4 LU** |
| Sprung Break 1 → Main 1 | 7,8 LU | 5,1 LU | **6,6 LU** |
| Takt 114 → Drop (Takt 115) | +13,3 LU | −0,7 LU (Drop leiser!) | **+4,7 LU** |
| Crest-Faktor im Peak (Wucht) | 7,2 dB | 6,4 dB | **7,1 dB** |
| Stereobreite im Peak (Seite/Mitte) | −11,9 dB | −15,6 dB | **−12,5 dB** |
| Klangbalance, größte Abweichung | – | 7,1 dB | **3,8 dB** |

Neu in v11, nicht mehr progressiv und nicht mehr „wie 3 Tracks gleichzeitig“:
- **Ein Grundton (Cis)** für den ganzen Track, ohne Tonartwechsel.
- **Ein Bass:** ein Offbeat-Sub, seit v15 reiner Sub ohne Mitten-Grit. Dazu ein lauteres, raueres Rumble. Den Low-End-Bereich lässt der Match-EQ bewusst in Ruhe.
- **Ein Riff** für den ganzen Track, mit einer Antwort alle 4 Takte. Der Filter öffnet sich über jeweils 16 Takte.
- **Eine Percussion-Familie:** Toms und Rim. Im Peak wird sie nur dichter, durch Congas und Ride.
- **Was raus ist:** Metall-Loop, Shaker, Stab-Hook und die wechselnden Bassmuster.
- **Abwechslung** entsteht nur noch über die Dramaturgie: Elemente kommen und gehen, Filter, der Fill alle 8 Takte, Highlights und Breaks.
- **Vocals:** auf **Spanisch** („Corriente nocturna“, „Más profundo“, „Déjate caer“, „Sigue“). Die Plätze im Arrangement stehen, die Shots kommen von ElevenLabs. Die alten deutschen Shots liegen in `Samples/Vocals/alt_deutsch/`.

## In Ableton öffnen
1. `NACHTSTROM_v17.zip` aus dem Chat im Ordner **Downloads** doppelklicken. Es entsteht `Downloads/NACHTSTROM_v17/`.
2. `NACHTSTROM_v17/NACHTSTROM.als` öffnen.
3. Falls „Sample Offline“ erscheint: rechts **Ordner wählen** → `NACHTSTROM_v17` → **Los** → **Sichern**, dann **Cmd+S**.
4. A/B-Vergleich: **00 REFERENZ** und **00 MASTER BOUNCE** abwechselnd solo hören.

## Highlights (Takt-Nummern wie in Ableton)
| Takt | Highlight |
|---|---|
| 16 | Filter-Dive in den Groove, Crash, der Clap kommt |
| 25 | Dub-Stab mit langem Echo als Teaser |
| 41–48 | Break 1: Tape-Stopp, Toms in Halbtempo im großen Raum, Drone, Tom-Roll als Aufbau, Pickup-Kick |
| 49 | Drop mit Sub-Drop und Crash |
| 56, 126 | Stutter-Fills |
| 64 → 65 | Kick-Stopp mit Echo-Throw, Ping |
| 79–80 | Stopp: Riff-Solo mit Resonanz-Sweep |
| 96 | Hochpass-Fahrt in den Breakdown |
| 97–114 | Breakdown: Kick-Stottern, lange Töne, Dub-Echos; Aufbau mit Riser, Kick-Roll, Höhen-Loch und Beat-Cut |
| 115 | großer Drop mit Sub-Drop, Crash, Ride, offene Hats |
| 130 | Stopp: Riff-Solo mit Resonanz-Sweep, Ping |
| 131–146 | Dub-Stabs alle 2 Takte |
| alle 8 Takte | ein Fill im Wechsel: Tom-Fill, ausgelassene Kick, Hat-Roll, Reverse-Becken |

## Alter gesungener Hook (v12/v13, ersetzt in v14)
**„Dé-ja-te ca-er / dé-ja-te ca-er / más pro-fun-do“**: ein hypnotischer Sprechgesang statt einer Pop-Melodie.
- **Tonraum:** eng um Cis, D und E, mit dem phrygischen D als dunkler Farbe.
- **Rhythmus:** Die Silben sitzen im 3-3-2-Groove.
- **„Más profundo“** fällt eine Oktave nach unten, passend zum Wort („tiefer“).
- **Stimme:** gesungen von „Daniela – Cálida, Emotiva y Dinámica“ (ElevenLabs). `src/vocal_hook.py` schneidet den Gesang in Silben und stimmt jede Silbe per Tonhöhenmessung auf ihren Melodieton.
- **Klang:** dunkel gefiltert, leicht angezerrt, mit Dub-Echo, also bewusst nicht EDM-glatt.

| Takt | Hook |
|---|---|
| 37 | Teaser, gefiltert und weit weg |
| 57, 61 | voller Hook in Main 1 |
| 106 | **a cappella** im Breakdown, großer Raum |
| 115–130 | 4× im Peak |
| 151 | nochmal in Main 3 |
| 167 | Echo im Outro |

**Atem:**
- Ein Einatmen endet genau auf jedem Hook-Einsatz.
- Ein **großes Einatmen im Beat-Cut direkt vor dem Drop bei Takt 115**.
- Ein Ausatmen zu Beginn des Breakdowns und nach dem Tape-Stopp in Break 1.

**Weitere Shots:** „Corriente nocturna“ geflüstert (Takt 29 und 167), „Sigue“ in den Stopps (Takt 80 und 130), „Más profundo“ in Break 1 (Takt 45), „Déjate caer“ im Breakdown (Takt 106) und „Dé“-Chops als Call (Takt 138 und 142).

**Dateien:** Der rohe Take liegt in `Samples/Vocals/raw_es/`. Hook, Shots und Atem liegen einzeln in `Samples/Vocals/`, die Hook-Melodie auch als **12b HOOK MIDI**.

## Neu rendern
```
pip install numpy numba scipy soundfile pyloudnorm librosa piper-tts
cd src && python3 spoken_tts.py <piper-modelle> /tmp/tts && python3 spoken.py /tmp/tts ../Samples/Vocals/spoken
python3 render.py /pfad/zur/referenz.mp3 && python3 export_midi.py && python3 build_als.py
```
