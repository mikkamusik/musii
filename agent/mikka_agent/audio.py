"""
Audio-Monitoring: Master-Ausgang -> ffmpeg -> Opus/WebM -> HTTP-Stream.

Signalweg auf dem Mac (siehe docs/INSTALLATION.md):
  Ableton Master -> Multi-Output-Device (Lautsprecher + BlackHole 2ch)
  BlackHole 2ch  -> ffmpeg (AVFoundation) -> Opus -> Smartphone

Die Mac-Ausgabe laeuft dabei unveraendert ueber die Lautsprecher/das Interface.
Der Stream ist komprimiert und NUR zum Abhoeren gedacht.

Hinweis: Diese erste Version streamt per HTTP (Latenz ca. 1-3 s je nach Netz und
Browser-Puffer). Ein WebRTC-Transport mit geringerer Latenz ist als naechster
Schritt geplant (siehe docs/EINSCHRAENKUNGEN.md).
"""
from __future__ import annotations

import asyncio
import logging
from typing import Dict, List

log = logging.getLogger("mikka.audio")

QUALITY = {
    "low": {"bitrate": "48k", "label": "Niedrig (48 kbit/s, Mobilfunk schwach)"},
    "medium": {"bitrate": "96k", "label": "Mittel (96 kbit/s)"},
    "high": {"bitrate": "160k", "label": "Hoch (160 kbit/s, WLAN)"},
}


def build_command(ffmpeg: str, input_args: List[str], quality: str) -> List[str]:
    q = QUALITY.get(quality, QUALITY["medium"])
    return ([ffmpeg, "-nostdin", "-hide_banner", "-loglevel", "error",
             "-fflags", "nobuffer", "-flags", "low_delay", "-probesize", "32",
             "-analyzeduration", "0"]
            + list(input_args)
            + ["-vn", "-ac", "2", "-ar", "48000",
               "-c:a", "libopus", "-b:a", q["bitrate"], "-application", "lowdelay",
               "-frame_duration", "20", "-vbr", "on",
               "-f", "webm", "-live", "1", "-cluster_time_limit", "100",
               "-cluster_size_limit", "8192", "pipe:1"])


class AudioStreamer:
    def __init__(self, ffmpeg: str, input_args: List[str], max_streams: int = 2):
        self.ffmpeg = ffmpeg
        self.input_args = input_args
        self.max_streams = max_streams
        self.active: Dict[int, asyncio.subprocess.Process] = {}

    @property
    def count(self) -> int:
        return len(self.active)

    async def stream(self, quality: str, write, chunk: int = 4096) -> None:
        """Startet ffmpeg und schreibt Daten ueber `write(bytes)` bis zum Abbruch."""
        if self.count >= self.max_streams:
            raise RuntimeError("Maximale Anzahl gleichzeitiger Audio-Streams erreicht")
        cmd = build_command(self.ffmpeg, self.input_args, quality)
        proc = await asyncio.create_subprocess_exec(
            *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        self.active[proc.pid] = proc
        log.info("Audio-Stream gestartet (%s, pid %s)", quality, proc.pid)
        try:
            while True:
                data = await proc.stdout.read(chunk)
                if not data:
                    err = (await proc.stderr.read()).decode("utf-8", "replace").strip()
                    if err:
                        log.warning("ffmpeg beendet: %s", err[-400:])
                        raise RuntimeError(err[-400:])
                    break
                await write(data)
        finally:
            self.active.pop(proc.pid, None)
            if proc.returncode is None:
                proc.terminate()
                try:
                    await asyncio.wait_for(proc.wait(), timeout=2)
                except asyncio.TimeoutError:
                    proc.kill()
            log.info("Audio-Stream beendet (pid %s)", proc.pid)

    async def stop_all(self) -> None:
        for proc in list(self.active.values()):
            if proc.returncode is None:
                proc.terminate()
