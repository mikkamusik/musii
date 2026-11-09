"""Verbindung vom Agent zum MikkaRemote-Script in Ableton (TCP, JSON Lines)."""
from __future__ import annotations

import asyncio
import json
import logging
import uuid
from pathlib import Path
from typing import Any, Awaitable, Callable, Dict, Optional

log = logging.getLogger("mikka.live")

# Befehle, die an Ableton weitergereicht werden duerfen.
LIVE_COMMANDS = {
    "ping", "state.full",
    "transport.play", "transport.stop", "transport.continue", "transport.tap_tempo",
    "song.set", "song.jump_by", "song.jump_to_cue", "song.toggle_cue", "song.undo",
    "song.redo", "song.stop_all_clips", "song.create_scene",
    "track.set", "track.set_volume_db", "track.stop_clips",
    "clip.fire", "clip.stop", "clip.set", "scene.fire", "scene.set",
    "device.list", "device.params", "device.set_param",
}


class LiveUnavailable(Exception):
    pass


class LiveLink:
    def __init__(self, host: str, port: int, secret_file: Path,
                 on_state: Callable[[str, Any], Awaitable[None]] = None,
                 on_status: Callable[[bool], Awaitable[None]] = None):
        self.host = host
        self.port = port
        self.secret_file = secret_file
        self.on_state = on_state
        self.on_status = on_status
        self.state: Dict[str, Any] = {}
        self.connected = False
        self.live_version: Optional[str] = None
        self.last_error: Optional[str] = None
        self._writer: Optional[asyncio.StreamWriter] = None
        self._pending: Dict[str, asyncio.Future] = {}
        self._task: Optional[asyncio.Task] = None
        self._stopping = False

    def start(self) -> None:
        self._task = asyncio.ensure_future(self._run())

    async def stop(self) -> None:
        self._stopping = True
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):
                pass
        await self._close()

    def _secret(self) -> str:
        try:
            return self.secret_file.read_text().strip()
        except OSError:
            return ""

    async def _run(self) -> None:
        delay = 1.0
        while not self._stopping:
            try:
                await self._session()
                delay = 1.0
            except asyncio.CancelledError:
                raise
            except (OSError, asyncio.IncompleteReadError, LiveUnavailable) as exc:
                msg = str(exc) or exc.__class__.__name__
                if msg != self.last_error:
                    log.info("Ableton nicht erreichbar: %s", msg)
                self.last_error = msg
            except Exception:  # pragma: no cover - unerwartet
                log.exception("Fehler in der Live-Verbindung")
            await self._set_disconnected()
            await asyncio.sleep(delay)
            delay = min(delay * 1.5, 5.0)

    async def _session(self) -> None:
        secret = self._secret()
        if not secret:
            raise LiveUnavailable("live_secret fehlt - ist das MikkaRemote-Script in Ableton aktiv?")
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(self.host, self.port, limit=16 * 1024 * 1024), timeout=3)
        self._writer = writer
        writer.write((json.dumps({"type": "hello", "secret": secret, "protocol": 1}) + "\n").encode())
        await writer.drain()
        line = await asyncio.wait_for(reader.readline(), timeout=3)
        if not line:
            raise LiveUnavailable("Verbindung von Ableton geschlossen (Geheimnis falsch?)")
        hello = json.loads(line)
        if hello.get("type") != "hello_ok":
            raise LiveUnavailable("Anmeldung bei Ableton abgelehnt")
        self.live_version = hello.get("live_version")
        self.connected = True
        self.last_error = None
        log.info("Mit Ableton Live %s verbunden", self.live_version)
        if self.on_status:
            await self.on_status(True)
        while True:
            line = await reader.readline()
            if not line:
                raise LiveUnavailable("Ableton hat die Verbindung beendet")
            try:
                msg = json.loads(line)
            except ValueError:
                continue
            await self._dispatch(msg)

    async def _dispatch(self, msg: Dict[str, Any]) -> None:
        mtype = msg.get("type")
        if mtype == "state":
            section = msg.get("section")
            self.state[section] = msg.get("data")
            if self.on_state:
                await self.on_state(section, msg.get("data"))
        elif mtype == "result":
            fut = self._pending.pop(msg.get("id"), None)
            if fut and not fut.done():
                fut.set_result(msg)

    async def _close(self) -> None:
        if self._writer is not None:
            try:
                self._writer.close()
            except Exception:
                pass
            self._writer = None

    async def _set_disconnected(self) -> None:
        await self._close()
        was = self.connected
        self.connected = False
        # Zustand verwerfen: niemals veraltete Daten als aktuell anzeigen.
        self.state = {}
        for fut in self._pending.values():
            if not fut.done():
                fut.set_exception(LiveUnavailable("Verbindung zu Ableton unterbrochen"))
        self._pending.clear()
        if was and self.on_status:
            await self.on_status(False)

    async def command(self, cmd: str, args: Dict[str, Any] = None, timeout: float = 5.0,
                      noreply: bool = False) -> Dict[str, Any]:
        if cmd not in LIVE_COMMANDS:
            raise ValueError("Befehl nicht erlaubt: %s" % cmd)
        if not self.connected or self._writer is None:
            raise LiveUnavailable("Ableton ist nicht verbunden")
        cid = uuid.uuid4().hex
        payload = {"id": cid, "cmd": cmd, "args": args or {}}
        if noreply:
            payload["noreply"] = True
            self._writer.write((json.dumps(payload) + "\n").encode())
            return {"ok": True, "data": None, "queued": True}
        fut = asyncio.get_event_loop().create_future()
        self._pending[cid] = fut
        self._writer.write((json.dumps(payload) + "\n").encode())
        try:
            await self._writer.drain()
            return await asyncio.wait_for(fut, timeout=timeout)
        except asyncio.TimeoutError:
            raise LiveUnavailable("Ableton hat nicht rechtzeitig geantwortet (Ergebnis unbekannt)")
        finally:
            self._pending.pop(cid, None)
