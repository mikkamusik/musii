# Protokoll

## App ↔ Agent (WebSocket `/api/ws`, JSON)

1. App → `{"type":"auth","token":"…"}`
2. Agent → `{"type":"welcome","device":{…},"features":{…}}`, danach `status` und alle `state`-Abschnitte.
3. Befehl: `{"type":"cmd","id":"<eindeutig, 8–64 Zeichen>","cmd":"song.set","args":{"tempo":145}}`
   Antwort: `{"type":"result","id":"…","ok":true,"data":{"tempo":145.0}}` – `data` enthält den von Ableton
   **zurückgelesenen** Wert. Mit `"noreply":true` (für Fader-Bewegungen) entfällt die Antwort.
4. Laufend: `{"type":"state","section":"song|tracks|scenes|clips|meters","data":…}`, `status`, `state_reset`.
5. `{"type":"ping","t":…}` → `{"type":"pong","t":…}` (Latenzanzeige).

### Ableton-Befehle (an das Remote Script weitergereicht)

| Befehl | Argumente |
|---|---|
| `transport.play` / `.stop` / `.continue` / `.tap_tempo` | – |
| `song.set` | `tempo`, `metronome`, `loop`, `loop_start`, `loop_length`, `signature_numerator`, `signature_denominator`, `record_mode`, `session_record`, `position`, `overdub`, `quantization` |
| `song.jump_by` | `beats` |
| `song.jump_to_cue` | `index` (nach Zeit sortiert) |
| `song.toggle_cue`, `song.undo`, `song.redo`, `song.stop_all_clips` | – |
| `song.create_scene` | `index` (-1 = am Ende) |
| `track.set` | `track` (Ref), `volume`, `pan`, `send:{index,value}`, `mute`, `solo`, `arm`, `name`, `color`, `fold` |
| `track.set_volume_db` | `track`, `db` (≤ +6) |
| `track.stop_clips` | `track` |
| `clip.fire` / `clip.stop` / `clip.set` | `track` (Index), `scene`, optional `name` (Spurname zur Absicherung), `clip.set`: `name`, `color`, `looping` |
| `scene.fire` / `scene.set` | `scene`, `name`, `color` |
| `device.list` | `track` |
| `device.params` | `track`, `path` ([Gerät, Kette, Gerät, …]) |
| `device.set_param` | `track`, `path`, `param`, `value` |

Spur-Referenz: `{"kind":"track|return|master","index":n,"name":"…"}` – stimmt der Name nicht mehr, wird abgelehnt.

### Agent-Befehle

`agent.status`, `devices.list`, `devices.revoke`, `exports.list`, `exports.analyze`, `exports.analyze_latest`,
`exports.convert` (`name`, `format`: wav24|wav32f|flac|mp3, `sample_rate`), `exports.ticket` (`name`, `inline`),
`audio.ticket` (`quality`: low|medium|high), `keys.send` (`shortcut`: save|save_as|export_audio|toggle_view),
`assistant.plan` (`text`), `assistant.execute` (`actions`, `input`), `history.list`.

## Agent ↔ Remote Script (TCP 127.0.0.1:9878, JSON Lines)

`{"type":"hello","secret":"…","protocol":1}` → `{"type":"hello_ok","live_version":"12.4.6"}` + vollständiger Zustand.
Danach dieselben `cmd`-/`result`-/`state`-Nachrichten wie oben (ohne `type` bei Befehlen).
