"""
Exportdateien: Auflisten, Messen (ffmpeg ebur128 + astats) und Konvertieren.

Alle Messwerte stammen aus einer echten ffmpeg-Analyse der unkomprimierten
Datei auf dem Mac. Es werden keine Werte geschaetzt oder erfunden.
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any, Dict, List, Optional

AUDIO_EXT = {".wav", ".aif", ".aiff", ".flac", ".mp3", ".m4a", ".ogg"}

FORMATS = {
    "wav24": {"ext": ".wav", "args": ["-c:a", "pcm_s24le"], "label": "WAV 24-Bit PCM"},
    "wav32f": {"ext": ".wav", "args": ["-c:a", "pcm_f32le"], "label": "WAV 32-Bit Float"},
    "flac": {"ext": ".flac", "args": ["-c:a", "flac", "-sample_fmt", "s32",
                                       "-bits_per_raw_sample", "24"], "label": "FLAC 24-Bit"},
    "mp3": {"ext": ".mp3", "args": ["-c:a", "libmp3lame", "-b:a", "320k"], "label": "MP3 320 kbit/s"},
}
SAMPLE_RATES = {44100, 48000, 88200, 96000}


class MediaError(Exception):
    pass


def safe_path(base: Path, name: str) -> Path:
    """Verhindert Pfad-Traversal: nur Dateien direkt im Exportordner (oder converted/)."""
    if not isinstance(name, str) or not name or "\x00" in name:
        raise MediaError("Ungueltiger Dateiname")
    base = base.resolve()
    target = (base / name).resolve()
    if target.parent not in (base, (base / "converted").resolve()):
        raise MediaError("Zugriff ausserhalb des Exportordners verweigert")
    if not target.is_file():
        raise MediaError("Datei nicht gefunden")
    return target


def list_exports(base: Path) -> List[Dict[str, Any]]:
    base.mkdir(parents=True, exist_ok=True)
    items = []
    for folder in (base, base / "converted"):
        if not folder.is_dir():
            continue
        for entry in folder.iterdir():
            if entry.is_file() and entry.suffix.lower() in AUDIO_EXT and not entry.name.startswith("."):
                st = entry.stat()
                items.append({"name": str(entry.relative_to(base)), "size": st.st_size,
                              "mtime": st.st_mtime})
    items.sort(key=lambda i: i["mtime"], reverse=True)
    return items


def ffmpeg_available(ffmpeg: str = "ffmpeg") -> bool:
    return shutil.which(ffmpeg) is not None


_NUM = r"(-?inf|-?\d+(?:\.\d+)?)"


def _f(value: str) -> Optional[float]:
    if value is None:
        return None
    if value.lower() in ("-inf", "inf", "nan"):
        return None
    return float(value)


def parse_analysis(output: str) -> Dict[str, Any]:
    """Wertet die stderr-Ausgabe von ffmpeg (ebur128 + astats) aus."""
    result: Dict[str, Any] = {}
    summary = output.split("Summary:")[-1] if "Summary:" in output else ""
    m = re.search(r"I:\s+" + _NUM + r"\s+LUFS", summary)
    result["integrated_lufs"] = _f(m.group(1)) if m else None
    m = re.search(r"LRA:\s+" + _NUM + r"\s+LU", summary)
    result["loudness_range_lu"] = _f(m.group(1)) if m else None
    m = re.search(r"Peak:\s+" + _NUM + r"\s+dBFS", summary)
    result["true_peak_dbtp"] = _f(m.group(1)) if m else None

    momentary, short = [], []
    for line in output.splitlines():
        if "TARGET:" not in line:
            continue
        mm = re.search(r"M:\s*" + _NUM, line)
        sm = re.search(r"S:\s*" + _NUM, line)
        tm = re.search(r"t:\s*" + _NUM, line)
        if mm and _f(mm.group(1)) is not None and _f(mm.group(1)) > -70:
            momentary.append(float(mm.group(1)))
        # Short-Term benoetigt 3 s Messfenster
        if sm and tm and float(tm.group(1)) >= 3.0 and _f(sm.group(1)) is not None \
                and _f(sm.group(1)) > -70:
            short.append(float(sm.group(1)))
    result["momentary_max_lufs"] = max(momentary) if momentary else None
    result["short_term_max_lufs"] = max(short) if short else None

    overall = output.split("Overall")[-1] if "Overall" in output else ""
    m = re.search(r"Peak level dB:\s*" + _NUM, overall)
    result["sample_peak_dbfs"] = _f(m.group(1)) if m else None
    m = re.search(r"RMS level dB:\s*" + _NUM, overall)
    result["rms_dbfs"] = _f(m.group(1)) if m else None
    if result["sample_peak_dbfs"] is not None and result["rms_dbfs"] is not None:
        result["crest_factor_db"] = round(result["sample_peak_dbfs"] - result["rms_dbfs"], 2)
    else:
        result["crest_factor_db"] = None
    for key, value in list(result.items()):
        if isinstance(value, float):
            result[key] = round(value, 2)
    warnings = []
    tp = result.get("true_peak_dbtp")
    if tp is not None and tp > 0.0:
        warnings.append("True Peak ueber 0 dBTP: Clipping bei der Wandlung/Kodierung wahrscheinlich.")
    elif tp is not None and tp > -1.0:
        warnings.append("True Peak ueber -1 dBTP: Fuer verlustbehaftete Formate (MP3/AAC/Opus) "
                        "ist mehr Reserve empfehlenswert.")
    sp = result.get("sample_peak_dbfs")
    if sp is not None and sp >= -0.01:
        warnings.append("Sample-Peak erreicht 0 dBFS: moegliches digitales Clipping.")
    result["warnings"] = warnings
    return result


def analysis_command(ffmpeg: str, path: Path) -> List[str]:
    graph = ("[0:a]asplit=2[a][b];"
             "[a]ebur128=peak=true:framelog=info[ao];"
             "[b]astats=measure_perchannel=none:measure_overall=Peak_level+RMS_level[bo]")
    return [ffmpeg, "-nostdin", "-nostats", "-hide_banner", "-i", str(path),
            "-filter_complex", graph, "-map", "[ao]", "-f", "null", "-",
            "-map", "[bo]", "-f", "null", "-"]


def probe_info(output: str) -> Dict[str, Any]:
    info: Dict[str, Any] = {}
    m = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", output)
    if m:
        info["duration_s"] = round(int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3)), 2)
    m = re.search(r"Audio:\s*([^,\n]+),\s*(\d+)\s*Hz,\s*([^,\n]+)", output)
    if m:
        info["codec"] = m.group(1).strip()
        info["sample_rate"] = int(m.group(2))
        info["channels"] = m.group(3).strip()
    return info


def analyze(path: Path, ffmpeg: str = "ffmpeg", timeout: float = 900) -> Dict[str, Any]:
    if not ffmpeg_available(ffmpeg):
        raise MediaError("ffmpeg nicht gefunden")
    proc = subprocess.run(analysis_command(ffmpeg, path), stdout=subprocess.DEVNULL,
                          stderr=subprocess.PIPE, timeout=timeout)
    output = proc.stderr.decode("utf-8", "replace")
    if proc.returncode != 0:
        raise MediaError("ffmpeg-Analyse fehlgeschlagen: %s" % output.strip().splitlines()[-1:])
    result = parse_analysis(output)
    result.update(probe_info(output))
    result["file"] = path.name
    result["method"] = "ffmpeg ebur128 (ITU-R BS.1770 / EBU R128) + astats"
    return result


def convert(src: Path, base: Path, fmt: str, sample_rate: Optional[int] = None,
            ffmpeg: str = "ffmpeg", timeout: float = 900) -> Dict[str, Any]:
    if fmt not in FORMATS:
        raise MediaError("Unbekanntes Format")
    if sample_rate is not None and int(sample_rate) not in SAMPLE_RATES:
        raise MediaError("Nicht unterstuetzte Samplerate")
    spec = FORMATS[fmt]
    outdir = base / "converted"
    outdir.mkdir(parents=True, exist_ok=True)
    suffix = "_%s%s" % (fmt, "_%dk" % (int(sample_rate) // 1000) if sample_rate else "")
    target = outdir / (src.stem + suffix + spec["ext"])
    n = 2
    while target.exists():  # niemals bestehende Dateien ueberschreiben
        target = outdir / ("%s%s_%d%s" % (src.stem, suffix, n, spec["ext"]))
        n += 1
    cmd = [ffmpeg, "-nostdin", "-hide_banner", "-loglevel", "error", "-n", "-i", str(src),
           "-map", "0:a:0", "-map_metadata", "0"] + spec["args"]
    if sample_rate:
        cmd += ["-af", "aresample=%d:filter_size=64:cutoff=0.97" % int(sample_rate)]
    cmd.append(str(target))
    proc = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=timeout)
    if proc.returncode != 0 or not target.exists():
        if target.exists():
            target.unlink()
        raise MediaError("Konvertierung fehlgeschlagen: %s"
                         % proc.stderr.decode("utf-8", "replace").strip()[-300:])
    return {"name": str(target.relative_to(base)), "size": target.stat().st_size,
            "format": spec["label"]}
