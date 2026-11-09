import shutil
import subprocess

import pytest

from mikka_agent import media
from mikka_agent.audio import build_command

needs_ffmpeg = pytest.mark.skipif(not shutil.which("ffmpeg"), reason="ffmpeg fehlt")


def make_tone(path, peak_db=-20.0, seconds=6):
    amp = 10 ** (peak_db / 20.0)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i",
                    "aevalsrc=%f*sin(2*PI*1000*t)|%f*sin(2*PI*1000*t):c=stereo:s=48000:d=%d"
                    % (amp, amp, seconds), "-c:a", "pcm_s24le", str(path)], check=True)


@needs_ffmpeg
def test_analysis_of_reference_tone(tmp_path):
    f = tmp_path / "tone.wav"
    make_tone(f, -20.0)
    r = media.analyze(f)
    # 1 kHz Sinus, -20 dBFS Peak, stereo -> ca. -20 LUFS (EBU R128 Referenz)
    assert abs(r["integrated_lufs"] - (-20.0)) < 0.5
    assert abs(r["sample_peak_dbfs"] - (-20.0)) < 0.2
    assert abs(r["rms_dbfs"] - (-23.0)) < 0.2
    assert abs(r["crest_factor_db"] - 3.0) < 0.2
    assert abs(r["true_peak_dbtp"] - (-20.0)) < 0.5
    assert r["short_term_max_lufs"] is not None and r["momentary_max_lufs"] is not None
    assert r["sample_rate"] == 48000 and r["warnings"] == []


@needs_ffmpeg
def test_hot_master_warns(tmp_path):
    f = tmp_path / "hot.wav"
    make_tone(f, -0.1, seconds=4)
    r = media.analyze(f)
    assert any("True Peak" in w for w in r["warnings"])


@needs_ffmpeg
def test_convert_never_overwrites(tmp_path):
    src = tmp_path / "mix.wav"
    make_tone(src, -12, seconds=2)
    a = media.convert(src, tmp_path, "flac", 44100)
    b = media.convert(src, tmp_path, "flac", 44100)
    assert a["name"] != b["name"]
    assert (tmp_path / a["name"]).exists() and (tmp_path / b["name"]).exists()
    with pytest.raises(media.MediaError):
        media.convert(src, tmp_path, "exe")


def test_safe_path(tmp_path):
    (tmp_path / "a.wav").write_bytes(b"x")
    outside = tmp_path.parent / "secret.wav"
    outside.write_bytes(b"x")
    assert media.safe_path(tmp_path, "a.wav").name == "a.wav"
    for bad in ("../secret.wav", "/etc/passwd", "", "converted/../../secret.wav"):
        with pytest.raises(media.MediaError):
            media.safe_path(tmp_path, bad)


def test_list_exports(tmp_path):
    (tmp_path / "a.wav").write_bytes(b"x")
    (tmp_path / "notes.txt").write_text("x")
    names = [i["name"] for i in media.list_exports(tmp_path)]
    assert names == ["a.wav"]


def test_audio_command_quality():
    cmd = build_command("ffmpeg", ["-f", "lavfi", "-i", "sine"], "low")
    assert "libopus" in cmd and cmd[cmd.index("-b:a") + 1] == "48k"
    assert cmd[-1] == "pipe:1"
