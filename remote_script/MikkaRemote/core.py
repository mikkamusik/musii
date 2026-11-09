# -*- coding: utf-8 -*-
"""
MIKKA STUDIO REMOTE - Kernlogik des Ableton Remote Scripts.

Dieses Modul hat KEINE Abhaengigkeit zum `Live`-Modul und kann deshalb ausserhalb
von Ableton getestet werden. Alle Zugriffe erfolgen ueber das Live Object Model
(LOM), das Live dem Remote Script als `song`-Objekt uebergibt.

Wichtig:
- Alles laeuft im Haupt-Thread von Live (aus `update_display`, ca. alle 100 ms).
  Es werden keine eigenen Threads gestartet, weil das LOM nicht thread-sicher ist.
- Der TCP-Server lauscht ausschliesslich auf 127.0.0.1. Fernzugriff erfolgt nur
  ueber den Mac Studio Agent.
- Jeder Client muss sich mit einem lokalen Geheimnis (live_secret) anmelden.
"""
from __future__ import absolute_import, print_function, unicode_literals

import errno
import hmac
import json
import os
import re
import socket
import time

PROTOCOL_VERSION = 1
DEFAULT_PORT = 9878
MAX_LINE = 256 * 1024
MAX_OUTBUF = 8 * 1024 * 1024
AUTH_TIMEOUT = 3.0
MAX_COMMANDS_PER_TICK = 64


def secret_path():
    base = os.environ.get("MIKKA_HOME") or os.path.join(os.path.expanduser("~"), ".mikka-studio")
    return os.path.join(base, "live_secret")


def load_or_create_secret(path=None):
    """Liest das lokale Geheimnis oder legt es (0600) an."""
    path = path or secret_path()
    try:
        with open(path, "r") as fh:
            value = fh.read().strip()
            if len(value) >= 32:
                return value
    except (IOError, OSError):
        pass
    directory = os.path.dirname(path)
    if not os.path.isdir(directory):
        os.makedirs(directory, 0o700)
    value = "".join("%02x" % b for b in bytearray(os.urandom(32)))
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        os.write(fd, value.encode("ascii"))
    finally:
        os.close(fd)
    return value


# ---------------------------------------------------------------------------
# Netzwerk: nicht-blockierender Zeilen-Server (JSON Lines)
# ---------------------------------------------------------------------------
class _Client(object):
    def __init__(self, sock, addr):
        self.sock = sock
        self.addr = addr
        self.inbuf = b""
        self.outbuf = b""
        self.authed = False
        self.connected_at = time.time()
        self.closed = False


class LineServer(object):
    def __init__(self, host="127.0.0.1", port=DEFAULT_PORT, log=None):
        self.host = host
        self.port = port
        self.log = log or (lambda msg: None)
        self._sock = None
        self.clients = []
        self._last_bind_attempt = 0.0

    def start(self):
        self._last_bind_attempt = time.time()
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind((self.host, self.port))
            sock.listen(4)
            sock.setblocking(False)
        except Exception:
            sock.close()
            raise
        self._sock = sock
        self.log("MikkaRemote: lausche auf %s:%d" % (self.host, self.port))

    @property
    def listening(self):
        return self._sock is not None

    def ensure_listening(self):
        if self._sock is None and time.time() - self._last_bind_attempt > 5.0:
            try:
                self.start()
            except Exception as exc:  # Port belegt o.ae.
                self.log("MikkaRemote: Port %d nicht verfuegbar: %s" % (self.port, exc))

    def poll(self):
        """Nimmt Verbindungen an, liest Daten und liefert (client, message)-Paare."""
        messages = []
        if self._sock is None:
            return messages
        while True:
            try:
                conn, addr = self._sock.accept()
            except socket.error as exc:
                if exc.args and exc.args[0] in (errno.EAGAIN, errno.EWOULDBLOCK):
                    break
                break
            conn.setblocking(False)
            try:
                conn.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
            except Exception:
                pass
            if len(self.clients) >= 4:
                conn.close()
                continue
            self.clients.append(_Client(conn, addr))
        now = time.time()
        for client in list(self.clients):
            if not client.authed and now - client.connected_at > AUTH_TIMEOUT:
                self.drop(client)
                continue
            while True:
                try:
                    chunk = client.sock.recv(65536)
                except socket.error as exc:
                    if exc.args and exc.args[0] in (errno.EAGAIN, errno.EWOULDBLOCK):
                        break
                    self.drop(client)
                    break
                if not chunk:
                    self.drop(client)
                    break
                client.inbuf += chunk
                if len(client.inbuf) > MAX_LINE and b"\n" not in client.inbuf:
                    self.drop(client)
                    break
            while not client.closed and b"\n" in client.inbuf:
                line, client.inbuf = client.inbuf.split(b"\n", 1)
                line = line.strip()
                if not line:
                    continue
                try:
                    msg = json.loads(line.decode("utf-8"))
                except Exception:
                    continue
                if isinstance(msg, dict):
                    messages.append((client, msg))
        self.flush()
        return messages

    def send(self, client, obj):
        if client.closed:
            return
        data = (json.dumps(obj, separators=(",", ":"), ensure_ascii=False) + "\n").encode("utf-8")
        client.outbuf += data
        if len(client.outbuf) > MAX_OUTBUF:
            self.log("MikkaRemote: Client zu langsam, Verbindung getrennt")
            self.drop(client)

    def broadcast(self, obj):
        for client in self.clients:
            if client.authed:
                self.send(client, obj)

    def flush(self):
        for client in list(self.clients):
            while client.outbuf and not client.closed:
                try:
                    sent = client.sock.send(client.outbuf)
                except socket.error as exc:
                    if exc.args and exc.args[0] in (errno.EAGAIN, errno.EWOULDBLOCK):
                        break
                    self.drop(client)
                    break
                client.outbuf = client.outbuf[sent:]

    def drop(self, client):
        client.closed = True
        try:
            client.sock.close()
        except Exception:
            pass
        if client in self.clients:
            self.clients.remove(client)

    def has_authed_clients(self):
        return any(c.authed for c in self.clients)

    def close(self):
        for client in list(self.clients):
            self.drop(client)
        if self._sock is not None:
            try:
                self._sock.close()
            except Exception:
                pass
            self._sock = None


# ---------------------------------------------------------------------------
# Hilfsfunktionen fuer Parameter
# ---------------------------------------------------------------------------
_DB_RE = re.compile(r"(-?inf|[-+]?\d+(?:[.,]\d+)?)\s*dB", re.IGNORECASE)


def parse_db(text):
    """'-6.0 dB' -> -6.0, '-inf dB' -> float('-inf'); None wenn nicht lesbar."""
    if text is None:
        return None
    m = _DB_RE.search(str(text))
    if not m:
        return None
    raw = m.group(1).lower()
    if raw == "-inf":
        return float("-inf")
    if raw == "inf":
        return float("inf")
    return float(raw.replace(",", "."))


def param_str(param, value=None):
    try:
        if value is None:
            value = param.value
        return u"%s" % param.str_for_value(value)
    except Exception:
        return u""


def value_for_db(param, target_db, iterations=28):
    """
    Ermittelt den internen Parameterwert fuer einen dB-Wert.

    Ableton bildet Lautstaerke nicht linear ab. Statt eine Kurve zu raten, wird
    per Bisektion ueber `str_for_value` gesucht - also exakt mit der Anzeige, die
    Ableton selbst verwendet.
    """
    lo, hi = float(param.min), float(param.max)
    hi_db = parse_db(param_str(param, hi))
    lo_db = parse_db(param_str(param, lo))
    if hi_db is None or lo_db is None:
        raise ValueError("Parameter liefert keine dB-Anzeige")
    if target_db >= hi_db:
        return hi
    if target_db <= lo_db:
        return lo
    for _ in range(iterations):
        mid = (lo + hi) / 2.0
        mid_db = parse_db(param_str(param, mid))
        if mid_db is None:
            break
        if mid_db < target_db:
            lo = mid
        else:
            hi = mid
    # `hi` ist der kleinste gefundene Wert, dessen Anzeige >= Ziel ist
    return hi


def _clamp(param, value):
    value = float(value)
    return max(float(param.min), min(float(param.max), value))


def _r(value, digits=4):
    try:
        return round(float(value), digits)
    except Exception:
        return 0.0


class CommandError(Exception):
    pass


# ---------------------------------------------------------------------------
# Bruecke zum Live Object Model
# ---------------------------------------------------------------------------
class LiveBridge(object):
    """Liest Zustaende aus dem LOM und fuehrt Befehle aus."""

    def __init__(self, song_getter, log=None, app=None, secret=None, port=DEFAULT_PORT,
                 server=None):
        self._song = song_getter
        self.log = log or (lambda msg: None)
        self.app = app
        self.secret = secret if secret is not None else load_or_create_secret()
        self.server = server or LineServer(port=port, log=self.log)
        self._tick = 0
        self._last = {}
        self._handlers = {
            "ping": self._cmd_ping,
            "transport.play": self._cmd_play,
            "transport.stop": self._cmd_stop,
            "transport.continue": self._cmd_continue,
            "transport.tap_tempo": self._cmd_tap_tempo,
            "song.set": self._cmd_song_set,
            "song.jump_by": self._cmd_jump_by,
            "song.jump_to_cue": self._cmd_jump_to_cue,
            "song.toggle_cue": self._cmd_toggle_cue,
            "song.undo": self._cmd_undo,
            "song.redo": self._cmd_redo,
            "song.stop_all_clips": self._cmd_stop_all_clips,
            "song.create_scene": self._cmd_create_scene,
            "track.set": self._cmd_track_set,
            "track.set_volume_db": self._cmd_track_volume_db,
            "track.stop_clips": self._cmd_track_stop_clips,
            "clip.fire": self._cmd_clip_fire,
            "clip.stop": self._cmd_clip_stop,
            "clip.set": self._cmd_clip_set,
            "scene.fire": self._cmd_scene_fire,
            "scene.set": self._cmd_scene_set,
            "device.list": self._cmd_device_list,
            "device.params": self._cmd_device_params,
            "device.set_param": self._cmd_device_set_param,
            "state.full": self._cmd_state_full,
        }

    # -- Lebenszyklus --------------------------------------------------------
    def start(self):
        try:
            self.server.start()
        except Exception as exc:
            self.log("MikkaRemote: Server-Start fehlgeschlagen: %s" % exc)

    def close(self):
        self.server.close()

    @property
    def song(self):
        return self._song()

    def live_version(self):
        try:
            return "%d.%d.%d" % (self.app.get_major_version(), self.app.get_minor_version(),
                                 self.app.get_bugfix_version())
        except Exception:
            return "unbekannt"

    def tick(self):
        """Wird aus update_display aufgerufen (ca. 10x pro Sekunde)."""
        self.server.ensure_listening()
        processed = 0
        for client, msg in self.server.poll():
            if not client.authed:
                self._handle_hello(client, msg)
                continue
            if processed >= MAX_COMMANDS_PER_TICK:
                self.server.send(client, {"type": "result", "id": msg.get("id"), "ok": False,
                                          "error": "Ueberlastet, Befehl verworfen"})
                continue
            processed += 1
            result = self.execute(msg)
            if not msg.get("noreply"):
                self.server.send(client, result)
        if self.server.has_authed_clients():
            self._tick += 1
            self._publish("meters", self.meters())
            if self._tick % 2 == 0:
                self._publish("song", self.song_state())
                self._publish("tracks", self.tracks_state())
            if self._tick % 4 == 1:
                self._publish("scenes", self.scenes_state())
                self._publish("clips", self.clips_state())
        self.server.flush()

    def _handle_hello(self, client, msg):
        secret = msg.get("secret") or ""
        if msg.get("type") != "hello" or not hmac.compare_digest(
                secret.encode("utf-8"), self.secret.encode("utf-8")):
            self.server.send(client, {"type": "error", "error": "auth_failed"})
            self.server.flush()
            self.server.drop(client)
            return
        client.authed = True
        self.server.send(client, {"type": "hello_ok", "protocol": PROTOCOL_VERSION,
                                  "live_version": self.live_version()})
        for name, data in self.full_state().items():
            self.server.send(client, {"type": "state", "section": name, "data": data})

    def _publish(self, section, data):
        try:
            encoded = json.dumps(data, sort_keys=True, separators=(",", ":"))
        except Exception:
            return
        if self._last.get(section) == encoded:
            return
        self._last[section] = encoded
        self.server.broadcast({"type": "state", "section": section, "data": data})

    def full_state(self):
        sections = {
            "song": self.song_state(),
            "tracks": self.tracks_state(),
            "scenes": self.scenes_state(),
            "clips": self.clips_state(),
            "meters": self.meters(),
        }
        for name, data in sections.items():
            self._last[name] = json.dumps(data, sort_keys=True, separators=(",", ":"))
        return sections

    def execute(self, msg):
        cmd = msg.get("cmd")
        args = msg.get("args") or {}
        handler = self._handlers.get(cmd)
        if handler is None:
            return {"type": "result", "id": msg.get("id"), "ok": False,
                    "error": "Unbekannter Befehl: %s" % cmd}
        try:
            data = handler(args)
            return {"type": "result", "id": msg.get("id"), "ok": True, "data": data}
        except CommandError as exc:
            return {"type": "result", "id": msg.get("id"), "ok": False, "error": u"%s" % exc}
        except Exception as exc:  # LOM-Fehler sauber zurueckmelden
            self.log("MikkaRemote: Fehler bei %s: %r" % (cmd, exc))
            return {"type": "result", "id": msg.get("id"), "ok": False,
                    "error": u"Ableton-Fehler: %s" % exc}

    # -- Zustand lesen -------------------------------------------------------
    def song_state(self):
        s = self.song
        state = {
            "tempo": _r(s.tempo, 3),
            "is_playing": bool(s.is_playing),
            "record_mode": bool(s.record_mode),
            "session_record": bool(getattr(s, "session_record", False)),
            "metronome": bool(s.metronome),
            "loop": bool(s.loop),
            "loop_start": _r(s.loop_start, 3),
            "loop_length": _r(s.loop_length, 3),
            "signature_numerator": int(s.signature_numerator),
            "signature_denominator": int(s.signature_denominator),
            "position": _r(s.current_song_time, 2),
            "song_length": _r(getattr(s, "song_length", 0.0), 2),
            "can_undo": bool(getattr(s, "can_undo", False)),
            "can_redo": bool(getattr(s, "can_redo", False)),
            "overdub": bool(getattr(s, "arrangement_overdub", False)),
            "quantization": int(getattr(s, "clip_trigger_quantization", 0)),
            "cue_points": [],
        }
        try:
            cues = sorted(s.cue_points, key=lambda c: c.time)
            state["cue_points"] = [{"name": u"%s" % c.name, "time": _r(c.time, 3)} for c in cues]
        except Exception:
            pass
        return state

    def _mixer(self, track, kind):
        md = track.mixer_device
        info = {
            "volume": _r(md.volume.value),
            "volume_str": param_str(md.volume),
            "pan": _r(md.panning.value),
            "pan_str": param_str(md.panning),
            "sends": [],
        }
        if kind != "master":
            info["sends"] = [{"value": _r(p.value), "str": param_str(p)} for p in md.sends]
        return info

    def _track_info(self, track, kind, index, group_lookup=None):
        info = {
            "kind": kind,
            "index": index,
            "name": u"%s" % track.name,
            "color": int(getattr(track, "color", 0) or 0),
        }
        info.update(self._mixer(track, kind))
        if kind != "master":
            info["mute"] = bool(track.mute)
            info["solo"] = bool(track.solo)
        if kind == "track":
            info["type"] = ("group" if track.is_foldable else
                            "midi" if track.has_midi_input else "audio")
            info["can_arm"] = bool(track.can_be_armed)
            info["arm"] = bool(track.arm) if track.can_be_armed else False
            info["is_grouped"] = bool(getattr(track, "is_grouped", False))
            info["group"] = None
            info["fold_state"] = bool(track.fold_state) if track.is_foldable else False
            info["visible"] = bool(getattr(track, "is_visible", True))
            if info["is_grouped"] and group_lookup is not None:
                try:
                    info["group"] = group_lookup.get(track.group_track._live_ptr)
                except Exception:
                    info["group"] = None
        try:
            info["devices"] = [u"%s" % d.name for d in track.devices]
        except Exception:
            info["devices"] = []
        return info

    def tracks_state(self):
        s = self.song
        tracks = list(s.tracks)
        group_lookup = {}
        for i, t in enumerate(tracks):
            try:
                group_lookup[t._live_ptr] = i
            except Exception:
                pass
        return {
            "tracks": [self._track_info(t, "track", i, group_lookup) for i, t in enumerate(tracks)],
            "returns": [self._track_info(t, "return", i) for i, t in enumerate(s.return_tracks)],
            "master": self._track_info(s.master_track, "master", 0),
        }

    def meters(self):
        s = self.song

        def m(t):
            try:
                if not t.has_audio_output:
                    return [0, 0]
                return [_r(t.output_meter_left, 2), _r(t.output_meter_right, 2)]
            except Exception:
                return [0, 0]
        return {
            "tracks": [m(t) for t in s.tracks],
            "returns": [m(t) for t in s.return_tracks],
            "master": m(s.master_track),
        }

    def scenes_state(self):
        result = []
        for i, sc in enumerate(self.song.scenes):
            result.append({"index": i, "name": u"%s" % sc.name,
                           "color": int(getattr(sc, "color", 0) or 0),
                           "triggered": bool(getattr(sc, "is_triggered", False))})
        return result

    def clips_state(self):
        grid = []
        for t in self.song.tracks:
            column = []
            for slot in t.clip_slots:
                if slot.has_clip:
                    c = slot.clip
                    st = 0
                    if getattr(c, "is_recording", False):
                        st = 3
                    elif c.is_playing:
                        st = 1
                    elif c.is_triggered:
                        st = 2
                    column.append([u"%s" % c.name, int(c.color), st,
                                   1 if c.is_audio_clip else 0, 1 if c.looping else 0])
                else:
                    column.append(None if slot.has_stop_button else 0)
            grid.append(column)
        return grid

    # -- Referenzen auflösen -------------------------------------------------
    def resolve_track(self, ref):
        if not isinstance(ref, dict):
            raise CommandError("Ungueltige Spurreferenz")
        kind = ref.get("kind", "track")
        s = self.song
        if kind == "master":
            return s.master_track, "master"
        idx = ref.get("index")
        if not isinstance(idx, int):
            raise CommandError("Spurindex fehlt")
        seq = list(s.tracks) if kind == "track" else list(s.return_tracks) if kind == "return" else None
        if seq is None:
            raise CommandError("Unbekannter Spurtyp: %s" % kind)
        if idx < 0 or idx >= len(seq):
            raise CommandError("Spur %d existiert nicht" % idx)
        track = seq[idx]
        expect = ref.get("name")
        if expect is not None and u"%s" % track.name != expect:
            raise CommandError(u"Spur %d heisst inzwischen '%s' (erwartet '%s'). Bitte Ansicht aktualisieren."
                               % (idx, track.name, expect))
        return track, kind

    def resolve_device(self, track, path):
        if not isinstance(path, list) or not path:
            raise CommandError("Geraetepfad fehlt")
        container = track
        device = None
        items = list(path)
        while items:
            d_idx = items.pop(0)
            devices = list(container.devices)
            if not isinstance(d_idx, int) or d_idx < 0 or d_idx >= len(devices):
                raise CommandError("Geraet existiert nicht")
            device = devices[d_idx]
            if items:
                c_idx = items.pop(0)
                chains = list(getattr(device, "chains", []))
                if not isinstance(c_idx, int) or c_idx < 0 or c_idx >= len(chains):
                    raise CommandError("Kette existiert nicht")
                container = chains[c_idx]
                if not items:
                    raise CommandError("Pfad endet auf einer Kette")
        return device

    # -- Befehle -------------------------------------------------------------
    def _cmd_ping(self, args):
        return {"pong": True, "live_version": self.live_version()}

    def _cmd_state_full(self, args):
        return self.full_state()

    def _cmd_play(self, args):
        self.song.start_playing()
        return {"is_playing": True}

    def _cmd_stop(self, args):
        self.song.stop_playing()
        return {"stopped": True}

    def _cmd_continue(self, args):
        self.song.continue_playing()
        return {"continued": True}

    def _cmd_tap_tempo(self, args):
        self.song.tap_tempo()
        return {"tempo": _r(self.song.tempo, 3)}

    _SONG_FIELDS = {
        "tempo": (float, 20.0, 999.0),
        "metronome": (bool, None, None),
        "loop": (bool, None, None),
        "loop_start": (float, 0.0, None),
        "loop_length": (float, 0.25, None),
        "signature_numerator": (int, 1, 99),
        "signature_denominator": (int, 1, 16),
        "record_mode": (bool, None, None),
        "session_record": (bool, None, None),
        "position": (float, 0.0, None),
        "overdub": (bool, None, None),
        "quantization": (int, 0, 13),
    }
    _SONG_ATTR = {"position": "current_song_time", "overdub": "arrangement_overdub",
                  "quantization": "clip_trigger_quantization"}

    def _cmd_song_set(self, args):
        s = self.song
        applied = {}
        for key, value in args.items():
            spec = self._SONG_FIELDS.get(key)
            if spec is None:
                raise CommandError("Unbekannte Song-Eigenschaft: %s" % key)
            typ, lo, hi = spec
            try:
                value = typ(value)
            except Exception:
                raise CommandError("Ungueltiger Wert fuer %s" % key)
            if typ is not bool:
                if lo is not None and value < lo:
                    raise CommandError("%s zu klein" % key)
                if hi is not None and value > hi:
                    raise CommandError("%s zu gross" % key)
            if key == "signature_denominator" and value not in (1, 2, 4, 8, 16):
                raise CommandError("Nenner muss 1, 2, 4, 8 oder 16 sein")
            attr = self._SONG_ATTR.get(key, key)
            setattr(s, attr, value)
            applied[key] = getattr(s, attr)
        # Rueckgelesene Werte = Bestaetigung durch Ableton
        return {k: (_r(v, 3) if isinstance(v, float) else v) for k, v in applied.items()}

    def _cmd_jump_by(self, args):
        beats = float(args.get("beats", 0))
        s = self.song
        s.current_song_time = max(0.0, s.current_song_time + beats)
        return {"position": _r(s.current_song_time, 3)}

    def _cmd_jump_to_cue(self, args):
        cues = sorted(self.song.cue_points, key=lambda c: c.time)
        idx = args.get("index")
        if not isinstance(idx, int) or idx < 0 or idx >= len(cues):
            raise CommandError("Marker existiert nicht")
        cues[idx].jump()
        return {"time": _r(cues[idx].time, 3)}

    def _cmd_toggle_cue(self, args):
        self.song.set_or_delete_cue()
        return {"count": len(self.song.cue_points)}

    def _cmd_undo(self, args):
        if not self.song.can_undo:
            raise CommandError("Nichts zum Rueckgaengigmachen")
        self.song.undo()
        return {"undone": True}

    def _cmd_redo(self, args):
        if not self.song.can_redo:
            raise CommandError("Nichts zum Wiederherstellen")
        self.song.redo()
        return {"redone": True}

    def _cmd_stop_all_clips(self, args):
        self.song.stop_all_clips()
        return {"stopped": True}

    def _cmd_create_scene(self, args):
        idx = args.get("index", -1)
        if not isinstance(idx, int):
            raise CommandError("Ungueltiger Szenenindex")
        self.song.create_scene(idx)
        return {"scenes": len(self.song.scenes)}

    def _cmd_track_set(self, args):
        track, kind = self.resolve_track(args.get("track"))
        md = track.mixer_device
        out = {}
        if "volume" in args:
            md.volume.value = _clamp(md.volume, args["volume"])
            out["volume"] = _r(md.volume.value)
            out["volume_str"] = param_str(md.volume)
        if "pan" in args:
            md.panning.value = _clamp(md.panning, args["pan"])
            out["pan"] = _r(md.panning.value)
            out["pan_str"] = param_str(md.panning)
        if "send" in args:
            send = args["send"] or {}
            if kind == "master":
                raise CommandError("Master hat keine Sends")
            sends = list(md.sends)
            si = send.get("index")
            if not isinstance(si, int) or si < 0 or si >= len(sends):
                raise CommandError("Send existiert nicht")
            sends[si].value = _clamp(sends[si], send.get("value", 0))
            out["send"] = {"index": si, "value": _r(sends[si].value), "str": param_str(sends[si])}
        for flag in ("mute", "solo"):
            if flag in args:
                if kind == "master":
                    raise CommandError("Master unterstuetzt %s nicht" % flag)
                setattr(track, flag, bool(args[flag]))
                out[flag] = bool(getattr(track, flag))
        if "arm" in args:
            if kind != "track" or not track.can_be_armed:
                raise CommandError("Spur kann nicht scharfgeschaltet werden")
            track.arm = bool(args["arm"])
            out["arm"] = bool(track.arm)
        if "name" in args:
            name = u"%s" % args["name"]
            if not name.strip() or len(name) > 128:
                raise CommandError("Ungueltiger Name")
            track.name = name
            out["name"] = u"%s" % track.name
        if "color" in args:
            track.color = int(args["color"]) & 0xFFFFFF
            out["color"] = int(track.color)
        if "fold" in args:
            if kind == "track" and track.is_foldable:
                track.fold_state = bool(args["fold"])
                out["fold"] = bool(track.fold_state)
        if not out:
            raise CommandError("Keine Aenderung angegeben")
        return out

    def _cmd_track_volume_db(self, args):
        track, kind = self.resolve_track(args.get("track"))
        try:
            db = float(args.get("db"))
        except Exception:
            raise CommandError("dB-Wert fehlt")
        if db > 6.0:
            raise CommandError("Maximal +6 dB moeglich")
        vol = track.mixer_device.volume
        before = param_str(vol)
        vol.value = value_for_db(vol, db)
        return {"before_str": before, "volume": _r(vol.value), "volume_str": param_str(vol),
                "db": parse_db(param_str(vol))}

    def _cmd_track_stop_clips(self, args):
        track, kind = self.resolve_track(args.get("track"))
        if kind != "track":
            raise CommandError("Nur normale Spuren haben Clips")
        track.stop_all_clips()
        return {"stopped": True}

    def _slot(self, args):
        track, kind = self.resolve_track({"kind": "track", "index": args.get("track"),
                                          "name": args.get("name")})
        slots = list(track.clip_slots)
        si = args.get("scene")
        if not isinstance(si, int) or si < 0 or si >= len(slots):
            raise CommandError("Clip-Slot existiert nicht")
        return track, slots[si]

    def _cmd_clip_fire(self, args):
        track, slot = self._slot(args)
        if not slot.has_clip and not (track.can_be_armed and track.arm):
            raise CommandError("Leerer Slot: Spur zum Aufnehmen erst scharfschalten")
        slot.fire()
        return {"fired": True, "recording": not slot.has_clip}

    def _cmd_clip_stop(self, args):
        track, slot = self._slot(args)
        slot.stop()
        return {"stopped": True}

    def _cmd_clip_set(self, args):
        track, slot = self._slot(args)
        if not slot.has_clip:
            raise CommandError("Kein Clip im Slot")
        clip = slot.clip
        out = {}
        if "name" in args:
            clip.name = u"%s" % args["name"]
            out["name"] = u"%s" % clip.name
        if "color" in args:
            clip.color = int(args["color"]) & 0xFFFFFF
            out["color"] = int(clip.color)
        if "looping" in args:
            clip.looping = bool(args["looping"])
            out["looping"] = bool(clip.looping)
        if not out:
            raise CommandError("Keine Aenderung angegeben")
        return out

    def _cmd_scene_fire(self, args):
        scenes = list(self.song.scenes)
        idx = args.get("scene")
        if not isinstance(idx, int) or idx < 0 or idx >= len(scenes):
            raise CommandError("Szene existiert nicht")
        scenes[idx].fire()
        return {"fired": idx}

    def _cmd_scene_set(self, args):
        scenes = list(self.song.scenes)
        idx = args.get("scene")
        if not isinstance(idx, int) or idx < 0 or idx >= len(scenes):
            raise CommandError("Szene existiert nicht")
        out = {}
        if "name" in args:
            scenes[idx].name = u"%s" % args["name"]
            out["name"] = u"%s" % scenes[idx].name
        if "color" in args:
            scenes[idx].color = int(args["color"]) & 0xFFFFFF
            out["color"] = int(scenes[idx].color)
        return out

    def _device_tree(self, container, depth):
        result = []
        for i, d in enumerate(container.devices):
            item = {
                "index": i,
                "name": u"%s" % d.name,
                "class_name": u"%s" % getattr(d, "class_name", ""),
                "type": int(getattr(d, "type", 0)),
                "is_active": bool(getattr(d, "is_active", True)),
                "can_have_chains": bool(getattr(d, "can_have_chains", False)),
                "can_have_drum_pads": bool(getattr(d, "can_have_drum_pads", False)),
                "chains": [],
            }
            if item["can_have_chains"] and depth < 3:
                for ci, chain in enumerate(d.chains):
                    item["chains"].append({"index": ci, "name": u"%s" % chain.name,
                                           "devices": self._device_tree(chain, depth + 1)})
            result.append(item)
        return result

    def _cmd_device_list(self, args):
        track, kind = self.resolve_track(args.get("track"))
        return {"devices": self._device_tree(track, 0)}

    def _param_info(self, i, p):
        info = {
            "index": i,
            "name": u"%s" % p.name,
            "value": _r(p.value, 5),
            "min": _r(p.min, 5),
            "max": _r(p.max, 5),
            "str": param_str(p),
            "quantized": bool(getattr(p, "is_quantized", False)),
            "enabled": bool(getattr(p, "is_enabled", True)),
        }
        if info["quantized"]:
            try:
                info["items"] = [u"%s" % v for v in p.value_items]
            except Exception:
                info["items"] = []
        return info

    def _cmd_device_params(self, args):
        track, kind = self.resolve_track(args.get("track"))
        device = self.resolve_device(track, args.get("path"))
        return {"name": u"%s" % device.name,
                "class_name": u"%s" % getattr(device, "class_name", ""),
                "parameters": [self._param_info(i, p) for i, p in enumerate(device.parameters)]}

    def _cmd_device_set_param(self, args):
        track, kind = self.resolve_track(args.get("track"))
        device = self.resolve_device(track, args.get("path"))
        params = list(device.parameters)
        pi = args.get("param")
        if not isinstance(pi, int) or pi < 0 or pi >= len(params):
            raise CommandError("Parameter existiert nicht")
        p = params[pi]
        if not getattr(p, "is_enabled", True):
            raise CommandError("Parameter ist in Ableton gesperrt (z.B. durch Automation/Makro)")
        value = _clamp(p, args.get("value", p.value))
        if getattr(p, "is_quantized", False):
            value = float(int(round(value)))
        p.value = value
        return {"param": pi, "value": _r(p.value, 5), "str": param_str(p)}
