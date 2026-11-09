"""
Ende-zu-Ende: Smartphone (WebSocket-Client) -> Agent -> MikkaRemote-Kern -> LOM.

Es laufen der echte Agent und der echte Remote-Script-Code; nur Ableton selbst
ist durch das LOM-Test-Double ersetzt.
"""
import asyncio
import json
import threading
import time

import pytest
from aiohttp.test_utils import TestClient, TestServer

from MikkaRemote import core
from fake_lom import App, Song
from mikka_agent.config import load_config
from mikka_agent.server import StudioAgent


class LiveThread(threading.Thread):
    def __init__(self):
        super().__init__(daemon=True)
        self.song = Song()
        self.bridge = core.LiveBridge(lambda: self.song, app=App(), server=core.LineServer(port=0))
        self.bridge.start()
        self.port = self.bridge.server._sock.getsockname()[1]
        self.running = True

    def run(self):
        while self.running:
            self.bridge.tick()
            time.sleep(0.01)

    def stop(self):
        self.running = False
        self.join(1)
        self.bridge.close()


async def recv_until(ws, pred, timeout=5.0):
    end = time.time() + timeout
    while time.time() < end:
        msg = await ws.receive_json(timeout=max(0.05, end - time.time()))
        if pred(msg):
            return msg
    raise AssertionError("Nachricht nicht erhalten")


async def scenario(home, tmp_path):
    live = LiveThread()
    live.start()
    cfg = load_config()
    cfg.data["live_port"] = live.port
    cfg.data["exports_dir"] = str(tmp_path / "exports")
    agent = StudioAgent(cfg)
    client = TestClient(TestServer(agent.build_app()))
    await client.start_server()
    try:
        # 1) Kopplung: falscher Code abgelehnt, richtiger Code ergibt Token
        r = await client.post("/api/pair", json={"code": "000000", "name": "x"})
        assert r.status == 403
        code = agent.pairing.create_code()
        r = await client.post("/api/pair", json={"code": code, "name": "Pixel 9 Pro"})
        body = await r.json()
        assert body["ok"] and len(body["token"]) > 30
        token = body["token"]
        assert r.headers["X-Frame-Options"] == "DENY"

        # 2) Ohne gueltiges Token keine Steuerung
        ws_bad = await client.ws_connect("/api/ws")
        await ws_bad.send_json({"type": "auth", "token": "falsch" * 8})
        assert (await ws_bad.receive_json())["type"] == "auth_failed"
        await ws_bad.close()

        # 3) Verbinden, Zustand aus "Ableton" erhalten
        ws = await client.ws_connect("/api/ws")
        await ws.send_json({"type": "auth", "token": token})
        welcome = await recv_until(ws, lambda m: m["type"] == "welcome")
        assert welcome["device"]["name"] == "Pixel 9 Pro"
        await recv_until(ws, lambda m: m["type"] == "status" and m["live_connected"])
        tracks = await recv_until(ws, lambda m: m.get("section") == "tracks")
        assert tracks["data"]["tracks"][1]["name"] == "01 KICK"

        # 4) Play + BPM + Fader -> Ableton bestaetigt
        await ws.send_json({"type": "cmd", "id": "cmd-play-0001", "cmd": "transport.play"})
        res = await recv_until(ws, lambda m: m.get("id") == "cmd-play-0001")
        assert res["ok"] and live.song.is_playing
        await ws.send_json({"type": "cmd", "id": "cmd-tempo-001", "cmd": "song.set", "args": {"tempo": 145}})
        res = await recv_until(ws, lambda m: m.get("id") == "cmd-tempo-001")
        assert res["data"]["tempo"] == 145.0 and live.song.tempo == 145.0
        ref = {"kind": "track", "index": 1, "name": "01 KICK"}
        await ws.send_json({"type": "cmd", "id": "cmd-fader-001", "cmd": "track.set",
                            "args": {"track": ref, "volume": 0.5}})
        res = await recv_until(ws, lambda m: m.get("id") == "cmd-fader-001")
        assert res["ok"] and live.song.tracks[1].mixer_device.volume.value == 0.5

        # 5) Echtzeit-Rueckmeldung: Aenderung "am Mac" erscheint auf dem Phone
        live.song.tracks[1].mute = True
        st = await recv_until(ws, lambda m: m.get("section") == "tracks"
                              and m["data"]["tracks"][1]["mute"])
        assert st["data"]["tracks"][1]["mute"] is True

        # 6) Doppelte Befehls-ID wird nicht erneut ausgefuehrt
        live.song.tempo = 100.0
        await ws.send_json({"type": "cmd", "id": "cmd-tempo-001", "cmd": "song.set", "args": {"tempo": 145}})
        dup = await recv_until(ws, lambda m: m.get("id") == "cmd-tempo-001")
        assert dup.get("duplicate") and live.song.tempo == 100.0

        # 7) Nicht erlaubte Befehle
        await ws.send_json({"type": "cmd", "id": "cmd-evil-0001", "cmd": "shell.exec", "args": {}})
        assert not (await recv_until(ws, lambda m: m.get("id") == "cmd-evil-0001"))["ok"]

        # 8) AI Engineer: planen + ausfuehren mit Bestaetigung durch Ableton
        await ws.send_json({"type": "cmd", "id": "cmd-plan-0001", "cmd": "assistant.plan",
                            "args": {"text": "Die Hi-Hats sind zu laut"}})
        plan = (await recv_until(ws, lambda m: m.get("id") == "cmd-plan-0001"))["data"]
        assert plan["actions"][0]["args"]["db"] == -2.0
        await ws.send_json({"type": "cmd", "id": "cmd-exec-0001", "cmd": "assistant.execute",
                            "args": {"actions": plan["actions"], "input": plan["input"]}})
        rep = (await recv_until(ws, lambda m: m.get("id") == "cmd-exec-0001"))["data"]
        assert rep["all_ok"] and rep["report"][0]["confirmed"]
        assert rep["report"][0]["data"]["volume_str"] == "-2.0 dB"
        await ws.send_json({"type": "cmd", "id": "cmd-hist-0001", "cmd": "history.list"})
        hist = (await recv_until(ws, lambda m: m.get("id") == "cmd-hist-0001"))["data"]["entries"]
        assert hist[0]["input"] == "Die Hi-Hats sind zu laut"

        # 9) Download-Ticket: einmalig, Pfad-Traversal verhindert
        exp = tmp_path / "exports"
        exp.mkdir(exist_ok=True)
        (exp / "mix.wav").write_bytes(b"RIFF0000WAVE")
        await ws.send_json({"type": "cmd", "id": "cmd-tick-0001", "cmd": "exports.ticket", "args": {"name": "mix.wav"}})
        url = (await recv_until(ws, lambda m: m.get("id") == "cmd-tick-0001"))["data"]["url"]
        r = await client.get(url)
        assert r.status == 200 and await r.read() == b"RIFF0000WAVE"
        assert (await client.get(url)).status == 403
        await ws.send_json({"type": "cmd", "id": "cmd-tick-0002", "cmd": "exports.ticket", "args": {"name": "../x"}})
        assert not (await recv_until(ws, lambda m: m.get("id") == "cmd-tick-0002"))["ok"]

        # 10) Ableton-Verbindung bricht ab -> Befehle schlagen sofort fehl, kein Nachholen
        live.stop()
        await recv_until(ws, lambda m: m["type"] == "status" and not m["live_connected"], timeout=8)
        await ws.send_json({"type": "cmd", "id": "cmd-late-0001", "cmd": "transport.stop"})
        late = await recv_until(ws, lambda m: m.get("id") == "cmd-late-0001")
        assert not late["ok"] and "nicht verbunden" in late["error"]
        assert live.song.is_playing  # Projekt laeuft unveraendert weiter

        # 11) Widerruf trennt das Geraet
        await ws.send_json({"type": "cmd", "id": "cmd-revk-0001", "cmd": "devices.revoke",
                            "args": {"id": welcome["device"]["id"]}})
        await ws.receive(timeout=5)
        for _ in range(5):
            m = await ws.receive(timeout=5)
            if m.type.name in ("CLOSE", "CLOSED", "CLOSING"):
                break
        assert ws.closed or ws.close_code == 4401
        ws2 = await client.ws_connect("/api/ws")
        await ws2.send_json({"type": "auth", "token": token})
        assert (await ws2.receive_json())["type"] == "auth_failed"
    finally:
        live.running = False
        await client.close()


def test_end_to_end(mikka_home, tmp_path):
    asyncio.run(scenario(mikka_home, tmp_path))


async def audio_and_static(tmp_path):
    cfg = load_config()
    cfg.data["live_port"] = 1  # kein Ableton noetig
    cfg.data["audio_input"] = ["-re", "-f", "lavfi", "-i", "sine=f=440:sample_rate=48000"]
    agent = StudioAgent(cfg)
    client = TestClient(TestServer(agent.build_app()))
    await client.start_server()
    try:
        r = await client.get("/")
        assert r.status == 200 and "MIKKA" in await r.text()
        assert "default-src 'self'" in r.headers["Content-Security-Policy"]
        assert (await client.get("/assets/app.js")).status == 200
        assert (await client.get("/manifest.webmanifest")).status == 200
        assert (await client.get("/api/audio?ticket=nope")).status == 403
        dev = agent.devices.register("Pixel")
        t = agent.tickets.issue(dev["device_id"], "audio", {"quality": "low"})
        r = await client.get("/api/audio?ticket=" + t)
        assert r.status == 200 and r.headers["Content-Type"] == "audio/webm"
        head = await r.content.readexactly(4)
        assert head == b"\x1a\x45\xdf\xa3"  # EBML/WebM-Header
        data = await asyncio.wait_for(r.content.readexactly(2000), 5)
        assert len(data) == 2000
        r.close()
        for _ in range(50):
            if agent.audio.count == 0:
                break
            await asyncio.sleep(0.1)
        assert agent.audio.count == 0  # ffmpeg wird beim Trennen beendet
    finally:
        await client.close()


@pytest.mark.skipif(not __import__("shutil").which("ffmpeg"), reason="ffmpeg fehlt")
def test_audio_stream_and_static(mikka_home, tmp_path):
    asyncio.run(audio_and_static(tmp_path))
