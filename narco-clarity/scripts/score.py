#!/usr/bin/env python3
"""timeline.json -> bed.wav

The bed follows the film's argument rather than looping under it: a low
drone throughout, a semitone of friction once the tipping point is
explained, a 68 bpm pulse (resting heart rate) through the heaviest
stretch, an open chord where the film turns constructive, and silence
under the closing helpline card. Silence there is deliberate - numbers
that matter should not arrive over music.
"""
import json, os, wave
import numpy as np

SR = 48000
TENSION_FROM = ("down", "toleranz", "kipppunkt")   # scene keys that start the friction
RESOLVE_FROM = ("help", "hilft", "ausweg")         # scene keys that resolve it


def pick(order, scenes, names, default_frac):
    for n in names:
        if n in scenes:
            return scenes[n]["start"]
    total = scenes[order[-1]]["end"]
    return total * default_frac


def main():
    tl = json.load(open("timeline.json", encoding="utf-8"))
    S, order, total = tl["scenes"], tl["order"], tl["total"]
    t = np.arange(int(total * SR)) / SR

    def ramp(a, b):
        return np.clip((t - a) / max(1e-6, b - a), 0, 1)

    def sine(f, ph=0.0):
        return np.sin(2 * np.pi * f * t + ph)

    t_in = pick(order, S, TENSION_FROM, 0.33)
    t_out = pick(order, S, RESOLVE_FROM, 0.74)
    outro = S[order[-1]]["start"]
    pad_in = S[order[min(2, len(order) - 1)]]["start"]

    low = 0.55 * sine(46.0) + 0.48 * sine(46.55)
    pad = (0.15 * sine(138.0) + 0.12 * sine(184.2) + 0.10 * sine(230.0))
    pad *= 0.72 + 0.28 * np.sin(2 * np.pi * 0.055 * t)
    pad *= ramp(pad_in - 2, pad_in + 6)
    tension = 0.11 * sine(243.6) * ramp(t_in, t_in + 10) * (1 - ramp(t_out - 3, t_out + 3))
    resolve = (0.13 * sine(220.0) + 0.095 * sine(330.0) + 0.07 * sine(165.0)) \
        * ramp(t_out - 1, t_out + 5)

    bed = low + pad + tension + resolve
    depth = 0.34 * ramp(t_in + 8, t_in + 22) * (1 - ramp(t_out - 6, t_out))
    bed *= 1 - depth * (0.5 + 0.5 * np.cos(2 * np.pi * (68 / 60) * t))
    bed *= ramp(0.0, 3.0)
    bed *= 1 - ramp(outro - 3.0, outro + 1.5)

    st = np.tanh(np.stack([bed + 0.05 * sine(46.0, 0.4),
                           bed + 0.05 * sine(46.55, 1.1)], axis=1) * 0.8)
    st *= 0.30 / np.max(np.abs(st))
    pcm = (st * 32767).astype("<i2")
    with wave.open("bed.wav", "w") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    print(f"Tonbett {total:.1f}s (Reibung ab {t_in:.0f}s, Auflösung ab {t_out:.0f}s)")


if __name__ == "__main__":
    main()
