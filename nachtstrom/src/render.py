"""NACHTSTROM – Renderer. Synthetisiert jeden Sound selbst und mischt den Track.

python3 render.py  ->  ../stems/*.flac, ../bounce/*.flac|mp3
"""
import os
import subprocess
import time

import numpy as np
import soundfile as sf
from scipy.signal import resample_poly

import compose as C
from dsp import (SR, saw, pulse, sine_fm, svf, ladder, lp, hp, bp, reverb,
                 pingpong, compressor, limiter, sat, db)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RNG = np.random.default_rng(145)
TAIL = 4.0
N = int((C.BEATS * C.SPB + TAIL) * SR)
BEAT_AT = np.arange(N) / SR / C.SPB  # Beat-Position je Sample


def smp(beat):
    return int(round(beat * C.SPB * SR))


def mtof(m):
    return 440.0 * 2 ** ((m - 69) / 12.0)


def add(buf, sig, beat, gain=1.0):
    s = smp(beat)
    if s >= buf.shape[-1]:
        return
    e = min(buf.shape[-1], s + sig.shape[-1])
    buf[..., s:e] += sig[..., : e - s] * gain


def pan(sig, p):
    """p -1 (links) .. +1 (rechts), equal power."""
    a = (p + 1) * np.pi / 4
    return np.array([sig * np.cos(a), sig * np.sin(a)]) * np.sqrt(2)


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


# ====================================================================== KICK
def kick_one():
    n = int(0.40 * SR)
    t = np.arange(n) / SR
    f = 43.65 + 230 * np.exp(-t / 0.009) + 60 * np.exp(-t / 0.05)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR)
    amp = np.where(t < 0.055, 1.0, np.exp(-(t - 0.055) / 0.15))
    amp[-400:] *= np.linspace(1, 0, 400)
    click = hp(noise(n), 2500) * np.exp(-t / 0.002) * 0.35
    click += np.sin(2 * np.pi * 1900 * t) * np.exp(-t / 0.003) * 0.25
    dry = body * amp
    k = np.tanh(2.4 * (dry + click)) / np.tanh(2.4)
    return k, dry


def render_kick():
    k, dry = kick_one()
    out = np.zeros(N)
    ghost = np.zeros(N)
    for b, v in C.kick_hits():
        add(out, k, b, v)
        add(ghost, dry, b, v)
    out = svf(out, C.kick_hp(BEAT_AT), 0.2, 2)
    return out, ghost


def sidechain(depth, tau=0.11):
    g = np.ones(N)
    L = int(0.45 * SR)
    t = np.arange(L) / SR
    curve = 1 - depth * np.exp(-t / tau)
    att = int(0.002 * SR)
    for b, v in C.kick_hits():
        s = smp(b)
        e = min(N, s + L)
        seg = curve[: e - s] if v > 0.85 else 1 - (1 - curve[: e - s]) * v
        g[s:e] = np.minimum(g[s:e], seg)
        a0 = max(0, s - att)
        g[a0:s] = np.minimum(g[a0:s], np.linspace(1, seg[0], s - a0))
    return g


# ====================================================================== RUMBLE
def render_rumble(ghost):
    wet = reverb(ghost, size=0.90, damp=0.55, predelay_ms=8)
    r = 0.5 * (wet[0] + wet[1])
    r = svf(r, np.full(N, 170.0), 0.35, 0)
    r = sat(r * 6.0, 2.5)
    r = svf(r, np.full(N, 210.0), 0.1, 0)
    r = hp(r, 32)
    ph = BEAT_AT % 1.0
    duck = np.clip((ph - 0.06) / 0.28, 0, 1) ** 1.4
    roll = 0.72 + 0.28 * (0.5 - 0.5 * np.cos(2 * np.pi * 4 * ph))
    r *= duck * roll * C.rumble_gain(BEAT_AT)
    return r


# ====================================================================== BASS
def render_bass():
    out = np.zeros(N)
    cut = C.bass_cutoff(BEAT_AT)
    for nt in C.bass_notes():
        dur = nt.dur * C.SPB
        n = int((dur + 0.02) * SR)
        f = np.full(n, mtof(nt.pitch))
        t = np.arange(n) / SR
        osc = 0.75 * saw(f) + 0.55 * np.sin(2 * np.pi * f * t)
        c0 = cut[min(N - 1, smp(nt.start))]
        fc = c0 * (1 + 3.2 * nt.vel * np.exp(-t / 0.03))
        y = svf(osc, fc, 0.45, 0)
        amp = np.where(t < dur, np.exp(-t / 0.085), np.exp(-dur / 0.085) * np.exp(-(t - dur) / 0.004))
        amp[: 40] *= np.linspace(0, 1, 40)
        add(out, y * amp, nt.start, nt.vel)
    out = sat(out * 1.6, 1.8)
    return hp(out, 33)


# ====================================================================== HATS
def metal(n, scale=1.0):
    t = np.arange(n) / SR
    fr = np.array([205.3, 304.4, 369.6, 522.7, 540.0, 800.0]) * 2.0 * scale
    s = np.zeros(n)
    for f in fr:
        s += np.sign(np.sin(2 * np.pi * f * t + RNG.uniform(0, 6.28)))
    return s / 6.0


def hat_one(kind):
    if kind == "c":
        n = int(0.09 * SR)
        x = metal(n) * 0.8 + noise(n) * 0.5
        x = hp(bp(x, 9800, 0.35), 6500)
        return x * env_exp(n, 0.016)
    if kind == "o":
        n = int(0.45 * SR)
        x = metal(n, 1.02) * 0.8 + noise(n) * 0.6
        x = hp(bp(x, 9000, 0.3), 6000)
        return x * env_exp(n, 0.11, 0.01)
    n = int(0.08 * SR)
    x = hp(bp(noise(n), 6500, 0.2), 4000)
    t = np.arange(n) / SR
    e = np.minimum(t / 0.006, 1) * np.exp(-t / 0.025)
    return x * e


def render_hats():
    out = np.zeros((2, N))
    bank = {k: [hat_one(k) for _ in range(4)] for k in "cos"}
    pans = {"c": -0.25, "o": 0.1, "s": 0.45}
    gains = {"c": 0.9, "o": 0.55, "s": 0.35}
    for b, kind, v in C.hat_events():
        q = round((b * 4) % 4)
        if q in (1, 3):
            b += 0.25 * 0.10  # Swing auf die geraden 16tel
        smp_ = bank[kind][RNG.integers(4)]
        add(out, pan(smp_, pans[kind] + RNG.uniform(-0.08, 0.08)), b, v * gains[kind])
    # Bewegung: Hochpass atmet ueber 8 Takte
    hpc = 3000 * 2.2 ** np.sin(2 * np.pi * BEAT_AT / 32.0)
    return np.array([svf(out[0], hpc, 0.25, 2), svf(out[1], hpc, 0.25, 2)])


def render_ride():
    out = np.zeros((2, N))
    n = int(1.1 * SR)
    t = np.arange(n) / SR
    bell = sum(np.sin(2 * np.pi * f * t) * a for f, a in
               ((523, 0.5), (1331, 0.4), (2273, 0.35), (3571, 0.3), (5113, 0.2)))
    x = metal(n, 2.3) * 0.6 + hp(noise(n), 7000) * 0.5
    x = hp(x, 2500) * env_exp(n, 0.32, 0.005) + hp(bell, 400) * 0.35 * np.exp(-t / 0.06)
    for b, v in C.ride_events():
        add(out, pan(x, 0.3), b, v)
    return out


# ====================================================================== CLAP
def clap_one():
    n = int(0.5 * SR)
    t = np.arange(n) / SR
    e = np.zeros(n)
    for k, o in enumerate((0.0, 0.009, 0.018, 0.029)):
        s = int(o * SR)
        e[s:] += np.exp(-(t[: n - s]) / 0.0035) * (0.8 if k < 3 else 1.0)
    s = int(0.029 * SR)
    e[s:] += 0.55 * np.exp(-t[: n - s] / 0.11)
    x = bp(noise(n), 1150, 0.4) * 1.6 + hp(noise(n), 3000) * 0.25
    return hp(x * e, 350)


def render_clap():
    dry = np.zeros(N)
    c = clap_one()
    for b, v in C.clap_events():
        add(dry, c, b, v)
    wet = reverb(dry, size=0.72, damp=0.5, predelay_ms=15)
    out = stereo(dry) + wet * 0.35
    return out


# ====================================================================== PERC
def tom(f, tau):
    n = int(0.5 * SR)
    t = np.arange(n) / SR
    fr = f * (1 + 0.7 * np.exp(-t / 0.018))
    x = np.sin(2 * np.pi * np.cumsum(fr) / SR) + 0.15 * bp(noise(n), f * 4, 0.3)
    return np.tanh(1.8 * x) * env_exp(n, tau)


def rim():
    n = int(0.08 * SR)
    t = np.arange(n) / SR
    x = np.sin(2 * np.pi * 1720 * t) * 0.6 + np.sin(2 * np.pi * 470 * t) * 0.6 + bp(noise(n), 2600, 0.5)
    return x * env_exp(n, 0.011)


def render_perc():
    kit = {"tl": (tom(130.8, 0.22), -0.35), "tm": (tom(174.6, 0.18), 0.25),
           "th": (tom(233.1, 0.15), 0.5), "rim": (rim(), 0.35)}
    dry = np.zeros((2, N))
    for b, kind, v in C.perc_events():
        s, p = kit[kind]
        add(dry, pan(s, p), b, v * (0.5 if kind == "rim" else 0.75))
    wet = reverb(dry[0] + dry[1], size=0.8, damp=0.45, predelay_ms=20)
    return dry + wet * 0.22


# ====================================================================== HOOK
def render_hook():
    dry = np.zeros((2, N))
    cut = C.hook_cutoff(BEAT_AT)
    for nt in C.hook_notes():
        dur = nt.dur * C.SPB
        n = int((dur + 0.09) * SR)
        t = np.arange(n) / SR
        f0 = mtof(nt.pitch)
        fc0 = cut[min(N - 1, smp(nt.start))]
        fc = fc0 * (1 + 2.8 * nt.vel * np.exp(-t / 0.055))
        amp = np.where(t < dur, 0.55 + 0.45 * np.exp(-t / 0.12), 0.0)
        rel = t >= dur
        amp[rel] = (0.55 + 0.45 * np.exp(-dur / 0.12)) * np.exp(-(t[rel] - dur) / 0.03)
        amp[:60] *= np.linspace(0, 1, 60)
        chans = []
        for det in ((-0.07, 0.03), (0.07, -0.03)):
            fa = np.full(n, f0 * 2 ** (det[0] / 12))
            fb = np.full(n, f0 * 2 ** (det[1] / 12))
            osc = saw(fa, RNG.uniform()) + saw(fb, RNG.uniform()) + 0.6 * pulse(np.full(n, f0 / 2), 0.42)
            y = svf(osc, fc, 0.62, 0)
            chans.append(sat(y * amp * 1.4, 2.2))
        add(dry, np.array(chans), nt.start, nt.vel)
    dry[0] = hp(dry[0], 90)
    dry[1] = hp(dry[1], 90)
    d = int(0.75 * C.SPB * SR)
    dl, dr = pingpong(dry[0], dry[1], d, 0.42, 0.45)
    dly = np.array([hp(dl, 250), hp(dr, 250)])
    rv = reverb(dry[0] + dry[1], size=0.88, damp=0.4, predelay_ms=25)
    bar = BEAT_AT / 4
    rv_amt = np.where((bar >= 80) & (bar < 96), 0.55, 0.16)
    out = dry + dly * 0.32 + rv * rv_amt
    return out * C.hook_gain(BEAT_AT)


# ====================================================================== ACID
def render_acid():
    notes = C.acid_notes()
    freq = np.full(N, mtof(41))
    amp = np.zeros(N)
    fenv = np.zeros(N)
    accent = np.zeros(N)
    prev = None
    for i, nt in enumerate(notes):
        s = smp(nt.start)
        nxt = smp(notes[i + 1].start) if i + 1 < len(notes) else s + int(0.3 * SR)
        e = min(N, nxt)
        L = e - s
        if L <= 0:
            continue
        t = np.arange(L) / SR
        f = mtof(nt.pitch)
        legato = prev is not None and prev.slide and abs(prev.start + 0.25 - nt.start) < 1e-6
        if legato:
            f_prev = mtof(prev.pitch)
            freq[s:e] = f + (f_prev - f) * np.exp(-t / 0.035)
            fenv[s:e] = fenv[s - 1] * np.exp(-t / 0.2)
            amp[s:e] = 1.0
        else:
            freq[s:e] = f
            dec = 0.09 if nt.accent else 0.2
            fenv[s:e] = np.exp(-t / dec)
            gate = nt.dur * C.SPB
            a = np.where(t < gate, 1.0, np.exp(-(t - gate) / 0.006))
            a[:30] *= np.linspace(0, 1, 30)
            amp[s:e] = a
        accent[s:e] = 1.0 if nt.accent else 0.0
        prev = nt
    act = amp > 1e-4
    idx = np.nonzero(act)[0]
    if len(idx) == 0:
        return np.zeros((2, N))
    a0, a1 = max(0, idx[0] - 100), min(N, idx[-1] + int(SR))
    sl = slice(a0, a1)
    osc = saw(freq[sl])
    base = C.acid_cutoff(BEAT_AT[sl])
    fc = base * (1 + (2.2 + 3.0 * accent[sl]) * fenv[sl])
    res = C.acid_res(BEAT_AT[sl]) + 0.05 * accent[sl]
    y = ladder(osc * 0.6, fc, res, 1.6)
    y = y * amp[sl] * (1 + 0.5 * accent[sl])
    y = sat(y * 2.2, 2.0)
    y = hp(y, 60)
    mono = np.zeros(N)
    mono[sl] = y
    d = int(0.75 * C.SPB * SR)
    dl, dr = pingpong(mono, mono, d, 0.35, 0.5)
    rv = reverb(mono, size=0.8, damp=0.5)
    return stereo(mono) + np.array([dl, dr]) * 0.25 + rv * 0.12


# ====================================================================== FM-STABS
def render_stabs():
    dry = np.zeros((2, N))
    for nt in C.stab_notes():
        long = nt.dur > 1.0
        dur = nt.dur * C.SPB
        n = int((dur + (0.9 if long else 0.25)) * SR)
        t = np.arange(n) / SR
        f = mtof(nt.pitch)
        chans = []
        for det in (-0.06, 0.06):
            fc = f * 2 ** (det / 12)
            idx = (3.2 if not long else 2.2) * np.exp(-t / (0.06 if not long else 0.35)) + 0.5
            mod = np.sin(2 * np.pi * fc * 2.0 * t) * idx
            mod2 = np.sin(2 * np.pi * fc * 3.51 * t) * 0.6 * np.exp(-t / 0.03)
            car = np.sin(2 * np.pi * fc * t + mod + mod2)
            env = np.exp(-t / (0.11 if not long else 0.7))
            env[:50] *= np.linspace(0, 1, 50)
            chans.append(car * env)
        add(dry, np.array(chans), nt.start, nt.vel * 0.5)
    dry = np.array([hp(dry[0], 160), hp(dry[1], 160)])
    d = int(0.75 * C.SPB * SR)
    dl, dr = pingpong(dry[0], dry[1], d, 0.45, 0.4)
    rv = reverb(dry[0] + dry[1], size=0.9, damp=0.35, predelay_ms=30)
    return dry + np.array([dl, dr]) * 0.3 + rv * 0.4


# ====================================================================== FX
def riser(b0, b1, f0=400, f1=9000):
    n = smp(b1) - smp(b0)
    t = np.linspace(0, 1, n)
    fc = f0 * (f1 / f0) ** (t ** 1.3)
    chans = [svf(noise(n), fc, 0.55, 1) for _ in range(2)]
    g = t ** 2.2
    return np.array(chans) * g * 0.8


def downlifter(b0, b1):
    n = smp(b1) - smp(b0)
    t = np.linspace(0, 1, n)
    fc = 8000 * (300 / 8000) ** (t ** 0.7)
    chans = [svf(noise(n), fc, 0.5, 1) for _ in range(2)]
    return np.array(chans) * (1 - t) ** 1.5 * 0.7


def impact():
    n = int(2.2 * SR)
    t = np.arange(n) / SR
    f = 34 + 60 * np.exp(-t / 0.08)
    boom = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.6)
    crash = hp(metal(n, 3.1) * 0.5 + noise(n), 4500) * np.exp(-t / 0.55) * 0.5
    return np.array([boom * 0.8 + crash * 0.9, boom * 0.8 + hp(noise(n), 4500) * np.exp(-t / 0.55) * 0.45])


def crash():
    n = int(2.0 * SR)
    t = np.arange(n) / SR
    c = [hp(metal(n, 2.9) * 0.6 + noise(n), 5000) * np.exp(-t / 0.5) for _ in range(2)]
    return np.array(c) * 0.5


def pitch_riser(b0, b1):
    n = smp(b1) - smp(b0)
    t = np.linspace(0, 1, n)
    out = []
    for det in (0.0, 0.1):
        f = mtof(53 + det) * 2 ** (2 * t ** 1.5)
        x = saw(f) + saw(f * 1.5)
        x = svf(x, 400 + 6000 * t ** 2, 0.4, 0)
        rate = 4 + 12 * t  # Tremolo wird schneller
        trem = 0.6 + 0.4 * np.sign(np.sin(2 * np.pi * np.cumsum(rate / C.SPB) / SR))
        out.append(x * trem * t ** 1.5 * 0.35)
    return np.array(out)


def snare_one():
    n = int(0.18 * SR)
    t = np.arange(n) / SR
    x = bp(noise(n), 2200, 0.25) * 0.9 + np.sin(2 * np.pi * 190 * t) * np.exp(-t / 0.02) * 0.5
    return x * env_exp(n, 0.05)


def render_fx():
    out = np.zeros((2, N))
    roll = np.zeros(N)
    sn = snare_one()
    for b, v in C.roll_events():
        add(roll, sn, b, v)
    roll_hp = np.full(N, 150.0)
    bar = BEAT_AT / 4
    roll_hp = np.where((bar >= 88) & (bar < 96), 150 * (12 ** np.clip((bar - 88) / 7.75, 0, 1)), roll_hp)
    roll = svf(roll, roll_hp, 0.3, 2)
    out += stereo(roll) * 0.6 + reverb(roll, 0.8, 0.4) * 0.35
    for a, b in ((40, 47.75), (88, 95.75), (130, 135.75), (12, 15.75), (28, 31.75)):
        g = 0.45 if a < 32 else 1.0
        add(out, riser(a * 4, b * 4), a * 4, g)
    add(out, pitch_riser(92 * 4, 95.75 * 4), 92 * 4, 1.0)
    add(out, downlifter(80 * 4, 84 * 4), 80 * 4, 1.0)
    add(out, downlifter(128 * 4, 131 * 4), 128 * 4, 0.8)
    imp = impact()
    for bb in (48, 96, 136):
        add(out, imp, bb * 4, 1.0)
    cr = crash()
    for bb in (16, 32, 64, 80, 112, 128, 160, 176):
        add(out, cr, bb * 4, 0.6)
    # harte Stille im letzten Beat vor dem Drop
    for bb in (47.75, 95.75, 135.75):
        s, e = smp(bb * 4), smp(bb * 4 + 1)
        fade = np.linspace(1, 0, 300)
        out[:, s:s + 300] *= fade
        out[:, s + 300:e] = 0
    return out


# ====================================================================== MIX
def rms_db(x, b0=96, b1=128):
    s, e = smp(b0 * 4), smp(b1 * 4)
    seg = x[..., s:e]
    return 20 * np.log10(np.sqrt(np.mean(seg ** 2)) + 1e-12)


TARGET = {  # RMS-Ziel im Peak-Teil (Takte 97-128), dBFS vor Master
    "01 KICK": -12.0, "02 RUMBLE": -18.0, "03 BASS": -18.5, "04 CLAP": -22.0,
    "05 HATS": -22.5, "06 RIDE": -27.0, "07 PERC": -23.5, "08 HOOK": -16.5,
    "09 ACID": -19.0, "10 FM STABS": -25.0,
}
SC_DEPTH = {"02 RUMBLE": 0.0, "03 BASS": 0.75, "08 HOOK": 0.45, "09 ACID": 0.35,
            "10 FM STABS": 0.4, "06 RIDE": 0.15, "05 HATS": 0.1}


def true_peak_safe(m, tp_db):
    """4x oversampled Soft-Clip + True-Peak-Normalisierung (dBTP)."""
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
    print("kick", time.time() - t0)
    stems["02 RUMBLE"] = render_rumble(ghost)
    print("rumble", time.time() - t0)
    stems["03 BASS"] = render_bass()
    stems["04 CLAP"] = render_clap()
    stems["05 HATS"] = render_hats()
    stems["06 RIDE"] = render_ride()
    stems["07 PERC"] = render_perc()
    print("drums", time.time() - t0)
    stems["08 HOOK"] = render_hook()
    print("hook", time.time() - t0)
    stems["09 ACID"] = render_acid()
    print("acid", time.time() - t0)
    stems["10 FM STABS"] = render_stabs()
    stems["11 FX"] = render_fx()
    print("fx", time.time() - t0)

    sc = {d: sidechain(d) for d in set(SC_DEPTH.values()) if d > 0}
    for name, d in SC_DEPTH.items():
        if d > 0:
            stems[name] = stems[name] * sc[d]
    for name, tgt in TARGET.items():
        stems[name] = stems[name] * db(tgt - rms_db(stems[name]))
    stems["11 FX"] = stems["11 FX"] * db(-6.0)

    mix = np.zeros((2, N))
    for name, s in stems.items():
        mix += s if s.ndim == 2 else stereo(s)
    # Headroom fuer die Stems: Summenpeak -1 dBFS
    head = db(-1.0) / np.max(np.abs(mix))
    for k in stems:
        stems[k] = stems[k] * head
    mix *= head

    # Master: HP, Glue, Limiter
    m = np.array([hp(mix[0], 22), hp(mix[1], 22)])
    # Tilt: Praesenz + Air (Shelf aus HP-Anteil, Mitten-Bell)
    m = np.array([c + (db(3.5) - 1) * hp(c, 2600, 0.1) + (db(1.5) - 1) * bp(c, 1400, 0.3) for c in m])
    m = compressor(m, 0.5 * (m[0] + m[1]), -16.0, 2.0, 15.0, 150.0, 2.0)
    pre = db(-6.0 - rms_db(m))  # Zielloudness ~ -9 dB RMS im Peak
    m = m * pre
    m = limiter(m, db(-0.8), int(0.004 * SR), 80.0)
    m = true_peak_safe(m, -1.0)
    print("master rms peak-part", rms_db(m), "time", time.time() - t0)

    os.makedirs(f"{ROOT}/Samples/Stems", exist_ok=True)
    os.makedirs(f"{ROOT}/bounce", exist_ok=True)
    end = smp(C.BEATS) + int(3.0 * SR)
    for name, s in stems.items():
        data = s[..., :end].T
        fn = f"{ROOT}/Samples/Stems/{name.replace(' ', '_')}.flac"
        sf.write(fn, data, SR, subtype="PCM_16")
    m = m[:, :end]
    fo = int(2.5 * SR)
    m[:, -fo:] *= np.linspace(1, 0, fo)
    sf.write(f"{ROOT}/bounce/NACHTSTROM_master.flac", m.T, SR, subtype="PCM_16")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i",
                    f"{ROOT}/bounce/NACHTSTROM_master.flac", "-b:a", "320k",
                    f"{ROOT}/bounce/NACHTSTROM_master.mp3"], check=True)
    print("fertig", time.time() - t0)


if __name__ == "__main__":
    main()
