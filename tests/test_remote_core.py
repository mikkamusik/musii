import json
import socket
import time

import pytest

from MikkaRemote import core
from fake_lom import App, Param, Song


@pytest.fixture
def bridge(mikka_home):
    song = Song()
    b = core.LiveBridge(lambda: song, app=App(), secret="s" * 64,
                        server=core.LineServer(port=0))
    b.song_obj = song
    return b


def run(b, cmd, **args):
    return b.execute({"id": "x", "cmd": cmd, "args": args})


def test_parse_db():
    assert core.parse_db("-6.0 dB") == -6.0
    assert core.parse_db("0 dB") == 0.0
    assert core.parse_db("-inf dB") == float("-inf")
    assert core.parse_db("C") is None


def test_value_for_db_matches_display():
    p = Param("Vol", 0.85, kind="vol")
    for target in (-12.0, -6.0, -2.5, 0.0, 3.0):
        v = core.value_for_db(p, target)
        assert abs(core.parse_db(p.str_for_value(v)) - target) <= 0.1
    assert core.value_for_db(p, 20) == 1.0


def test_secret_created_private(mikka_home):
    s = core.load_or_create_secret()
    path = mikka_home / "live_secret"
    assert len(s) == 64 and path.read_text() == s
    assert oct(path.stat().st_mode & 0o777) == "0o600"
    assert core.load_or_create_secret() == s


def test_song_state_and_set(bridge):
    st = bridge.song_state()
    assert st["tempo"] == 120.0 and st["cue_points"][0]["name"] == "Start"
    r = run(bridge, "song.set", tempo=145, metronome=True)
    assert r["ok"] and r["data"] == {"tempo": 145.0, "metronome": True}
    assert bridge.song_obj.tempo == 145.0
    assert not run(bridge, "song.set", tempo=5)["ok"]
    assert not run(bridge, "song.set", signature_denominator=3)["ok"]
    assert not run(bridge, "song.set", evil=1)["ok"]


def test_transport(bridge):
    assert run(bridge, "transport.play")["ok"] and bridge.song_obj.is_playing
    assert run(bridge, "transport.stop")["ok"] and not bridge.song_obj.is_playing
    r = run(bridge, "song.jump_to_cue", index=1)  # sortiert: Start(0), Break(64)
    assert r["data"]["time"] == 64.0 and bridge.song_obj.current_song_time == 64.0


def test_tracks_state(bridge):
    st = bridge.tracks_state()
    names = [t["name"] for t in st["tracks"]]
    assert names == ["DRUMS", "01 KICK", "03 BASS", "04 HI-HATS"]
    assert st["tracks"][0]["type"] == "group"
    assert st["tracks"][1]["group"] == 0
    assert st["tracks"][2]["type"] == "midi"
    assert st["tracks"][1]["volume_str"] == "0.0 dB"
    assert st["master"]["kind"] == "master" and st["master"]["sends"] == []
    assert len(st["returns"]) == 2


def test_track_set(bridge):
    ref = {"kind": "track", "index": 1, "name": "01 KICK"}
    r = run(bridge, "track.set", track=ref, volume=2.0, mute=True, pan=-0.5,
            send={"index": 1, "value": 0.5})
    assert r["ok"], r
    kick = bridge.song_obj.tracks[1]
    assert kick.mixer_device.volume.value == 1.0  # geklemmt
    assert kick.mute and kick.mixer_device.panning.value == -0.5
    assert kick.mixer_device.sends[1].value == 0.5
    # Namensschutz bei verschobenen Spuren
    bad = run(bridge, "track.set", track={"kind": "track", "index": 2, "name": "01 KICK"}, mute=True)
    assert not bad["ok"] and "heisst inzwischen" in bad["error"]
    # Gruppen/Master koennen nicht scharfgeschaltet werden
    assert not run(bridge, "track.set", track={"kind": "track", "index": 0}, arm=True)["ok"]
    assert not run(bridge, "track.set", track={"kind": "master"}, mute=True)["ok"]


def test_volume_db_readback(bridge):
    r = run(bridge, "track.set_volume_db", track={"kind": "track", "index": 3}, db=-3.0)
    assert r["ok"] and abs(r["data"]["db"] - (-3.0)) <= 0.1
    assert r["data"]["before_str"] == "0.0 dB"
    assert not run(bridge, "track.set_volume_db", track={"kind": "track", "index": 3}, db=12)["ok"]


def test_clips_and_scenes(bridge):
    grid = bridge.clips_state()
    assert grid[1][0][0] == "Kick Loop" and grid[1][1] is None
    assert run(bridge, "clip.fire", track=1, scene=0)["ok"]
    assert bridge.song_obj.tracks[1].clip_slots[0].fired == 1
    # leerer Slot ohne Arm -> keine versehentliche Aufnahme
    assert not run(bridge, "clip.fire", track=3, scene=1)["ok"]
    assert run(bridge, "scene.fire", scene=1)["ok"] and bridge.song_obj.scenes[1].fired == 1
    assert run(bridge, "song.create_scene", index=-1)["data"]["scenes"] == 3


def test_devices(bridge):
    r = run(bridge, "device.list", track={"kind": "track", "index": 2})
    rack = r["data"]["devices"][0]
    assert rack["chains"][0]["devices"][0]["name"] == "Saturator"
    p = run(bridge, "device.params", track={"kind": "track", "index": 1}, path=[0])
    assert p["data"]["class_name"] == "Eq8"
    assert p["data"]["parameters"][0]["items"] == ["Off", "On"]
    s = run(bridge, "device.set_param", track={"kind": "track", "index": 1}, path=[0], param=2, value=0.75)
    assert s["ok"] and s["data"]["value"] == 0.75
    nested = run(bridge, "device.params", track={"kind": "track", "index": 2}, path=[0, 0, 0])
    assert nested["ok"] and nested["data"]["name"] == "Saturator"
    assert not run(bridge, "device.params", track={"kind": "track", "index": 2}, path=[0, 5, 0])["ok"]


def test_unknown_command(bridge):
    assert not run(bridge, "os.system")["ok"]


def _recv_lines(sock, n, timeout=2.0):
    sock.settimeout(timeout)
    buf = b""
    out = []
    end = time.time() + timeout
    while len(out) < n and time.time() < end:
        try:
            chunk = sock.recv(65536)
        except socket.timeout:
            break
        if not chunk:
            break
        buf += chunk
        while b"\n" in buf:
            line, buf = buf.split(b"\n", 1)
            out.append(json.loads(line))
    return out


def test_socket_auth_and_command(bridge):
    bridge.server.start()
    port = bridge.server._sock.getsockname()[1]
    # falsches Geheimnis -> getrennt
    bad = socket.create_connection(("127.0.0.1", port))
    bad.sendall(b'{"type":"hello","secret":"falsch"}\n')
    for _ in range(5):
        bridge.tick()
    assert _recv_lines(bad, 1)[0]["error"] == "auth_failed"
    bad.close()
    good = socket.create_connection(("127.0.0.1", port))
    good.sendall(json.dumps({"type": "hello", "secret": "s" * 64}).encode() + b"\n")
    for _ in range(3):
        bridge.tick()
    msgs = _recv_lines(good, 6)
    assert msgs[0]["type"] == "hello_ok" and msgs[0]["live_version"] == "12.4.6"
    assert {m["section"] for m in msgs[1:]} == {"song", "tracks", "scenes", "clips", "meters"}
    good.sendall(b'{"id":"abc","cmd":"song.set","args":{"tempo":140}}\n')
    for _ in range(3):
        bridge.tick()
    got = _recv_lines(good, 3)
    res = [m for m in got if m.get("type") == "result"]
    assert res and res[0]["id"] == "abc" and res[0]["ok"]
    # Aenderung wird als State-Diff verteilt
    for _ in range(4):
        bridge.tick()
    states = [m for m in _recv_lines(good, 5, timeout=0.5) if m.get("section") == "song"]
    assert any(m["data"]["tempo"] == 140.0 for m in got + states if m.get("section") == "song")
    good.close()
    bridge.close()
