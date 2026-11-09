"""Phase 1: technische Bestandsaufnahme des Studiorechners (`mikka check`)."""
from __future__ import annotations

import glob
import os
import platform
import plistlib
import re
import shutil
import socket
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, List

USER_LIBRARY = Path.home() / "Music" / "Ableton" / "User Library" / "Remote Scripts"


def _run(cmd: List[str]) -> str:
    try:
        return subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                              timeout=10).stdout.decode("utf-8", "replace")
    except Exception:
        return ""


def ableton_installs() -> List[Dict[str, str]]:
    result = []
    for app in sorted(glob.glob("/Applications/Ableton Live*.app")):
        info = {"path": app, "version": "?"}
        try:
            with open(os.path.join(app, "Contents", "Info.plist"), "rb") as fh:
                plist = plistlib.load(fh)
            info["version"] = plist.get("CFBundleShortVersionString", "?")
            info["bundle_id"] = plist.get("CFBundleIdentifier", "?")
        except Exception:
            pass
        info["edition_suite"] = "Suite" in app
        result.append(info)
    return result


def ffmpeg_info(ffmpeg: str = "ffmpeg") -> Dict[str, Any]:
    path = shutil.which(ffmpeg)
    if not path:
        return {"found": False}
    version = _run([path, "-hide_banner", "-version"]).splitlines()[:1]
    encoders = _run([path, "-hide_banner", "-encoders"])
    devices = _run([path, "-hide_banner", "-f", "avfoundation", "-list_devices", "true", "-i", ""]) \
        if sys.platform == "darwin" else ""
    return {
        "found": True, "path": path, "version": version[0] if version else "?",
        "libopus": "libopus" in encoders, "libmp3lame": "libmp3lame" in encoders,
        "flac": re.search(r"\bflac\b", encoders) is not None,
        "blackhole_visible": "BlackHole" in devices,
    }


def port_open(host: str, port: int) -> bool:
    try:
        with socket.create_connection((host, port), timeout=1):
            return True
    except OSError:
        return False


def collect(cfg) -> Dict[str, Any]:
    mac_ver = platform.mac_ver()[0]
    report: Dict[str, Any] = {
        "os": "macOS %s" % mac_ver if mac_ver else platform.platform(),
        "machine": platform.machine(),
        "python": sys.version.split()[0],
        "python_ok": sys.version_info >= (3, 8),
        "ableton": ableton_installs(),
        "live_running": bool(_run(["pgrep", "-x", "Live"]).strip()),
        "remote_script_installed": (USER_LIBRARY / "MikkaRemote" / "__init__.py").exists(),
        "ableton_mcp_installed": any((USER_LIBRARY / n).exists() for n in ("AbletonMCP", "AbletonMCP_Remote_Script")),
        "live_socket": port_open(cfg.live_host, cfg.live_port),
        "live_secret": (cfg.home / "live_secret").exists(),
        "ffmpeg": ffmpeg_info(cfg.ffmpeg),
        "blackhole_driver": any(os.path.exists(p) for p in (
            "/Library/Audio/Plug-Ins/HAL/BlackHole2ch.driver",
            "/Library/Audio/Plug-Ins/HAL/BlackHole.driver")),
        "tailscale": bool(shutil.which("tailscale")) or os.path.exists("/Applications/Tailscale.app"),
        "screen_sharing": bool(_run(["launchctl", "print", "system/com.apple.screensharing"]).strip())
        if sys.platform == "darwin" else False,
        "exports_dir": str(cfg.exports_path),
        "exports_dir_exists": cfg.exports_path.is_dir(),
    }
    return report


def format_report(r: Dict[str, Any]) -> str:
    def ok(flag: bool) -> str:
        return "OK  " if flag else "--  "
    lines = ["MIKKA STUDIO REMOTE - Systempruefung", "=" * 40,
             "Betriebssystem : %s (%s)" % (r["os"], r["machine"]),
             "%sPython %s (benoetigt >= 3.8)" % (ok(r["python_ok"]), r["python"])]
    if r["ableton"]:
        for a in r["ableton"]:
            lines.append("OK  Ableton: %s (Version %s)%s" % (
                os.path.basename(a["path"]), a["version"],
                " - Suite: Max for Live enthalten" if a["edition_suite"] else ""))
    else:
        lines.append("--  Keine Ableton-Installation in /Applications gefunden")
    lines += [
        "%sAbleton Live laeuft" % ok(r["live_running"]),
        "%sMikkaRemote-Script installiert (User Library)" % ok(r["remote_script_installed"]),
        "%sMikkaRemote antwortet auf 127.0.0.1 (Control Surface aktiv)" % ok(r["live_socket"]),
        "%slive_secret vorhanden" % ok(r["live_secret"]),
        "    AbletonMCP gefunden: %s (wird nicht veraendert)" % ("ja" if r["ableton_mcp_installed"] else "nein"),
    ]
    f = r["ffmpeg"]
    if f.get("found"):
        lines.append("OK  ffmpeg: %s" % f["version"])
        lines.append("%sffmpeg libopus (Monitoring)" % ok(f["libopus"]))
        lines.append("%sffmpeg libmp3lame (MP3-Export)" % ok(f["libmp3lame"]))
        lines.append("%sffmpeg FLAC" % ok(f["flac"]))
    else:
        lines.append("--  ffmpeg nicht gefunden")
    lines += [
        "%sBlackHole-Treiber (virtuelles Audio-Routing)" % ok(r["blackhole_driver"]),
        "%sTailscale (sichere Verbindung von unterwegs)" % ok(r["tailscale"]),
        "%sBildschirmfreigabe (Remote-Desktop-Fallback)" % ok(r["screen_sharing"]),
        "%sExportordner: %s" % (ok(r["exports_dir_exists"]), r["exports_dir"]),
    ]
    return "\n".join(lines)
