"""HTTP/WebSocket-Server des Mac Studio Agents."""
from __future__ import annotations

import asyncio
import collections
import json
import logging
import sys
import time
from functools import partial
from pathlib import Path
from typing import Any, Dict, Optional, Set

from aiohttp import WSMsgType, web

from . import __version__, assistant, keystrokes, media
from .audio import QUALITY, AudioStreamer
from .config import Config
from .live_link import LIVE_COMMANDS, LiveLink, LiveUnavailable
from .security import DeviceStore, PairingManager, RateLimiter, TicketStore

log = logging.getLogger("mikka.server")
WEB_DIR = Path(__file__).resolve().parent.parent / "web"

SECURITY_HEADERS = {
    "Content-Security-Policy": ("default-src 'self'; connect-src 'self'; media-src 'self' blob:; "
                                "img-src 'self' data:; style-src 'self'; script-src 'self'; "
                                "frame-ancestors 'none'; base-uri 'none'; form-action 'none'"),
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), geolocation=(), microphone=(self)",
}


class ClientSession:
    def __init__(self, ws: web.WebSocketResponse, device: Dict[str, Any]):
        self.ws = ws
        self.device = device
        self.queue: "asyncio.Queue[Optional[str]]" = asyncio.Queue(maxsize=512)
        self.connected_at = time.time()


class ResultCache:
    """Schutz vor doppelter Befehlsausfuehrung (gleiche Befehls-ID)."""

    def __init__(self, size: int = 4096):
        self.size = size
        self._data: "collections.OrderedDict[str, Any]" = collections.OrderedDict()

    def get(self, key: str) -> Any:
        return self._data.get(key)

    def put(self, key: str, value: Any) -> None:
        self._data[key] = value
        self._data.move_to_end(key)
        while len(self._data) > self.size:
            self._data.popitem(last=False)

    def __contains__(self, key: str) -> bool:
        return key in self._data


class StudioAgent:
    def __init__(self, cfg: Config, live: Optional[LiveLink] = None):
        self.cfg = cfg
        self.devices = DeviceStore(cfg.home, cfg.device_inactivity_days)
        self.pairing = PairingManager(cfg.home)
        self.tickets = TicketStore()
        self.pair_limit = RateLimiter(10, 300)
        self.results = ResultCache()
        self.clients: Set[ClientSession] = set()
        self.audio = AudioStreamer(cfg.ffmpeg, cfg.audio_input, cfg.audio_max_streams)
        self.live = live or LiveLink(cfg.live_host, cfg.live_port, cfg.home / "live_secret")
        self.live.on_state = self._on_live_state
        self.live.on_status = self._on_live_status
        self.history_path = cfg.home / "history.jsonl"
        self.ableton_running: Optional[bool] = None
        self._bg: list = []

    # -- Lebenszyklus --------------------------------------------------------
    def build_app(self) -> web.Application:
        app = web.Application(middlewares=[self._headers_mw], client_max_size=64 * 1024)
        app.router.add_get("/", self.index)
        app.router.add_get("/manifest.webmanifest", self.static_file)
        app.router.add_get("/sw.js", self.static_file)
        app.router.add_static("/assets", str(WEB_DIR / "assets"), show_index=False)
        app.router.add_post("/api/pair", self.api_pair)
        app.router.add_get("/api/ws", self.api_ws)
        app.router.add_get("/api/health", self.api_health)
        app.router.add_get("/api/download", self.api_download)
        app.router.add_get("/api/audio", self.api_audio)
        app.on_startup.append(self._startup)
        app.on_shutdown.append(self._shutdown)
        return app

    async def _startup(self, app: web.Application) -> None:
        self.live.start()
        self._bg.append(asyncio.ensure_future(self._watch_ableton()))

    async def _shutdown(self, app: web.Application) -> None:
        for task in self._bg:
            task.cancel()
        await self.audio.stop_all()
        for client in list(self.clients):
            await client.ws.close(code=1001, message=b"Agent wird beendet")
        await self.live.stop()

    @web.middleware
    async def _headers_mw(self, request: web.Request, handler):
        resp = await handler(request)
        for k, v in SECURITY_HEADERS.items():
            resp.headers.setdefault(k, v)
        if request.path.startswith("/api/"):
            resp.headers.setdefault("Cache-Control", "no-store")
        return resp

    async def _watch_ableton(self) -> None:
        """Prueft, ob der Prozess 'Live' laeuft (nur macOS), alle 5 s."""
        if sys.platform != "darwin":
            return
        while True:
            try:
                proc = await asyncio.create_subprocess_exec(
                    "pgrep", "-x", "Live", stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.DEVNULL)
                out, _ = await proc.communicate()
                running = bool(out.strip())
                if running != self.ableton_running:
                    self.ableton_running = running
                    await self.broadcast(self.status_message())
            except Exception:
                pass
            await asyncio.sleep(5)

    # -- Status / Broadcast ---------------------------------------------------
    def status_message(self) -> Dict[str, Any]:
        return {"type": "status", "live_connected": self.live.connected,
                "live_version": self.live.live_version, "live_error": self.live.last_error,
                "ableton_running": self.ableton_running, "clients": len(self.clients),
                "audio_streams": self.audio.count, "agent_version": __version__,
                "time": time.time()}

    async def broadcast(self, msg: Dict[str, Any]) -> None:
        data = json.dumps(msg, separators=(",", ":"), ensure_ascii=False)
        for client in list(self.clients):
            self._enqueue(client, data, droppable=msg.get("section") == "meters")

    def _enqueue(self, client: ClientSession, data: str, droppable: bool = False) -> None:
        try:
            client.queue.put_nowait(data)
        except asyncio.QueueFull:
            if droppable:
                return
            # Client haengt: Verbindung schliessen, er laedt den Zustand neu.
            asyncio.ensure_future(client.ws.close(code=4008, message=b"zu langsam"))

    async def _on_live_state(self, section: str, data: Any) -> None:
        await self.broadcast({"type": "state", "section": section, "data": data})

    async def _on_live_status(self, connected: bool) -> None:
        await self.broadcast(self.status_message())
        if not connected:
            await self.broadcast({"type": "state_reset"})

    # -- HTTP -----------------------------------------------------------------
    async def index(self, request: web.Request) -> web.StreamResponse:
        return web.FileResponse(WEB_DIR / "index.html", headers={"Cache-Control": "no-cache"})

    async def static_file(self, request: web.Request) -> web.StreamResponse:
        name = request.path.lstrip("/")
        ctype = "application/manifest+json" if name.endswith(".webmanifest") else "text/javascript"
        return web.FileResponse(WEB_DIR / name, headers={"Cache-Control": "no-cache",
                                                         "Content-Type": ctype})

    async def api_health(self, request: web.Request) -> web.Response:
        return web.json_response({"ok": True, "agent": "mikka-studio-remote"})

    def _client_ip(self, request: web.Request) -> str:
        return request.remote or "?"

    async def api_pair(self, request: web.Request) -> web.Response:
        ip = self._client_ip(request)
        if not self.pair_limit.allow(ip) or not self.pair_limit.allow("global"):
            return web.json_response({"ok": False, "error": "Zu viele Versuche. Bitte spaeter erneut."},
                                     status=429)
        try:
            body = await request.json()
        except Exception:
            return web.json_response({"ok": False, "error": "Ungueltige Anfrage"}, status=400)
        code = str(body.get("code", "")).strip().replace(" ", "")
        if not self.pairing.consume(code):
            await asyncio.sleep(1.0)  # bremst Rateversuche
            return web.json_response({"ok": False, "error": "Code ungueltig oder abgelaufen. "
                                      "Neuen Code am Mac erzeugen: ./scripts/pair.sh"}, status=403)
        dev = self.devices.register(str(body.get("name", "Smartphone")))
        log.info("Neues Geraet gekoppelt: %s (%s)", dev["name"], dev["device_id"])
        return web.json_response({"ok": True, **dev})

    async def api_download(self, request: web.Request) -> web.StreamResponse:
        item = self.tickets.consume(request.query.get("ticket"), "download")
        if not item or not self.devices.is_active(item["device_id"]):
            raise web.HTTPForbidden(text="Ticket ungueltig oder abgelaufen")
        try:
            path = media.safe_path(self.cfg.exports_path, item["payload"]["name"])
        except media.MediaError as exc:
            raise web.HTTPNotFound(text=str(exc))
        disposition = "inline" if item["payload"].get("inline") else "attachment"
        return web.FileResponse(path, headers={
            "Content-Disposition": '%s; filename="%s"' % (disposition, path.name.replace('"', "")),
            "Cache-Control": "no-store"})

    async def api_audio(self, request: web.Request) -> web.StreamResponse:
        item = self.tickets.consume(request.query.get("ticket"), "audio")
        if not item or not self.devices.is_active(item["device_id"]):
            raise web.HTTPForbidden(text="Ticket ungueltig oder abgelaufen")
        quality = item["payload"].get("quality", "medium")
        if self.audio.count >= self.audio.max_streams:
            raise web.HTTPServiceUnavailable(text="Zu viele Audio-Streams")
        resp = web.StreamResponse(headers={"Content-Type": "audio/webm",
                                           "Cache-Control": "no-store",
                                           "X-Accel-Buffering": "no"})
        await resp.prepare(request)
        await self.broadcast(self.status_message())
        try:
            await self.audio.stream(quality, resp.write)
        except (ConnectionResetError, asyncio.CancelledError):
            pass
        except Exception as exc:
            log.warning("Audio-Stream-Fehler: %s", exc)
        finally:
            asyncio.ensure_future(self.broadcast(self.status_message()))
        return resp

    # -- WebSocket --------------------------------------------------------------
    async def api_ws(self, request: web.Request) -> web.WebSocketResponse:
        ws = web.WebSocketResponse(heartbeat=20, max_msg_size=256 * 1024)
        await ws.prepare(request)
        device = None
        try:
            msg = await ws.receive(timeout=10)
            if msg.type == WSMsgType.TEXT:
                data = json.loads(msg.data)
                if data.get("type") == "auth":
                    device = self.devices.verify(data.get("token"))
        except (asyncio.TimeoutError, ValueError):
            device = None
        if device is None:
            await ws.send_json({"type": "auth_failed",
                                "error": "Geraet nicht (mehr) freigegeben. Bitte neu koppeln."})
            await ws.close(code=4401, message=b"unauthorized")
            return ws
        client = ClientSession(ws, device)
        self.clients.add(client)
        sender = asyncio.ensure_future(self._sender(client))
        log.info("Geraet verbunden: %s", device["name"])
        try:
            await ws.send_json({"type": "welcome", "device": {"id": device["id"], "name": device["name"]},
                                "agent_version": __version__,
                                "features": self.features()})
            self._enqueue(client, json.dumps(self.status_message()))
            for section, data in list(self.live.state.items()):
                self._enqueue(client, json.dumps({"type": "state", "section": section, "data": data}))
            await self.broadcast(self.status_message())
            async for msg in ws:
                if msg.type != WSMsgType.TEXT:
                    continue
                if not self.devices.is_active(device["id"]):
                    await ws.close(code=4401, message=b"revoked")
                    break
                try:
                    data = json.loads(msg.data)
                except ValueError:
                    continue
                if data.get("type") == "ping":
                    self._enqueue(client, json.dumps({"type": "pong", "t": data.get("t")}))
                elif data.get("type") == "cmd":
                    asyncio.ensure_future(self._handle_cmd(client, data))
        finally:
            self.clients.discard(client)
            client.queue.put_nowait(None) if not client.queue.full() else None
            sender.cancel()
            log.info("Geraet getrennt: %s", device["name"])
            await self.broadcast(self.status_message())
        return ws

    async def _sender(self, client: ClientSession) -> None:
        try:
            while True:
                data = await client.queue.get()
                if data is None or client.ws.closed:
                    break
                await client.ws.send_str(data)
        except (ConnectionResetError, asyncio.CancelledError):
            pass
        except Exception:
            pass

    def features(self) -> Dict[str, Any]:
        return {
            "keystrokes": bool(self.cfg.allow_keystrokes),
            "shortcuts": {k: v["label"] for k, v in keystrokes.SHORTCUTS.items()},
            "audio_quality": {k: v["label"] for k, v in QUALITY.items()},
            "export_formats": {k: v["label"] for k, v in media.FORMATS.items()},
            "ffmpeg": media.ffmpeg_available(self.cfg.ffmpeg),
            "remote_desktop_host": self.cfg.remote_desktop_host,
        }

    async def _handle_cmd(self, client: ClientSession, data: Dict[str, Any]) -> None:
        cid = data.get("id")
        noreply = bool(data.get("noreply"))
        if not isinstance(cid, str) or not 8 <= len(cid) <= 64:
            self._enqueue(client, json.dumps({"type": "result", "id": cid, "ok": False,
                                              "error": "Befehls-ID fehlt"}))
            return
        key = "%s:%s" % (client.device["id"], cid)
        if key in self.results:
            cached = self.results.get(key)
            if cached is not None and not noreply:
                self._enqueue(client, json.dumps(dict(cached, duplicate=True)))
            return
        self.results.put(key, None)  # als "in Bearbeitung" markieren
        cmd = data.get("cmd")
        args = data.get("args") or {}
        try:
            if not isinstance(args, dict):
                raise ValueError("args muss ein Objekt sein")
            if cmd in LIVE_COMMANDS:
                res = await self.live.command(cmd, args, noreply=noreply)
                result = {"ok": bool(res.get("ok")), "data": res.get("data"), "error": res.get("error")}
            else:
                result = await self._agent_cmd(client, cmd, args)
        except LiveUnavailable as exc:
            result = {"ok": False, "error": str(exc)}
        except (ValueError, media.MediaError, keystrokes.KeystrokeError) as exc:
            result = {"ok": False, "error": str(exc)}
        except Exception as exc:  # pragma: no cover
            log.exception("Befehl %s fehlgeschlagen", cmd)
            result = {"ok": False, "error": "Interner Fehler: %s" % exc}
        message = {"type": "result", "id": cid, **result}
        self.results.put(key, message)
        if not noreply:
            self._enqueue(client, json.dumps(message, ensure_ascii=False))

    async def _run_blocking(self, fn, *args):
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, partial(fn, *args))

    async def _agent_cmd(self, client: ClientSession, cmd: str, args: Dict[str, Any]) -> Dict[str, Any]:
        dev = client.device
        if cmd == "agent.status":
            return {"ok": True, "data": self.status_message()}
        if cmd == "devices.list":
            return {"ok": True, "data": {"devices": self.devices.list(), "self": dev["id"]}}
        if cmd == "devices.revoke":
            ok = self.devices.revoke(str(args.get("id")))
            for c in list(self.clients):
                if c.device["id"] == args.get("id"):
                    asyncio.ensure_future(c.ws.close(code=4401, message=b"revoked"))
            return {"ok": ok, "error": None if ok else "Geraet nicht gefunden"}
        if cmd == "exports.list":
            items = await self._run_blocking(media.list_exports, self.cfg.exports_path)
            return {"ok": True, "data": {"files": items, "dir": str(self.cfg.exports_path)}}
        if cmd == "exports.analyze":
            path = media.safe_path(self.cfg.exports_path, args.get("name"))
            return {"ok": True, "data": await self._run_blocking(media.analyze, path, self.cfg.ffmpeg)}
        if cmd == "exports.analyze_latest":
            items = await self._run_blocking(media.list_exports, self.cfg.exports_path)
            if not items:
                raise media.MediaError("Keine Exportdatei im Ordner %s gefunden. Bitte zuerst in "
                                       "Ableton exportieren." % self.cfg.exports_path)
            path = media.safe_path(self.cfg.exports_path, items[0]["name"])
            return {"ok": True, "data": await self._run_blocking(media.analyze, path, self.cfg.ffmpeg)}
        if cmd == "exports.convert":
            path = media.safe_path(self.cfg.exports_path, args.get("name"))
            sr = args.get("sample_rate")
            res = await self._run_blocking(media.convert, path, self.cfg.exports_path,
                                           str(args.get("format")), int(sr) if sr else None,
                                           self.cfg.ffmpeg)
            return {"ok": True, "data": res}
        if cmd == "exports.ticket":
            media.safe_path(self.cfg.exports_path, args.get("name"))
            t = self.tickets.issue(dev["id"], "download",
                                   {"name": args.get("name"), "inline": bool(args.get("inline"))}, ttl=120)
            return {"ok": True, "data": {"url": "/api/download?ticket=" + t}}
        if cmd == "audio.ticket":
            quality = args.get("quality", "medium")
            if quality not in QUALITY:
                raise ValueError("Unbekannte Qualitaetsstufe")
            t = self.tickets.issue(dev["id"], "audio", {"quality": quality}, ttl=30)
            return {"ok": True, "data": {"url": "/api/audio?ticket=" + t}}
        if cmd == "keys.send":
            label = await self._run_blocking(keystrokes.send, str(args.get("shortcut")),
                                             bool(self.cfg.allow_keystrokes))
            self._log_history({"type": "keystroke", "device": dev["name"], "shortcut": args.get("shortcut")})
            return {"ok": True, "data": {"sent": label, "confirmed": False}}
        if cmd == "assistant.plan":
            return {"ok": True, "data": assistant.plan(str(args.get("text", ""))[:500], self.live.state)}
        if cmd == "assistant.execute":
            return {"ok": True, "data": await self._execute_plan(client, args)}
        if cmd == "history.list":
            return {"ok": True, "data": {"entries": self._read_history(50)}}
        raise ValueError("Unbekannter Befehl: %s" % cmd)

    async def _execute_plan(self, client: ClientSession, args: Dict[str, Any]) -> Dict[str, Any]:
        actions = args.get("actions")
        if not isinstance(actions, list) or not actions or len(actions) > 32:
            raise ValueError("Keine gueltigen Aktionen")
        allowed = LIVE_COMMANDS | {"exports.analyze_latest", "keys.send"}
        report = []
        for action in actions:
            cmd = action.get("cmd")
            if cmd not in allowed:
                report.append({"label": action.get("label"), "ok": False, "error": "Nicht erlaubt"})
                continue
            try:
                if cmd in LIVE_COMMANDS:
                    res = await self.live.command(cmd, action.get("args") or {})
                    entry = {"ok": bool(res.get("ok")), "data": res.get("data"), "error": res.get("error"),
                             "confirmed": bool(res.get("ok"))}
                else:
                    res = await self._agent_cmd(client, cmd, action.get("args") or {})
                    entry = dict(res, confirmed=cmd != "keys.send" and res.get("ok"))
            except (LiveUnavailable, ValueError, media.MediaError, keystrokes.KeystrokeError) as exc:
                entry = {"ok": False, "error": str(exc), "confirmed": False}
            entry["label"] = action.get("label")
            entry["cmd"] = cmd
            report.append(entry)
            if not entry["ok"]:
                break  # bei Fehler keine weiteren Aktionen
        record = {"type": "assistant", "device": client.device["name"], "input": args.get("input"),
                  "report": [{k: v for k, v in r.items() if k in ("label", "ok", "error", "data", "confirmed")}
                             for r in report]}
        self._log_history(record)
        return {"report": report, "all_ok": all(r["ok"] for r in report) and len(report) == len(actions)}

    def _log_history(self, record: Dict[str, Any]) -> None:
        record["time"] = time.time()
        try:
            with open(self.history_path, "a") as fh:
                fh.write(json.dumps(record, ensure_ascii=False) + "\n")
        except OSError:
            log.warning("Verlauf konnte nicht geschrieben werden")

    def _read_history(self, limit: int) -> list:
        try:
            lines = self.history_path.read_text().splitlines()[-limit:]
        except OSError:
            return []
        out = []
        for line in reversed(lines):
            try:
                out.append(json.loads(line))
            except ValueError:
                pass
        return out
