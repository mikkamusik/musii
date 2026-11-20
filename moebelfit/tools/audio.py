#!/usr/bin/env python3
"""Tonspur für ein MöbelFit-Video: Beat (124 BPM) + Countdown-Pieptöne.

  python3 audio.py segments.json out.wav
segments.json: {"segs":[{"kind":"work","dur":40},...], "outro": 5}
"""
import json
import sys
import wave

import numpy as np

SR = 22050
BPM = 124
BEAT = 60 / BPM
rng = np.random.default_rng(7)


def env(n, decay):
    return np.exp(-np.arange(n) / (decay * SR))


def kick():
    n = int(0.22 * SR)
    t = np.arange(n) / SR
    f = 45 + 95 * np.exp(-t / 0.03)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * env(n, 0.07)


def hat(level=1.0):
    n = int(0.05 * SR)
    x = np.diff(rng.standard_normal(n + 1))
    return 0.18 * level * x * env(n, 0.012)


def clap():
    n = int(0.14 * SR)
    x = np.diff(rng.standard_normal(n + 1))
    return 0.22 * x * env(n, 0.035)


def bass(freq, length=0.2):
    n = int(length * SR)
    t = np.arange(n) / SR
    s = np.sin(2 * np.pi * freq * t) + 0.3 * np.sin(4 * np.pi * freq * t)
    return 0.32 * s * env(n, 0.09)


def place(buf, snd, at):
    i = int(at * SR)
    j = min(len(buf), i + len(snd))
    if i < len(buf):
        buf[i:j] += snd[: j - i]


def bar(kind, idx):
    n = int(4 * BEAT * SR)
    b = np.zeros(n)
    notes = [55.0, 55.0, 65.41, 49.0][idx % 4]
    if kind == "work":
        for k in range(4):
            place(b, kick(), k * BEAT)
            place(b, hat(), k * BEAT + BEAT / 2)
            place(b, bass(notes), k * BEAT + BEAT / 2)
        place(b, clap(), BEAT)
        place(b, clap(), 3 * BEAT)
    else:  # Pause / Bereit machen: luftig
        for k in range(4):
            place(b, hat(0.6), k * BEAT + BEAT / 2)
        place(b, bass(notes, 0.5) * 0.6, 0)
        place(b, bass(notes * 1.5, 0.5) * 0.4, 2 * BEAT)
    return b


def tone(freq, length, vol=0.5):
    n = int(length * SR)
    t = np.arange(n) / SR
    a = np.minimum(1, t / 0.005) * np.exp(-t / (length * 0.6))
    return vol * np.sin(2 * np.pi * freq * t) * a


def main():
    spec = json.load(open(sys.argv[1]))
    segs, outro = spec["segs"], spec.get("outro", 5)
    total = sum(s["dur"] for s in segs) + outro
    music = np.zeros(int(total * SR) + SR)
    fx = np.zeros_like(music)
    barlen = 4 * BEAT
    # Beat-Raster durchgehend, Muster je nach Segment
    t, start = 0.0, 0.0
    bounds = []
    for s in segs:
        bounds.append((start, start + s["dur"], s["kind"]))
        start += s["dur"]
    nb = int(total / barlen) + 1
    for i in range(nb):
        bt = i * barlen
        kind = "rest"
        for a, b, k in bounds:
            if a <= bt + 0.01 < b:
                kind = k
        if bt >= start:
            kind = "rest" if bt < start + outro else None
        if kind:
            place(music, bar("work" if kind == "work" else "rest", i), bt)
    # Pieptöne
    for a, b, k in bounds:
        place(fx, tone(990 if k == "work" else 520, 0.35, 0.55), a)
        for sec in (3, 2, 1):
            if b - a > sec + 0.5:
                place(fx, tone(660, 0.12, 0.45), b - sec)
    for f, d in ((523.25, 0.0), (659.25, 0.15), (783.99, 0.3), (1046.5, 0.45)):
        place(fx, tone(f, 0.6, 0.4), start + d)
    # Musik am Ende ausblenden
    fade = int(outro * SR)
    e = int(total * SR)
    music[e - fade:e] *= np.linspace(1, 0, fade)
    music[e:] = 0
    mix = 0.55 * music + fx
    mix = np.tanh(mix * 1.2) * 0.9
    pcm = (mix[:e] * 32767).astype(np.int16)
    with wave.open(sys.argv[2], "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


if __name__ == "__main__":
    main()
