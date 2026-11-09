#!/usr/bin/env python3
"""Erzeugt die App-Icons (PNG) ohne externe Bibliotheken."""
import struct
import sys
import zlib
from pathlib import Path


def png(size: int) -> bytes:
    bg, fg = (10, 10, 11), (255, 138, 31)
    rows = []
    s = size
    for y in range(s):
        row = bytearray([0])
        for x in range(s):
            u, v = x / s, y / s
            c = bg
            # orangefarbene abgerundete Flaeche innerhalb der Safe-Zone (maskable)
            if 0.18 < u < 0.82 and 0.18 < v < 0.82:
                c = fg
                # Buchstabe "M" in Schwarz
                lu, lv = (u - 0.18) / 0.64, (v - 0.18) / 0.64
                if 0.2 < lv < 0.8:
                    stroke = 0.12
                    left = 0.18 < lu < 0.18 + stroke
                    right = 0.82 - stroke < lu < 0.82
                    t = (lv - 0.2) / 0.6
                    d1 = abs(lu - (0.18 + 0.32 * min(t * 1.6, 1)))
                    d2 = abs(lu - (0.82 - 0.32 * min(t * 1.6, 1)))
                    diag = (d1 < stroke / 1.6 or d2 < stroke / 1.6) and t < 0.65
                    if left or right or diag:
                        c = (0, 0, 0)
            row += bytes(c)
        rows.append(bytes(row))
    raw = zlib.compress(b"".join(rows), 9)

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", s, s, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", raw) + chunk(b"IEND", b""))


if __name__ == "__main__":
    out = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).parent.parent / "agent" / "web" / "assets")
    for size in (192, 512):
        (out / ("icon-%d.png" % size)).write_bytes(png(size))
    print("Icons geschrieben nach", out)
