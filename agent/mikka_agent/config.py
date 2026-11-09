"""Konfiguration des Agents (~/.mikka-studio/config.json)."""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any, Dict


def home_dir() -> Path:
    base = os.environ.get("MIKKA_HOME")
    path = Path(base) if base else Path.home() / ".mikka-studio"
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    return path


def _default_audio_input() -> list:
    if sys.platform == "darwin":
        # BlackHole 2ch (kostenlos, Open Source) ueber AVFoundation
        return ["-f", "avfoundation", "-i", ":BlackHole 2ch"]
    # Linux/Tests: PulseAudio-Monitor als Platzhalter
    return ["-f", "pulse", "-i", "default"]


DEFAULTS: Dict[str, Any] = {
    # Agent lauscht nur lokal. Fernzugriff ueber Tailscale Serve (HTTPS, nur Tailnet).
    "host": "127.0.0.1",
    "port": 8765,
    "live_host": "127.0.0.1",
    "live_port": 9878,
    "exports_dir": str(Path.home() / "Music" / "MIKKA Exports"),
    "ffmpeg": "ffmpeg",
    "audio_input": _default_audio_input(),
    "audio_max_streams": 2,
    # Tastaturkuerzel an Ableton senden (Speichern, Export-Dialog). Benoetigt die
    # macOS-Bedienungshilfen-Freigabe. Standard: AUS.
    "allow_keystrokes": False,
    # Geraete-Token verfallen nach so vielen Tagen ohne Nutzung.
    "device_inactivity_days": 30,
    # Hostname fuer Remote Desktop (VNC). Leer = Hostname der App-Adresse.
    "remote_desktop_host": "",
    "trust_proxy_https": True,
}


class Config:
    def __init__(self, data: Dict[str, Any], path: Path):
        self.data = data
        self.path = path

    def __getattr__(self, item: str) -> Any:
        try:
            return self.data[item]
        except KeyError:
            raise AttributeError(item)

    @property
    def home(self) -> Path:
        return self.path.parent

    @property
    def exports_path(self) -> Path:
        return Path(os.path.expanduser(self.data["exports_dir"]))

    def save(self) -> None:
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.data, indent=2, ensure_ascii=False))
        os.chmod(tmp, 0o600)
        tmp.replace(self.path)


def load_config(path: Path = None) -> Config:
    path = path or home_dir() / "config.json"
    data = dict(DEFAULTS)
    if path.exists():
        try:
            user = json.loads(path.read_text())
            if isinstance(user, dict):
                data.update(user)
        except ValueError as exc:
            raise SystemExit("Konfigurationsdatei %s ist kein gueltiges JSON: %s" % (path, exc))
    cfg = Config(data, path)
    if not path.exists():
        cfg.save()
    return cfg
