"""NACHTSTROM v2 – Renderer (raw / hypnotic / trippy, Hypnotic-Groove-Techno).

Jeder Sound wird hier synthetisiert – keine Samples, keine Presets.
python3 render.py  ->  ../Samples/Stems/*.flac, ../bounce/*
"""
import os
import subprocess
import time

import numpy as np
import soundfile as sf
from scipy.signal import resample_poly

import compose as C
from dsp import (SR, saw, pulse, svf, lp, hp, bp, reverb, compressor, limiter,
                 sat, db, tape_delay, phaser, fold, smooth, limiter_fast)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RNG = np.random.default_rng(145)
TAIL = 4.0
N = int((C.BEATS * C.SPB + TAIL) * SR)
BEAT_AT = np.arange(N) / SR / C.SPB
BAR_AT = BEAT_AT / 4.0


def smp(beat):
    return max(0, int(round(beat * C.SPB * SR)))


def mtof(m):
    return 440.0 * 2 ** ((m - 69) / 12.0)


def add(buf, sig, beat, gain=1.0):
    s = smp(beat)
    if s >= buf.shape[-1]:
        return
    e = min(buf.shape[-1], s + sig.shape[-1])
    buf[..., s:e] += sig[..., : e - s] * gain


def pan(sig, p):
    a = (p + 1) * np.pi / 4
    return np.array([sig * np.cos(a), sig * np.sin(a)]) * np.sqrt(2)


def autopan(x, period_beats, depth, phase=0.0):
    p = depth * np.sin(2 * np.pi * BEAT_AT[: x.shape[0]] / period_beats + phase)
    a = (p + 1) * np.pi / 4
    return np.array([x * np.cos(a), x * np.sin(a)]) * np.sqrt(2)


def env_exp(n, tau, hold=0.0):
    t = np.arange(n) / SR
    e = np.where(t < hold, 1.0, np.exp(-(t - hold) / tau))
    f = min(n, int(0.004 * SR))
    e[-f:] *= np.linspace(1, 0, f)
    return e


def noise(n):
    return RNG.standard_normal(n)


def stereo(x):
    return np.array([x, x])


def tube(x, drive=2.0, bias=0.18):
    """Asymmetrische, warme Saettigung (gerade + ungerade Obertoene)."""
    y = np.tanh(drive * (x + bias)) - np.tanh(drive * bias)
    return y / np.tanh(drive)


def tape(l, r, beats, wow_ms, rate, fb, damp=0.45, drive=1.6, cross=1.0):
    base = beats * C.SPB * SR
    depth = np.asarray(wow_ms, dtype=float) * SR / 1000.0
    if depth.ndim == 0:
        depth = np.full(l.shape[0], float(depth))
    return tape_delay(l, r, base, depth, rate, fb, damp, drive, cross)


# ====================================================================== KICK
def kick_one():
    n = int(0.36 * SR)
    t = np.arange(n) / SR
    f = 44.0 + 150 * np.exp(-t / 0.011) + 45 * np.exp(-t / 0.045)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR)
    amp = np.where(t < 0.05, 1.0, np.exp(-(t - 0.05) / 0.13))
    amp[-500:] *= np.linspace(1, 0, 500)
    knock = lp(noise(n), 1400) * np.exp(-t / 0.004) * 0.5
    dry = body * amp
    k = tube(dry + knock, 2.6, 0.12)
    return k / np.max(np.abs(k)), dry


def render_kick():
    k, dry = kick_one()
    out = np.zeros(N)
    ghost = np.zeros(N)
    for b, v in C.kick_hits():
        add(out, k, b, v)
        add(ghost, dry, b, v)
    out = svf(out, C.kick_hp(BEAT_AT), 0.2, 2)
    return out, ghost


def sidechain(depth, tau=0.12):
    g = np.ones(N)
    L = int(0.45 * SR)
    t = np.arange(L) / SR
    curve = 1 - depth * np.exp(-t / tau)
    att = int(0.003 * SR)
    for b, v in C.kick_hits():
        s = smp(b)
        e = min(N, s + L)
        seg = 1 - (1 - curve[: e - s]) * v
        g[s:e] = np.minimum(g[s:e], seg)
        a0 = max(0, s - att)
        g[a0:s] = np.minimum(g[a0:s], np.linspace(1, seg[0], s - a0))
    return g


# ====================================================================== RUMBLE
def render_rumble(ghost):
    wet = reverb(ghost, size=0.92, damp=0.6, predelay_ms=6)
    r = 0.5 * (wet[0] + wet[1])
    r = svf(r, C.rumble_cutoff(BEAT_AT), 0.4, 0)
    r = tube(r * 7.0, 2.8, 0.2)
    r = svf(r, np.full(N, 230.0), 0.1, 0)
    r = hp(r, 30)
    r *= C.rumble_shape(BEAT_AT) * C.rumble_gain(BEAT_AT)
    return r


# ====================================================================== DIRTY BASS
def render_bass():
    """Warm & dreckig: Square + Sinus-Sub, Filter eher zu, Roehren-Saettigung."""
    out = np.zeros(N)
    cut = C.bass_cutoff(BEAT_AT)
    for nt in C.bass_notes():
        dur = nt.dur * C.SPB
        n = int((dur + 0.03) * SR)
        t = np.arange(n) / SR
        f0 = mtof(nt.pitch)
        f = np.full(n, f0)
        osc = 0.55 * pulse(f, 0.5, RNG.uniform()) + 0.8 * np.sin(2 * np.pi * f0 * t)
        c0 = cut[min(N - 1, smp(nt.start))]
        fc = c0 * (1 + 1.4 * nt.vel * np.exp(-t / 0.025))
        y = svf(osc, fc, 0.22, 0)
        amp = np.where(t < dur, np.exp(-t / 0.13), np.exp(-dur / 0.13) * np.exp(-(t - dur) / 0.008))
        amp[:100] *= np.linspace(0, 1, 100)
        add(out, y * amp, nt.start, nt.vel)
    out = tube(out * 1.8, 2.2, 0.25)          # Dreck: asymmetrische Saettigung
    out = svf(out, np.full(N, 1600.0), 0.0, 0)  # Fizz weg -> warm, nicht aggressiv
    return hp(out, 30)


# ====================================================================== HATS / RIDE / CLAP
def metal(n, scale=1.0):
    t = np.arange(n) / SR
    fr = np.array([205.3, 304.4, 369.6, 522.7, 540.0, 800.0]) * 2.0 * scale
    s = np.zeros(n)
    for fq in fr:
        s += np.sign(np.sin(2 * np.pi * fq * t + RNG.uniform(0, 6.28)))
    return s / 6.0


def crush(x, hold=2):
    """Sample-Rate-Reduktion fuer rohen Grit."""
    y = x.copy()
    for k in range(1, hold):
        y[k::hold] = x[::hold][: y[k::hold].shape[0]]
    return y


def hat_one(kind):
    if kind == "c":
        n = int(0.07 * SR)
        x = noise(n) * 0.8 + metal(n) * 0.35
        x = hp(crush(x, 2), 7000)
        return x * env_exp(n, 0.014)
    if kind == "o":
        n = int(0.35 * SR)
        x = noise(n) * 0.7 + metal(n, 1.02) * 0.5
        x = hp(bp(x, 8500, 0.25), 5500)
        return x * env_exp(n, 0.085, 0.008)
    n = int(0.06 * SR)
    x = hp(bp(noise(n), 5200, 0.2), 3500)
    t = np.arange(n) / SR
    return x * np.minimum(t / 0.004, 1) * np.exp(-t / 0.02)


def render_hats():
    out = np.zeros((2, N))
    bank = {k: [hat_one(k) for _ in range(6)] for k in "cos"}
    pans = {"c": -0.2, "o": 0.12, "s": 0.5}
    gains = {"c": 0.9, "o": 0.5, "s": 0.4}
    for b, kind, v in C.hat_events():
        s_ = bank[kind][RNG.integers(6)]
        add(out, pan(s_, pans[kind] + RNG.uniform(-0.1, 0.1)), b, v * gains[kind])
    hpc = 2800 * 2.0 ** (1.0 * np.sin(2 * np.pi * BEAT_AT / 27.0))
    out = np.array([svf(out[0], hpc, 0.2, 2), svf(out[1], hpc, 0.2, 2)])
    # Phaser in den hypnotischsten Teilen
    ph = np.array([phaser(out[0], 0.09, 400, 9000, 0.55, 6, 0.0),
                   phaser(out[1], 0.09, 400, 9000, 0.55, 6, 1.6)])
    amt = (((BAR_AT >= 64) & (BAR_AT < 92)) | ((BAR_AT >= 112) & (BAR_AT < 160))).astype(float)
    amt = smooth(amt, 4410)
    return out * (1 - amt) + ph * amt


def render_ride():
    out = np.zeros((2, N))
    n = int(0.9 * SR)
    t = np.arange(n) / SR
    bell = sum(np.sin(2 * np.pi * f * t) * a for f, a in ((523, 0.5), (1331, 0.4), (2273, 0.35), (3571, 0.3)))
    x = metal(n, 2.3) * 0.6 + hp(noise(n), 7000) * 0.5
    x = hp(x, 2500) * env_exp(n, 0.28, 0.004) + hp(bell, 400) * 0.3 * np.exp(-t / 0.05)
    for b, v in C.ride_events():
        add(out, pan(x, 0.3), b, v)
    return out


def clap_one():
    n = int(0.45 * SR)
    t = np.arange(n) / SR
    e = np.zeros(n)
    for k, o in enumerate((0.0, 0.011, 0.021, 0.033)):
        s = int(o * SR)
        e[s:] += np.exp(-(t[: n - s]) / 0.004) * (0.75 if k < 3 else 1.0)
    s = int(0.033 * SR)
    e[s:] += 0.5 * np.exp(-t[: n - s] / 0.09)
    x = bp(noise(n), 1050, 0.35) * 1.6 + hp(noise(n), 2500) * 0.2
    return tube(hp(x * e, 300), 1.6, 0.05)


def render_clap():
    dry = np.zeros(N)
    c = clap_one()
    for b, v in C.clap_events():
        add(dry, c, b + 0.01 * (RNG.random() - 0.5), v)
    wet = reverb(dry, size=0.9, damp=0.55, predelay_ms=22)
    return stereo(dry) + wet * 0.55


# ====================================================================== PERC (Tribal / Groove)
def tom(f, tau, bend=0.6):
    n = int(0.45 * SR)
    t = np.arange(n) / SR
    fr = f * (1 + bend * np.exp(-t / 0.016))
    x = np.sin(2 * np.pi * np.cumsum(fr) / SR) + 0.12 * bp(noise(n), f * 3.5, 0.3)
    return tube(x, 1.8, 0.1) * env_exp(n, tau)


def rim():
    n = int(0.07 * SR)
    t = np.arange(n) / SR
    x = np.sin(2 * np.pi * 1650 * t) * 0.6 + np.sin(2 * np.pi * 455 * t) * 0.6 + bp(noise(n), 2600, 0.5)
    return x * env_exp(n, 0.010)


def render_perc():
    kit = {"tl": (tom(87.3, 0.16), -0.4), "tm": (tom(130.8, 0.2), 0.3),
           "cg": (tom(207.7, 0.09, 0.3), 0.55), "ch": (tom(261.6, 0.07, 0.25), -0.55)}
    body = np.zeros((2, N))
    rims = np.zeros(N)
    for b, kind, v in C.perc_events():
        if kind == "rim":
            add(rims, rim(), b, v * 0.55)
            continue
        s_, p = kit[kind]
        add(body, pan(s_, p + RNG.uniform(-0.08, 0.08)), b, v * 0.7)
    # Rim durch Dub-Tape-Delay -> trippige Echos
    dl, dr = tape(rims, rims, 0.75, 2.5, 0.35, 0.52, 0.5, 1.8, 1.0)
    rim_st = pan(rims, 0.35) + np.array([hp(dl, 400), hp(dr, 400)]) * 0.45
    wet = reverb(body[0] + body[1], size=0.78, damp=0.5, predelay_ms=18)
    body = np.array([hp(body[0], 70), hp(body[1], 70)])
    return body + wet * 0.2 + rim_st


# ====================================================================== HYPNO-SEQUENZ
def render_seq():
    dry = np.zeros(N)
    cut = C.seq_cutoff(BEAT_AT)
    fld = C.seq_fold(BEAT_AT)
    for nt in C.seq_notes():
        dur = nt.dur * C.SPB
        n = int((dur + 0.06) * SR)
        t = np.arange(n) / SR
        f0 = mtof(nt.pitch)
        f = np.full(n, f0)
        i0 = min(N - 1, smp(nt.start))
        src = 0.7 * np.sin(2 * np.pi * f0 * t + RNG.uniform(0, 6.28)) + 0.45 * saw(f, RNG.uniform())
        src = fold(src * 0.8, fld[i0])
        fc = cut[i0] * (1 + 1.6 * nt.vel * np.exp(-t / (0.05 if not nt.accent else 0.09)))
        y = svf(src, fc, 0.58, 0)
        tau = 0.16 if nt.accent else 0.08
        amp = np.where(t < dur, np.exp(-t / tau), np.exp(-dur / tau) * np.exp(-(t - dur) / 0.012))
        amp[:40] *= np.linspace(0, 1, 40)
        add(dry, np.tanh(1.5 * y * amp), nt.start, nt.vel)
    dry = hp(dry, 70)
    st = autopan(dry, 3.0, 0.45)
    send = C.seq_delay_send(BEAT_AT)
    dl, dr = tape(st[0] * send, st[1] * send, 0.75, C.seq_wow(BEAT_AT), 0.55, 0.58, 0.45, 1.7, 1.0)
    dl = phaser(hp(dl, 200), 0.07, 300, 5000, 0.4, 6, 0.0)
    dr = phaser(hp(dr, 200), 0.07, 300, 5000, 0.4, 6, 1.9)
    rv = reverb(dry, size=0.86, damp=0.45, predelay_ms=20)
    rv_amt = np.where(C.TRIP_MASK(BAR_AT), 0.4, 0.14)
    return st + np.array([dl, dr]) * 0.6 + rv * rv_amt


# ====================================================================== 3/16 METALL-PERC
def render_bleeps():
    dry = np.zeros(N)
    for nt in C.bleep_notes():
        n = int(0.25 * SR)
        t = np.arange(n) / SR
        f0 = mtof(nt.pitch)
        mod = np.sin(2 * np.pi * f0 * 2.76 * t) * 2.2 * np.exp(-t / 0.02)
        x = np.sin(2 * np.pi * f0 * t + mod) * np.sin(2 * np.pi * f0 * 1.414 * t)
        add(dry, x * env_exp(n, 0.045), nt.start, nt.vel)
    dry = hp(dry, 400)
    st = autopan(dry, 5.0, 0.7, 1.0)
    dl, dr = tape(st[0], st[1], 0.5, 3.0, 0.4, 0.55, 0.5, 1.5, 1.0)
    return st + np.array([dl, dr]) * 0.5


# ====================================================================== FORMANT-STIMME
VOWELS = np.array([[800, 1150, 2800], [450, 800, 2830], [270, 2100, 3000],
                   [325, 700, 2530], [400, 1600, 2700]], dtype=float)  # a o i u e


def vowel_track(v0, v1, n):
    pos = np.linspace(v0, v1, n) % 5
    i0 = np.floor(pos).astype(int) % 5
    i1 = (i0 + 1) % 5
    fr = (pos - np.floor(pos))[:, None]
    return VOWELS[i0] * (1 - fr) + VOWELS[i1] * fr


def render_voice():
    dry = np.zeros(N)
    for nt in C.voice_notes():
        dur = nt.dur * C.SPB
        n = int((dur + 0.15) * SR)
        t = np.arange(n) / SR
        f = mtof(nt.pitch) * 2 ** (0.12 * np.sin(2 * np.pi * 5.3 * t) * np.minimum(t / 0.3, 1) / 12)
        src = saw(f, RNG.uniform()) + 0.6 * saw(f * 1.004) + 0.05 * noise(n)
        fm = vowel_track(nt.v0, nt.v1, n)
        fm = np.ascontiguousarray(fm.T)
        y = svf(src, fm[0], 0.9, 1) * 1.0 + svf(src, fm[1], 0.9, 1) * 0.6 + svf(src, fm[2], 0.9, 1) * 0.3
        amp = np.minimum(t / 0.025, 1) * np.where(t < dur, 1.0, np.exp(-(t - dur) / 0.05))
        add(dry, np.tanh(1.2 * y * amp), nt.start, nt.vel)
    dry = hp(dry, 150)
    st = autopan(dry, 7.0, 0.3, 2.0)
    dl, dr = tape(st[0], st[1], 0.75, 4.5, 0.3, 0.55, 0.5, 1.6, 1.0)
    rv = reverb(dry, size=0.9, damp=0.4, predelay_ms=30)
    return st + np.array([dl, dr]) * 0.5 + rv * 0.4


# ====================================================================== TEXTUR (kein Riser!)
def render_texture():
    """Wandernder, resonanter Rausch-Nebel – nur in Intro & Trips, konstant leise."""
    nl, nr = noise(N), noise(N)
    fc = 350 * 2.0 ** (2.5 * (0.5 + 0.5 * np.sin(2 * np.pi * BEAT_AT / 41.0)))
    x = np.array([svf(nl, fc, 0.86, 1), svf(nr, fc * 1.07, 0.86, 1)])
    g = np.zeros(N)
    g = np.where(BAR_AT < 16, 0.5, g)
    g = np.where(C.TRIP_MASK(BAR_AT), 1.0, g)
    g = smooth(g, SR)  # weich ein/aus
    return x * g


# ====================================================================== MIX
REGION = {  # Messbereich je Stem (Takte), in dem er voll spielt
    "01 KICK": (96, 128), "02 RUMBLE": (96, 128), "03 DIRTY BASS": (96, 128),
    "04 HATS": (96, 112), "05 RIDE": (96, 128), "06 CLAP": (96, 128),
    "07 PERC": (96, 128), "08 HYPNO SEQ": (96, 128), "09 METAL 3-16": (96, 128),
    "10 VOICE": (80, 92), "11 TEXTURE": (80, 92),
}
TARGET = {
    "01 KICK": -12.0, "02 RUMBLE": -16.0, "03 DIRTY BASS": -18.0, "04 HATS": -23.0,
    "05 RIDE": -28.0, "06 CLAP": -24.5, "07 PERC": -22.5, "08 HYPNO SEQ": -18.5,
    "09 METAL 3-16": -27.0, "10 VOICE": -24.0, "11 TEXTURE": -31.0,
}
CREST = {  # max. Crest-Faktor (dB ueber RMS) – Transienten-Clipping wie im Studio
    "04 HATS": 13.0, "05 RIDE": 13.0, "06 CLAP": 15.0, "07 PERC": 14.0,
    "08 HYPNO SEQ": 13.0, "09 METAL 3-16": 13.0, "10 VOICE": 13.0,
}
SC_DEPTH = {"03 DIRTY BASS": 0.7, "08 HYPNO SEQ": 0.35, "10 VOICE": 0.3,
            "09 METAL 3-16": 0.2, "04 HATS": 0.1, "05 RIDE": 0.15, "11 TEXTURE": 0.5}


def rms_db(x, b0, b1):
    s, e = smp(b0 * 4), smp(b1 * 4)
    seg = x[..., s:e]
    return 20 * np.log10(np.sqrt(np.mean(seg ** 2)) + 1e-12)


def soft_clip(x, c):
    k = c * 0.6
    y = x.copy()
    a = np.abs(y)
    over = a > k
    y[over] = np.sign(y[over]) * (k + (c - k) * np.tanh((a[over] - k) / (c - k)))
    return y


def true_peak_safe(m, tp_db):
    up = resample_poly(m, 4, 1, axis=1)
    k, c = db(tp_db - 2.0), db(tp_db - 0.2)
    a = np.abs(up)
    over = a > k
    up[over] = np.sign(up[over]) * (k + (c - k) * np.tanh((a[over] - k) / (c - k)))
    m = resample_poly(up, 1, 4, axis=1)
    tp = np.max(np.abs(resample_poly(m, 4, 1, axis=1)))
    return m * min(1.0, db(tp_db) / tp)


def main():
    t0 = time.time()
    stems = {}
    kick, ghost = render_kick()
    stems["01 KICK"] = kick
    stems["02 RUMBLE"] = render_rumble(ghost)
    stems["03 DIRTY BASS"] = render_bass()
    print("low end", round(time.time() - t0))
    stems["04 HATS"] = render_hats()
    stems["05 RIDE"] = render_ride()
    stems["06 CLAP"] = render_clap()
    stems["07 PERC"] = render_perc()
    print("drums", round(time.time() - t0))
    stems["08 HYPNO SEQ"] = render_seq()
    stems["09 METAL 3-16"] = render_bleeps()
    stems["10 VOICE"] = render_voice()
    stems["11 TEXTURE"] = render_texture()
    print("synths", round(time.time() - t0))

    sc = {d: sidechain(d) for d in set(SC_DEPTH.values())}
    for name, d in SC_DEPTH.items():
        stems[name] = stems[name] * sc[d]
    for name, tgt in TARGET.items():
        a, b = REGION[name]
        stems[name] = stems[name] * db(tgt - rms_db(stems[name], a, b))
        if name in CREST:
            stems[name] = soft_clip(stems[name], db(tgt + CREST[name]))
            stems[name] = stems[name] * db(tgt - rms_db(stems[name], a, b))

    mix = np.zeros((2, N))
    for s in stems.values():
        mix += s if s.ndim == 2 else stereo(s)
    head = db(-1.0) / np.max(np.abs(mix))
    for k in stems:
        stems[k] = stems[k] * head
    mix *= head

    m = np.array([hp(c, 22) for c in mix])
    m = np.array([c + (db(2.0) - 1) * hp(c, 3000, 0.1) + (db(1.5) - 1) * bp(c, 1800, 0.2) for c in m])
    m = compressor(m, 0.5 * (m[0] + m[1]), -16.0, 2.0, 20.0, 160.0, 2.0)
    m = m * db(-7.5 - rms_db(m, 96, 128))
    # Clipper (4x oversampled) -> Limiter -> True-Peak-Check
    up = resample_poly(m, 4, 1, axis=1)
    up = soft_clip(up, db(-1.0))
    m = resample_poly(up, 1, 4, axis=1)
    m = limiter_fast(m, db(-1.3), int(0.003 * SR), 60.0)
    tp = np.max(np.abs(resample_poly(m, 4, 1, axis=1)))
    m = m * min(1.0, db(-1.0) / tp)
    print("master", round(time.time() - t0))

    sd = f"{ROOT}/Samples/Stems"
    os.makedirs(sd, exist_ok=True)
    for f in os.listdir(sd):
        os.remove(os.path.join(sd, f))
    os.makedirs(f"{ROOT}/bounce", exist_ok=True)
    end = smp(C.BEATS) + int(3.0 * SR)
    for name, s in stems.items():
        sf.write(f"{sd}/{name.replace(' ', '_')}.flac", s[..., :end].T, SR, subtype="PCM_16")
    m = m[:, :end]
    fo = int(2.5 * SR)
    m[:, -fo:] *= np.linspace(1, 0, fo)
    sf.write(f"{ROOT}/bounce/NACHTSTROM_master.flac", m.T, SR, subtype="PCM_16")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", f"{ROOT}/bounce/NACHTSTROM_master.flac",
                    "-b:a", "320k", f"{ROOT}/bounce/NACHTSTROM_master.mp3"], check=True)
    print("fertig", round(time.time() - t0))


if __name__ == "__main__":
    main()
