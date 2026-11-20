# NACHTSTROM v13 – 147 BPM · Cis · ein durchgehender Track, dirty Sub, spanischer Vocal-Hook

Gebaut nach dem vermessenen Bauplan deiner Referenz, die Details stehen in `REFERENZ_ANALYSE.md`.

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

Neu in v11, nicht mehr progressiv und nicht mehr „wie 3 Tracks gleichzeitig“:
- **Ein Grundton (Cis)** für den ganzen Track, ohne Tonartwechsel.
- **Ein Bass:** ein dreckiger Offbeat-Sub. Sinus-Sub mit Saw-Anteil, Sättigung und einem parallelen Grit-Layer zwischen 100 und 900 Hz. Dazu ein lauteres, raueres Rumble. Den Low-End-Bereich lässt der Match-EQ bewusst in Ruhe.
- **Ein Riff** für den ganzen Track, mit einer Antwort alle 4 Takte. Der Filter öffnet sich über jeweils 16 Takte.
- **Eine Percussion-Familie:** Toms und Rim. Im Peak wird sie nur dichter, durch Congas und Ride.
- **Was raus ist:** Metall-Loop, Shaker, Stab-Hook und die wechselnden Bassmuster.
- **Abwechslung** entsteht nur noch über die Dramaturgie: Elemente kommen und gehen, Filter, der Fill alle 8 Takte, Highlights und Breaks.
- **Vocals:** auf **Spanisch** („Corriente nocturna“, „Más profundo“, „Déjate caer“, „Sigue“). Die Plätze im Arrangement stehen, die Shots kommen von ElevenLabs. Die alten deutschen Shots liegen in `Samples/Vocals/alt_deutsch/`.

## In Ableton öffnen
1. `NACHTSTROM_v13.zip` aus dem Chat im Ordner **Downloads** doppelklicken. Es entsteht `Downloads/NACHTSTROM_v13/`.
2. `NACHTSTROM_v13/NACHTSTROM.als` öffnen.
3. Falls „Sample Offline“ erscheint: rechts **Ordner wählen** → `NACHTSTROM_v13` → **Los** → **Sichern**, dann **Cmd+S**.
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

## Der spanische Vocal-Hook (neu in v12)
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
pip install numpy numba scipy soundfile pyloudnorm
cd src && python3 render.py /pfad/zur/referenz.mp3 && python3 export_midi.py && python3 build_als.py
```
