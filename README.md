# MUSII Studio

**Ein Studio. Jede KI.** MUSII Studio ist eine selbst gehostete KI-Produktionsplattform für Video, Bild, Stimme und Musik. Alle Profi-Funktionen sind freigeschaltet. Es gibt keine Credits und keine Abos, die App läuft mit deinen eigenen API-Schlüsseln. Ein **Smart-Router** wählt pro Aufgabe automatisch die beste verbundene KI. Eine **KI-Regie** formuliert deine Prompts wie ein Kameramann, und ein **automatischer Fallback** springt bei Ausfällen sofort auf den nächstbesten Anbieter.

## Funktionen

| Bereich | Was es kann |
|---|---|
| 🎬 **Video-Studio** | Text→Video und Bild→Video mit **44 Kamerafahrten** (Dolly, Crash Zoom, Orbit, FPV, Bullet Time, Dolly Zoom …), kombinierbar als **Mix** (bis zu 3). Dazu **25 VFX-Effekte**, Start- **und** Endframe, Ton/Sounddesign, 4–12 s, bis 1080p, Varianten |
| ⚡ **Local Motion** | Kamerafahrten **gratis im Browser** rendern (Canvas + MediaRecorder), ohne API und ohne Kosten |
| 🖼️ **Bild-Studio** | Text→Bild mit 20 Stilen, Referenzbildern, Remix eines Ausgangsbildes, Negativ-Prompt, Seed, 1–4 Varianten, **Best-of-N mit KI-Jury** |
| 👤 **Charaktere** | Personen oder Produkte mit Referenzbildern anlegen, dann **gleiches Gesicht in jedem Bild und Video**. Referenzfähige Modelle werden automatisch bevorzugt |
| 🪄 **Bearbeiten** | Bearbeitung per Anweisung, **Inpainting mit Pinsel-Maske**, Bild- & Video-Upscale, Freistellen, **Bild → Prompt** |
| 🗣️ **Avatar** | Foto oder Video + Text/Audio → **sprechender Avatar mit Lipsync**. Text wird automatisch vertont |
| 🎵 **Audio** | Sprachausgabe (TTS) mit Stimmenauswahl, Soundeffekte, Musik |
| ⚖️ **Modell-Arena** | Gleicher Prompt, mehrere KIs nebeneinander. Eine **Vision-KI-Jury** vergibt Punkte und kürt den Sieger |
| 🔗 **Workflows** | Mehrstufige Produktionen auf Knopfdruck: *Idee → Bild → Video*, *Sprechender Avatar*, *Produkt-Werbespot*, *Musik-Clip*, *Foto zum Leben erwecken* |
| 📚 **Bibliothek** | Alle Ergebnisse mit Suche, Favoriten, Download und Drag & Drop. Aktionen wie *Animieren*, *Verlängern* (letzter Frame → neues Video), *Upscale*, *Freistellen*, *Avatar* |
| 🔌 **Verbindungen** | Schlüsselverwaltung (AES-256-GCM verschlüsselt), Verbindungstest, Modellkatalog mit Qualitäts-Scores, eigene Modelle, Routing-Strategie, Kostenübersicht |

## Angebundene KIs

| Anbieter | Nutzung |
|---|---|
| **fal.ai** | Kling 2.5/2.1, Veo 3/3.1, Sora 2, Hailuo 02, Seedance, Wan 2.2, Luma Ray, FLUX, Seedream 4, Nano Banana, Ideogram, Recraft, Qwen, OmniHuman, Fabric, Sync Lipsync, Topaz/SeedVR/Clarity Upscaler, BiRefNet, Lyria … |
| **Replicate** | Kling, Veo, Hailuo, Seedance, Wan, FLUX, Imagen, Seedream, Nano Banana, Ideogram, OmniHuman, Lipsync-2, Topaz, Recraft … (+ jedes Modell per `owner/name[:version]`) |
| **OpenAI** | GPT-Image-1 (inkl. Masken-Edit), Sora 2 / 2 Pro, GPT-4o-mini-TTS, GPT-5 als Regie & Jury |
| **Google** | Veo 3.1 / 3 (mit Ton, Endframe), Imagen 4 Ultra, Gemini 2.5 Flash Image, Gemini TTS, Gemini 2.5 Pro |
| **Anthropic** | Claude Opus 5.5 / Sonnet 5.5 / Haiku 5.5 / Fable 5.2 als Prompt-Regisseur und Vision-Jury |
| **Runway** | Gen-4 Turbo (Bild→Video), Gen-4 Image mit Referenzen, 4K-Video-Upscale |
| **Luma AI** | Ray 2 / Ray Flash 2 (Start- & Endframe), Photon mit Charakter-Referenz |
| **Stability AI** | Stable Image Ultra/Core, Inpainting, Freistellen, Upscale |
| **Black Forest Labs** | FLUX 1.1 Pro Ultra, FLUX Kontext Pro/Max |
| **ElevenLabs** | Stimmen (v3, Multilingual v2, Flash), Soundeffekte, Musik |
| **Hugging Face** | FLUX Schnell, SDXL, offene Sprachmodelle |
| **OpenRouter** | 300+ Sprachmodelle und Bildmodelle mit einem Schlüssel |
| **Ollama** | Lokale Sprachmodelle (werden automatisch erkannt) |
| **ComfyUI** | Eigene lokale Workflows (API-Format) mit Platzhaltern, damit läuft jedes lokale Modell |
| **OpenAI-kompatibel** | xAI Grok, Mistral, DeepSeek, Groq, Together, Fireworks, Azure, LM Studio, vLLM … |
| **Eigene HTTP-API** | Universeller REST-Adapter mit Body-Vorlage, Ergebnis-Pfad und Polling. Verbindet **jede** KI |
| **Demo** | Offline-Modus ohne Schlüssel. Testet alle Abläufe (Videos via ffmpeg, falls installiert) |

> **Neue Modelle erscheinen ständig.** Unter *Verbindungen → Modelle → Eigenes Modell* fügst du jede Modell-ID hinzu (z. B. `fal-ai/…`, `owner/name` bei Replicate, neue OpenAI-/Google-Modellnamen). Der Smart-Router nutzt das Modell sofort. Qualitäts-Scores lassen sich pro Modell anpassen.

## Schnellstart

Voraussetzung: **Node.js ≥ 20.19**. Optional: **ffmpeg** für Demo-Videos.

```bash
npm install
npm run build
npm start
```

Dann im Browser **http://127.0.0.1:8787** öffnen. Unter **Verbindungen** einen oder mehrere API-Schlüssel eintragen und auf *Speichern & testen* klicken.

Empfohlene Kombination für Top-Ergebnisse:

* **fal.ai**: alle führenden Video-, Bild-, Lipsync- und Upscale-Modelle mit einem Schlüssel
* **Google**: Veo 3.1, Imagen 4, Gemini-Bildbearbeitung
* **Anthropic**: Claude als KI-Regie und Jury
* **ElevenLabs**: Stimmen für Avatare

### Entwicklung

```bash
npm run dev        # API (Auto-Reload) + Vite-Dev-Server auf http://localhost:5173
npm test           # Kern-Tests (Router, Eingabe-Mapping, Vorlagen, Verschlüsselung, Provider-Ablauf)
npm run typecheck  # Typprüfung Server + Oberfläche
```

### Docker

```bash
docker build -t musii-studio .
docker run -p 8787:8787 -v musii-data:/app/data -e APP_PASSWORD=geheim musii-studio
```

## Konfiguration (Umgebungsvariablen)

| Variable | Standard | Bedeutung |
|---|---|---|
| `PORT` | `8787` | Port |
| `HOST` | `127.0.0.1` | `0.0.0.0` für Zugriff im Netzwerk/Server |
| `APP_PASSWORD` | – | Passwortschutz für Oberfläche, API und Medien (dringend empfohlen, wenn öffentlich erreichbar) |
| `PUBLIC_URL` | – | Öffentliche Basis-URL. Dann laden Anbieter Eingabedateien per URL statt Base64 (nötig für Luma-Keyframes, schneller bei großen Videos) |
| `MUSII_DATA_DIR` | `./data` | Speicherort für Datenbank, Medien und Schlüssel |
| `MUSII_SECRET` | – | Eigenes Geheimnis für die Schlüssel-Verschlüsselung (sonst wird `data/.secret` erzeugt) |

## So funktioniert „die besten Ergebnisse“

1. **Smart-Router**: Jedes Modell hat Qualität, Tempo und geschätzte Kosten. Bei *Auto* sortiert der Router alle verbundenen Modelle nach deiner Strategie (*Beste Qualität*, *Ausgewogen*, *Schnellste*, *Günstigste*). Er filtert nach Fähigkeiten wie Endframe, Maske, Referenzbilder, Lipsync-Eingabe oder Ton.
2. **Automatischer Fallback**: Schlägt ein Anbieter fehl (Überlastung, Limit, Filter), übernimmt im selben Auftrag das nächstbeste Modell.
3. **KI-Regie**: Ein Sprachmodell (Claude, GPT, Gemini, Ollama …) schreibt deine Idee in einen präzisen, modellgerechten Prompt um, mit Bildsprache, Licht, Objektiv, Bewegung und Sounddesign. Varianten und *Bild → Prompt* inklusive.
4. **KI-Jury & Best-of-N**: Eine Vision-KI bewertet mehrere Ergebnisse nach Prompt-Treue, Ästhetik und technischen Fehlern und wählt das beste.
5. **Charakter-Konsistenz**: Referenzbilder werden automatisch an Modelle mit Referenz-Unterstützung übergeben.

## Architektur

```
server/            Node.js + Express (TypeScript)
  catalog.ts       Modellkatalog + Smart-Router
  jobs.ts          Warteschlange, Fallback, Arena, Workflows
  llm.ts           KI-Regie, Varianten, Bild→Prompt, KI-Jury
  presets.ts       Kamerafahrten, Effekte, Stile
  providers/       Ein Adapter pro Anbieter + universelle Adapter (HTTP, ComfyUI, OpenAI-kompatibel)
web/               React + Vite Oberfläche
  src/lib/localMotion.ts   Browser-Renderer für Kamerafahrten
data/              (zur Laufzeit) db.json, media/, .secret
```

Live-Updates laufen per Server-Sent Events. Ergebnisse werden lokal gespeichert, damit ablaufende Anbieter-Links egal sind.

## Hinweise

* Die Kosten in der App sind **Schätzungen**. Maßgeblich sind die Abrechnungen der Anbieter.
* Für Claude ist der serverseitige Refusal-Fallback (`fallbacks: "default"`) aktiviert. Lehnt ein Modell eine Anfrage ab, beantwortet ein Ausweichmodell sie im selben Aufruf.
* Nutzungsbedingungen und Inhaltsrichtlinien der jeweiligen Anbieter gelten weiterhin.
