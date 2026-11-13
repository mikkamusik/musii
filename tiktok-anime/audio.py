"""Synthetisiert den kompletten Soundtrack (Musik, Soundeffekte, Anime-Stimmen) mit numpy.

Aufruf: python3 audio.py <ausgabe.wav>
Alle Zeitpunkte passen zu scene.html / timeline.json.
"""
import json
import os
import sys
import wave
from pathlib import Path

import numpy as np

SR = 44100
HERE = Path(__file__).parent
TL = json.loads((HERE / "timeline.json").read_text(encoding="utf-8"))
DUR = TL["duration"]
BEAT = 60 / TL["bpm"]
N = int(SR * DUR)
rng = np.random.default_rng(7)

mix = np.zeros(N)
muffle = np.zeros(N)   # Spur, die später gedämpft wird (Weltall-Szene)


def tt(d):
    return np.arange(int(SR * d)) / SR


def add(sig, t0, gain=1.0, buf=None):
    buf = mix if buf is None else buf
    i = int(t0 * SR)
    if i >= N or i + len(sig) <= 0:
        return
    s = sig[: max(0, N - i)]
    buf[i : i + len(s)] += s * gain


def lp(x, fc):
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    X *= 1 / np.sqrt(1 + (f / fc) ** 4)
    return np.fft.irfft(X, len(x))


def hp(x, fc):
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    X *= 1 - 1 / np.sqrt(1 + (f / fc) ** 4)
    return np.fft.irfft(X, len(x))


def env(d, a=0.005, decay=None):
    t = tt(d)
    e = np.minimum(1, t / a) if a > 0 else np.ones_like(t)
    if decay:
        e *= np.exp(-t / decay)
    return e


def noise(d):
    return rng.uniform(-1, 1, int(SR * d))


# ------------------------------------------------------------- Instrumente
def kick(hard=1.0):
    t = tt(0.45)
    f = 45 + 110 * np.exp(-t / 0.04) * hard
    ph = 2 * np.pi * np.cumsum(f) / SR
    return np.tanh(np.sin(ph) * np.exp(-t / 0.18) * (1.5 + hard))


def snare():
    t = tt(0.25)
    return hp(noise(0.25), 1500) * np.exp(-t / 0.06) * 0.8 + np.sin(2 * np.pi * 190 * t) * np.exp(-t / 0.05) * 0.5


def hat(open_=False):
    d = 0.18 if open_ else 0.05
    return hp(noise(d), 7000) * np.exp(-tt(d) / (d / 3)) * 0.5


def clap():
    s = np.zeros(int(SR * 0.3))
    for k, o in enumerate([0, 0.012, 0.024]):
        b = hp(noise(0.2), 1200) * np.exp(-tt(0.2) / (0.012 if k < 2 else 0.07))
        i = int(o * SR)
        s[i : i + len(b)] += b[: len(s) - i]
    return s * 0.7


def saw(f, t):
    return 2 * ((f * t) % 1) - 1


def square(f, t):
    return np.sign(np.sin(2 * np.pi * f * t))


def note(midi):
    return 440 * 2 ** ((midi - 69) / 12)


def pad(midis, d, gain=0.12):
    t = tt(d)
    s = sum(np.sin(2 * np.pi * note(m) * t) + 0.3 * np.sin(2 * np.pi * note(m) * 2.003 * t) for m in midis)
    e = np.minimum(1, t / 0.08) * np.minimum(1, (d - t) / 0.15)
    return s * e * gain


def wobble(midi, d, rate):
    t = tt(d)
    f = note(midi)
    raw = saw(f, t) + saw(f * 1.01, t) + 0.6 * square(f / 2, t)
    lfo = 0.5 + 0.5 * np.sin(2 * np.pi * rate * t - np.pi / 2)
    # grobe "Filter"-Simulation: zwischen dumpfer und heller Version überblenden
    dark, bright = lp(raw, 180), lp(raw, 2500)
    s = dark * (1 - lfo) + bright * lfo
    s = np.tanh(s * 2.2) + 0.8 * np.sin(2 * np.pi * f / 2 * t)
    return s * np.minimum(1, t / 0.01) * np.minimum(1, (d - t) / 0.02) * 0.32


def lead(midi, d, gain=0.12):
    t = tt(d)
    f = note(midi)
    s = square(f, t) * 0.6 + saw(f * 1.005, t) * 0.4
    return lp(s, 3500) * np.exp(-t / (d * 0.7)) * gain


# ------------------------------------------------------------- Soundeffekte
def knock():
    t = tt(0.18)
    return np.sin(2 * np.pi * 95 * t) * np.exp(-t / 0.04) * 1.2 + lp(noise(0.18), 900) * np.exp(-t / 0.02)


def whoosh(d=0.6, f0=300, f1=3000):
    t = tt(d)
    n = noise(d)
    s = lp(n, f1) - lp(n, f0)
    return s * np.sin(np.pi * t / d) ** 2 * 1.4


def boom(d=2.0):
    t = tt(d)
    f = 30 + 90 * np.exp(-t / 0.08)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.6) * 1.4
    s += lp(noise(d), 600) * np.exp(-t / 0.35) * 1.2
    return np.tanh(s * 1.5)


def glass():
    d = 1.2
    t = tt(d)
    s = hp(noise(d), 4000) * np.exp(-t / 0.08) * 0.6
    for _ in range(18):
        f = rng.uniform(2500, 7500)
        o = rng.uniform(0, 0.5)
        tone = np.sin(2 * np.pi * f * t) * np.exp(-np.maximum(0, t - o) / 0.06) * (t > o) * 0.25
        s += tone
    return s


def rubble(d=1.2):
    s = np.zeros(int(SR * d))
    for _ in range(14):
        o = rng.uniform(0, d - 0.15)
        b = lp(noise(0.12), rng.uniform(400, 1500)) * np.exp(-tt(0.12) / 0.03)
        i = int(o * SR)
        s[i : i + len(b)] += b
    return s


def scratch():
    d = 0.5
    t = tt(d)
    pitch = np.abs(np.sin(2 * np.pi * 3 * t))
    s = lp(noise(d), 2500) * pitch + np.sin(2 * np.pi * np.cumsum(200 + 900 * pitch) / SR) * 0.4
    return s * np.minimum(1, (d - t) / 0.05)


def riser(d):
    t = tt(d)
    f = 150 * (2 ** (t / d * 4))
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * 0.35 + hp(noise(d), 2000) * 0.5 * (t / d)
    return s * (t / d) ** 1.5


def laser(d=0.25, f0=2500, f1=300):
    t = tt(d)
    f = f0 * (f1 / f0) ** (t / d)
    return square(1, np.cumsum(f) / SR) * np.exp(-t / d) * 0.35


def click(f=2500):
    return np.sin(2 * np.pi * f * tt(0.03)) * np.exp(-tt(0.03) / 0.006)


def sparkle_sfx():
    s = np.zeros(int(SR * 0.6))
    for k, m in enumerate([88, 91, 95, 100]):
        b = np.sin(2 * np.pi * note(m) * tt(0.3)) * np.exp(-tt(0.3) / 0.08) * 0.25
        i = int(k * 0.06 * SR)
        s[i : i + len(b)] += b
    return s


def chatter(d):
    s = np.zeros(int(SR * d))
    for k in range(int(d * 14)):
        b = click(rng.uniform(1800, 2600)) * 0.5
        i = int(k / 14 * SR)
        s[i : i + len(b)] += b[: len(s) - i]
    return s


def ufo(d):
    t = tt(d)
    f = 700 + 250 * np.sin(2 * np.pi * 6 * t)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * 0.2 * np.minimum(1, t / 0.3) * np.minimum(1, (d - t) / 0.3)


# ------------------------------------------------------------- Stimmen
CPS = 26  # wie in scene.html


def voice_blip(who, ch, idx):
    d = 0.065
    t = tt(d)
    v = (ord(ch.lower()) * 37 + idx * 11) % 9
    if who == "mikka":
        f = 520 + v * 22
        s = square(f, t) * 0.5 + np.sin(2 * np.pi * f * t) * 0.5
    elif who == "oma":
        f = (690 + v * 25) * (1 + 0.04 * np.sin(2 * np.pi * 18 * t))
        s = np.sin(2 * np.pi * np.cumsum(f) / SR) + 0.4 * np.sin(4 * np.pi * np.cumsum(f) / SR)
    else:  # blorp
        f = 170 + v * 12
        s = np.sin(2 * np.pi * f * t) * np.sin(2 * np.pi * 47 * t) * 1.6
    return lp(s, 4000) * np.sin(np.pi * t / d) * 0.22


def voices():
    for l in TL["lines"]:
        who = l["who"]
        if who not in ("mikka", "oma", "blorp"):
            continue
        text = l["text"]
        rd = min(len(text) / CPS, (l["t1"] - l["t0"]) * 0.7)
        loud = 1.6 if text.isupper() or "!!" in text else 1.0
        for i, ch in enumerate(text):
            if ch.isalpha() and i % 2 == 0:
                add(voice_blip(who, ch, i), l["t0"] + rd * i / len(text), loud)


# ------------------------------------------------------------- Arrangement
def beats(t0, t1):
    n0 = int(np.ceil(t0 / BEAT - 1e-9))
    n1 = int(np.floor((t1 - 1e-9) / BEAT))
    return [(n, n * BEAT) for n in range(n0, n1 + 1)]


LOFI = [[57, 60, 64, 67], [53, 57, 60, 64], [48, 52, 55, 59], [55, 59, 62, 65]]  # Am7 Fmaj7 Cmaj7 G7

# 0–8 s: Lofi-Beat (Hook + Intro)
for n, b in beats(0, 5.75):
    if n % 4 in (0, 3) or n % 8 == 5:
        add(kick(0.6), b, 0.7)
    if n % 4 == 2:
        add(snare(), b, 0.45)
    add(hat(), b + BEAT / 2, 0.35)
    add(hat(), b, 0.2)
for k in range(3):
    add(pad(LOFI[k % 4], BEAT * 4), k * BEAT * 4, 1.0)
add(pad(LOFI[0], 1.75), 6.0, 0.0)
add(sparkle_sfx(), 0.9, 1.0)
add(sparkle_sfx(), 2.85, 0.8)
add(whoosh(0.35), 2.8, 0.6)
# Klopfen + Musik bricht kurz ab
for k in (5.75, 5.97, 6.19):
    add(knock(), k, 1.4)
add(scratch(), 5.6, 0.5)

# 8–13 s: Build-up / Power-up
add(pad([45, 52, 57, 60], 2.2), 8.0, 1.2)
add(click(1200), 10.8, 1.5)
add(click(800), 10.82, 1.5)
add(sparkle_sfx(), 9.8, 1.0)
add(riser(2.0), 10.8, 1.0)
roll = 11.0
k = 0
while roll < 12.75:
    step = BEAT / (2 if roll < 11.5 else 4 if roll < 12.1 else 8)
    add(snare(), roll, 0.25 + 0.35 * (roll - 11) / 1.75)
    roll += step
for n, b in beats(11.0, 12.6):
    add(kick(0.8), b, 0.8)
add(whoosh(1.0, 200, 6000), 11.9, 0.7)

# 13–18 s: DER DROP
add(boom(2.0), 13.0, 1.1)
add(whoosh(0.5, 500, 5000), 13.5, 0.7)
add(glass(), 14.0, 0.9)
add(rubble(1.0), 15.3, 0.9)
add(boom(0.8), 15.3, 0.5)
add(chatter(1.9), 16.0, 0.7)
DROPNOTES = [33, 33, 36, 31]
for n, b in beats(13.0, 17.99):
    add(kick(1.2), b, 1.0)
    if n % 2 == 1:
        add(snare(), b, 0.7)
    add(hat(open_=True), b + BEAT / 2, 0.35)
for i, (n, b) in enumerate(beats(13.0, 17.99)):
    if n % 2 == 0:
        add(wobble(DROPNOTES[(i // 2) % 4], BEAT * 2, rate=4 if i % 4 < 2 else 8), b, 1.0)

# 18–24 s: Oma Hildegard
add(scratch(), 18.0, 0.9)
add(boom(1.4), 18.05, 0.9)
add(rubble(1.2), 18.05, 1.0)
add(sparkle_sfx(), 19.45, 1.0)
for k in (18.8, 19.0, 19.6):
    add(whoosh(0.3, 800, 6000), k, 0.6)
add(click(1500), 20.72, 1.5)
add(click(900), 20.75, 1.5)
add(sparkle_sfx(), 22.85, 1.0)
RAVE = [69, 72, 76, 72, 69, 74, 77, 74]
for n, b in beats(18.75, 23.99):
    if n % 2 == 0:
        add(kick(0.7), b, 0.6)
    if n % 4 == 3:
        add(snare(), b + BEAT / 2, 0.35)
    add(hat(), b + BEAT / 2, 0.25)
    add(lead(RAVE[n % 8], BEAT * 0.9, 0.10), b, 1.0)
    add(lead(RAVE[(n + 3) % 8] + 12, BEAT * 0.45, 0.05), b + BEAT / 2, 1.0)

# 24–31 s: Bass-Duell
for n, b in beats(24.0, 29.4):
    add(kick(1.1), b, 0.9)
    if n % 2 == 1:
        add(clap(), b, 0.6)
    add(hat(), b + BEAT / 4, 0.25)
    add(hat(open_=True), b + BEAT / 2, 0.3)
    add(lead(RAVE[n % 8] + (12 if b > 26 else 0), BEAT * 0.5, 0.08), b, 1.0)
for i, (n, b) in enumerate(beats(24.0, 29.4)):
    if n % 2 == 0:
        add(wobble(DROPNOTES[(i // 2) % 4], BEAT * 2, rate=8), b, 0.8)
add(boom(1.2), 24.0, 0.6)
add(whoosh(0.4), 26.05, 0.6)
for k in np.arange(28.0, 29.4, 0.12):
    add(laser(0.12, 3000, 600), k, 0.6)
    add(laser(0.12, 1800, 250), k + 0.06, 0.5)
add(riser(1.4), 28.0, 0.6)
add(boom(2.2), 29.4, 1.2)
add(rubble(1.5), 29.5, 0.5)

# 31–36 s: Weltall – derselbe Drop, nur gedämpft "durch das All"
for i, (n, b) in enumerate(beats(31.0, 35.99)):
    add(kick(1.2), b, 1.0, muffle)
    if n % 2 == 1:
        add(snare(), b, 0.6, muffle)
    if n % 2 == 0:
        add(wobble(DROPNOTES[(i // 2) % 4], BEAT * 2, rate=4), b, 1.0, muffle)
add(pad([62, 66, 69, 73], 5.0, 0.05), 31.0, 1.0)
add(whoosh(1.0, 300, 2000), 33.4, 0.5)
add(sparkle_sfx(), 33.9, 0.8)

# 36–40 s: High-Five + Outro
add(clap(), 36.55, 1.6)
add(boom(0.6), 36.55, 0.5)
add(sparkle_sfx(), 36.6, 1.0)
for k, ch in enumerate([[60, 64, 67, 71], [57, 60, 64, 67], [53, 57, 60, 65], [55, 59, 62, 67]]):
    add(pad(ch, 1.0, 0.11), 36.0 + k, 1.0)
for n, b in beats(36.0, 39.99):
    add(kick(0.7), b, 0.6)
    if n % 2 == 1:
        add(clap(), b, 0.35)
    add(hat(), b + BEAT / 2, 0.3)
add(ufo(1.6), 38.4, 1.0)
for k, m in enumerate([72, 76, 79, 84]):
    add(lead(m, 0.25, 0.12), 38.9 + k * 0.08, 1.0)

if os.environ.get('NO_VOICES') != '1':
    voices()

# ------------------------------------------------------------- Mastering
mix += lp(muffle, 350) * 0.55
mix = hp(mix, 30)
mix = np.tanh(mix * 0.9) * 0.95
mix /= np.max(np.abs(mix)) / 0.89
fade = np.ones(N)
fade[-int(0.25 * SR):] = np.linspace(1, 0, int(0.25 * SR))
mix *= fade

out = sys.argv[1] if len(sys.argv) > 1 else str(HERE / "audio.wav")
pcm = (mix * 32767).astype(np.int16)
stereo = np.repeat(pcm[:, None], 2, axis=1)
with wave.open(out, "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(stereo.tobytes())
print(f"Audio geschrieben: {out} ({DUR}s)")
