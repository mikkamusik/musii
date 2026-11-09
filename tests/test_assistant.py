from mikka_agent.assistant import match_tracks, plan
from MikkaRemote import core
from fake_lom import App, Song


def state():
    song = Song()
    b = core.LiveBridge(lambda: song, app=App(), secret="x" * 64, server=core.LineServer(port=0))
    return {"song": b.song_state(), "tracks": b.tracks_state(), "scenes": b.scenes_state()}


def test_tempo():
    p = plan("Stelle das Projekt auf 145 BPM.", state())
    assert p["actions"][0] == {"cmd": "song.set", "args": {"tempo": 145.0}, "label": "Tempo: 120.00 -> 145.00 BPM"}
    assert p["revert"][0]["args"] == {"tempo": 120.0}
    assert plan("2 bpm schneller", state())["actions"][0]["args"]["tempo"] == 122.0
    assert plan("Tempo auf 15", state())["actions"] == []


def test_hihats_too_loud():
    p = plan("Die Hi-Hats sind zu laut", state())
    assert len(p["actions"]) == 1
    a = p["actions"][0]
    assert a["cmd"] == "track.set_volume_db"
    assert a["args"]["track"] == {"kind": "track", "index": 3, "name": "04 HI-HATS"}
    assert a["args"]["db"] == -2.0
    assert p["requires_confirmation"]


def test_kick_louder_amount():
    p = plan("Kick 1,5 dB lauter", state())
    assert p["actions"][0]["args"]["db"] == 1.5


def test_bass_not_matching_bassdrum():
    names = [t["name"] for t in match_tracks("bass leiser", state())]
    assert names == ["03 BASS"]


def test_mute_solo():
    p = plan("Bass stumm", state())
    assert p["actions"][0]["args"]["mute"] is True
    p = plan("Kick solo", state())
    assert p["actions"][0]["args"]["solo"] is True


def test_creative_is_honestly_unsupported():
    for text in ("Mach die Kick druckvoller", "Reduziere die störenden Frequenzen im Rumble",
                 "Füge einen hypnotischen Effekt hinzu", "Optimiere das Mixing"):
        p = plan(text, state())
        assert p["unsupported"] and p["actions"] == [], text


def test_disconnected():
    p = plan("145 BPM", {})
    assert p["unsupported"] and "nicht verbunden" in p["message"]


def test_analysis_and_scene():
    assert plan("Analysiere meinen Track", {})["actions"][0]["cmd"] == "exports.analyze_latest"
    assert plan("Starte Szene 2", state())["actions"][0]["args"] == {"scene": 1}
    assert plan("Starte Szene 9", state())["unsupported"]
