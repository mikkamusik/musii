"""Schreibt Standard-MIDI-Dateien (SMF Typ 1) aller Parts – ohne externe Libs."""
import os
import struct

import compose as C

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PPQ = 480

DRUM_MAP = {"kick": 36, "rim": 37, "clap": 39, "e": 42, "tl": 41, "tm": 45, "o1": 46, "o2": 46, "o3": 46,
            "t": 51, "cga": 63, "s": 70, "mt1": 76, "mt2": 77, "mt3": 75}


def vlq(v):
    out = [v & 0x7F]
    v >>= 7
    while v:
        out.append((v & 0x7F) | 0x80)
        v >>= 7
    return bytes(reversed(out))


def track_chunk(events, name):
    """events: (tick, prio, bytes)"""
    data = b"\x00\xff\x03" + vlq(len(name)) + name.encode()
    last = 0
    for tick, _, msg in sorted(events, key=lambda e: (e[0], e[1])):
        data += vlq(tick - last) + msg
        last = tick
    data += b"\x00\xff\x2f\x00"
    return b"MTrk" + struct.pack(">I", len(data)) + data


def notes_to_events(notes, ch=0):
    ev = []
    for start, dur, pitch, vel in notes:
        t0 = int(round(start * PPQ))
        t1 = max(t0 + 1, int(round((start + dur) * PPQ)))
        v = max(1, min(127, int(vel * 127)))
        ev.append((t0, 1, bytes([0x90 | ch, pitch, v])))
        ev.append((t1, 0, bytes([0x80 | ch, pitch, 0])))
    return ev


def write(fn, tracks):
    tempo = int(60_000_000 / C.BPM)
    meta = [(0, 0, b"\xff\x51\x03" + tempo.to_bytes(3, "big")),
            (0, 0, b"\xff\x58\x04\x04\x02\x18\x08")]
    for name, b in C.SECTIONS:
        meta.append((b * 4 * PPQ, 0, b"\xff\x06" + vlq(len(name)) + name.encode()))
    chunks = [track_chunk(meta, "NACHTSTROM 147 BPM")]
    for name, notes, ch in tracks:
        chunks.append(track_chunk(notes_to_events(notes, ch), name))
    hdr = b"MThd" + struct.pack(">IHHH", 6, 1, len(chunks), PPQ)
    with open(fn, "wb") as f:
        f.write(hdr + b"".join(chunks))


def part(notes):
    return [(n.start, n.dur, n.pitch, n.vel) for n in notes]


def drums():
    ev = [(b, 0.1, DRUM_MAP["kick"], v) for b, v in C.kick_hits()]
    ev += [(b, 0.1, DRUM_MAP["clap"], v) for b, v in C.clap_events()]
    ev += [(b, 0.1, DRUM_MAP[k], v) for b, k, v in C.hat_events()]
    ev += [(b, 0.1, DRUM_MAP[k], v) for b, k, v in C.perc_events()]
    ev += [(b, 0.1, DRUM_MAP["kick"], v) for b, v, _ in C.roll_hits()]
    ev += [(b, 0.1, DRUM_MAP["kick"], 1.0) for b in C.PICKUPS]
    return [(max(0.0, b), d, p, v) for b, d, p, v in ev]


def hook_part():
    out = []
    for bar, g, style in C.HOOK_PLACES:
        for st, ln, m, syl in C.HOOK:
            out.append((bar * 4 + st * 0.25, ln * 0.25 * 0.9, m, g))
    return out


PARTS = {
    "WALL": lambda: part(C.wall_notes()),
    "DUB": lambda: part(C.dub_notes()),
    "BASS": lambda: part(C.bass_notes()),
    "DRUMS": drums,
}


def main():
    d = f"{ROOT}/midi"
    os.makedirs(d, exist_ok=True)
    allt = []
    for name, fn in PARTS.items():
        notes = fn()
        ch = 9 if name == "DRUMS" else 0
        write(f"{d}/NACHTSTROM_{name}.mid", [(name, notes, ch)])
        allt.append((name, notes, ch))
    write(f"{d}/NACHTSTROM_ALL_PARTS.mid", allt)
    print("MIDI ok")


if __name__ == "__main__":
    main()
