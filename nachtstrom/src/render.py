"""NACHTSTROM v3 – Renderer nach Referenz-Bauplan.

Alle Sounds selbst synthetisiert. Der Mix wird per Match-EQ an die
gemessene Klangbalance der Referenz angeglichen (nur Spektrum, kein Audio
der Referenz landet im Track).

python3 render.py [pfad/zur/referenz.mp3]
"""
import os
import subprocess
import sys
import time

import numpy as np
import soundfile as sf
from scipy.signal import resample_poly, firwin2, oaconvolve

import compose as C
from dsp import (SR, saw, pulse, svf, lp, hp, bp, reverb, compressor, db,
                 tape_delay, phaser, smooth, limiter_fast)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RNG = np.random.default_rng(147)
TAIL = 4.0
N = int((C.BEATS * C.SPB + TAIL) * SR)
BEAT_AT = np.arange(N) / SR / C.SPB
BAR_AT = BEAT_AT / 4.0
REF_T0 = 0.0245  # erster Downbeat in der Referenz (gemessen)


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


def stereo(x):
    return np.array([x, x])


def env_exp(n, tau, hold=0.0):
    t = np.arange(n) / SR
    e = np.where(t < hold, 1.0, np.exp(-(t - hold) / tau))
    f = min(n, int(0.004 * SR))
    e[-f:] *= np.linspace(1, 0, f)
    return e


def noise(n):
    return RNG.standard_normal(n)


def tube(x, drive=2.0, bias=0.15):
    y = np.tanh(drive * (x + bias)) - np.tanh(drive * bias)
    return y / np.tanh(drive)


def tape(l, r, beats, wow_ms, rate, fb, damp=0.45, drive=1.5, cross=1.0):
    base = beats * C.SPB * SR
    depth = np.full(l.shape[0], wow_ms * SR / 1000.0)
    return tape_delay(l, r, base, depth, rate, fb, damp, drive, cross)


def gate_window(phase, a0, a1, r0, r1):
    """weiches Fenster innerhalb eines Beats: auf zwischen a0..a1, zu zwischen r0..r1."""
    up = np.clip((phase - a0) / (a1 - a0), 0, 1)
    down = 1 - np.clip((phase - r0) / (r1 - r0), 0, 1)
    return (up * up * (3 - 2 * up)) * down


# ====================================================================== KICK (Hard Techno)
def kick_one():
    n = int(0.40 * SR)
    t = np.arange(n) / SR
    f = C.KICK_HZ + 180 * np.exp(-t / 0.045) + 700 * np.exp(-t / 0.0025)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR)
    amp = np.where(t < 0.11, 1.0, np.exp(-(t - 0.11) / 0.07))
    amp[:20] *= np.linspace(0, 1, 20)
    amp[-600:] *= np.linspace(1, 0, 600)
    click = hp(noise(n), 3000) * np.exp(-t / 0.0022) * 0.45
    dry = body * amp
    k = tube(dry * 1.15 + click, 3.2, 0.1)
    k = np.tanh(1.6 * k)
    return k / np.max(np.abs(k)), dry


def render_kick():
    k, dry = kick_one()
    out = np.zeros(N)
    ghost = np.zeros(N)
    for b, v in C.kick_hits():
        add(out, k, b, v)
        add(ghost, dry, b, v)
    brk = ((BAR_AT >= 40.5) & (BAR_AT < 48)) | ((BAR_AT >= 78.5) & (BAR_AT < 80)) | ((BAR_AT >= 96) & (BAR_AT < 114))
    hpc = smooth(np.where(brk, 180.0, 15.0), SR // 8)
    out = svf(out, hpc, 0.1, 2)
    return out, ghost


# ====================================================================== RUMBLE + OFFBEAT-BASS
def offbeat_mask():
    """1 auf jedem Beat, auf dem eine Kick spielt (Bass/Rumble folgen der Kick)."""
    m = np.zeros(N)
    L = smp(1) - smp(0)
    for b, v in C.kick_hits():
        s = smp(b)
        m[s:s + L] = 1.0
    return m


def render_rumble(ghost):
    wet = reverb(ghost, size=0.93, damp=0.62, predelay_ms=5)
    r = 0.5 * (wet[0] + wet[1])
    r = svf(r, np.full(N, 140.0), 0.35, 0)
    r = tube(r * 9.0, 3.2, 0.2)
    r = svf(r, np.full(N, 190.0), 0.15, 0)
    r = hp(r, 45)
    ph = BEAT_AT % 1.0
    win = gate_window(ph, 0.42, 0.6, 0.93, 0.995) * (0.75 + 0.25 * ph)
    return r * win * offbeat_mask()


def render_bass():
    out = np.zeros(N)
    for nt in C.bass_notes():
        dur = nt.dur * C.SPB
        n = int((dur + 0.012) * SR)
        t = np.arange(n) / SR
        f0 = mtof(nt.pitch)
        f = np.full(n, f0)
        osc = (np.sin(2 * np.pi * f0 * t) + 0.45 * saw(f, 0.0)
               + 0.3 * np.sin(2 * np.pi * f0 * 4 / 3 * t))
        fc = 260 * (1 + 0.8 * np.exp(-t / 0.05))
        y = svf(osc, fc, 0.3, 0)
        amp = np.minimum(t / 0.035, 1) * np.where(t < dur, 1.0, np.exp(-(t - dur) / 0.004))
        add(out, y * amp, nt.start, nt.vel)
    out = tube(out * 2.2, 3.0, 0.25)       # dreckig, aber geschlossen
    out = svf(out, np.full(N, 700.0), 0.1, 0)
    return hp(out, 30)


# ====================================================================== HATS / CLAP / PERC
def metal(n, scale=1.0):
    t = np.arange(n) / SR
    fr = np.array([205.3, 304.4, 369.6, 522.7, 540.0, 800.0]) * 2.0 * scale
    s = np.zeros(n)
    for fq in fr:
        s += np.sign(np.sin(2 * np.pi * fq * t + RNG.uniform(0, 6.28)))
    return s / 6.0


def hat_one(kind):
    if kind == "o":
        n = int(0.22 * SR)
        x = noise(n) * 0.8 + metal(n) * 0.5
        x = tube(hp(bp(x, 9500, 0.25), 5000), 1.5, 0.0)
        return x * env_exp(n, 0.055, 0.004)
    if kind == "c":
        n = int(0.06 * SR)
        x = hp(noise(n) * 0.8 + metal(n, 1.05) * 0.3, 7500)
        return x * env_exp(n, 0.012)
    n = int(0.5 * SR)  # Top/Ride
    t = np.arange(n) / SR
    x = metal(n, 2.4) * 0.7 + hp(noise(n), 6000) * 0.5
    bell = np.sin(2 * np.pi * 3720 * t) * 0.15 * np.exp(-t / 0.04)
    return hp(x, 3500) * env_exp(n, 0.16, 0.004) + bell


def render_hats():
    out = np.zeros((2, N))
    bank = {k: [hat_one(k) for _ in range(4)] for k in "oct"}
    pans = {"o": 0.15, "c": -0.3, "t": 0.35}
    gains = {"o": 1.0, "c": 0.7, "t": 0.45}
    cnt = 0
    for b, kind, v in C.hat_events():
        cnt += 1
        s_ = bank[kind][cnt % 4]
        add(out, pan(s_, pans[kind]), b, v * gains[kind])
    h = C.hats_tone(BEAT_AT)
    return np.array([svf(out[0], h, 0.15, 2), svf(out[1], h, 0.15, 2)])


def clap_one():
    n = int(0.4 * SR)
    t = np.arange(n) / SR
    e = np.zeros(n)
    for k, o in enumerate((0.0, 0.010, 0.020, 0.031)):
        s = int(o * SR)
        e[s:] += np.exp(-(t[: n - s]) / 0.0035) * (0.8 if k < 3 else 1.0)
    s = int(0.031 * SR)
    e[s:] += 0.6 * np.exp(-t[: n - s] / 0.1)
    x = bp(noise(n), 1250, 0.3) * 1.5 + hp(noise(n), 3000) * 0.35
    body = np.sin(2 * np.pi * 210 * t) * np.exp(-t / 0.03) * 0.5
    return tube(hp(x * e, 280) + body, 2.0, 0.05)


def render_clap():
    dry = np.zeros(N)
    c = clap_one()
    for b, v in C.clap_events():
        add(dry, c, b, v)
    wet = reverb(dry, size=0.8, damp=0.5, predelay_ms=12)
    return stereo(dry) + wet * 0.35


def tom(f, tau, bend=0.5):
    n = int(0.4 * SR)
    t = np.arange(n) / SR
    fr = f * (1 + bend * np.exp(-t / 0.015))
    x = np.sin(2 * np.pi * np.cumsum(fr) / SR) + 0.15 * bp(noise(n), f * 3, 0.3)
    return tube(x, 2.2, 0.1) * env_exp(n, tau)


def rim():
    n = int(0.07 * SR)
    t = np.arange(n) / SR
    x = (np.sin(2 * np.pi * 1700 * t) * 0.6 + np.sin(2 * np.pi * 470 * t) * 0.6
         + bp(noise(n), 2700, 0.5))
    return tube(x, 1.6, 0.0) * env_exp(n, 0.011)


def render_perc():
    kit = {"rim": (rim(), 0.4), "tom": (tom(138.6, 0.16), -0.35), "cga": (tom(207.7, 0.08, 0.3), 0.55)}
    dry = np.zeros((2, N))
    for b, kind, v in C.perc_events():
        s_, p = kit[kind]
        add(dry, pan(s_, p), b, v * (0.6 if kind == "rim" else 0.75))
    wet = reverb(dry[0] + dry[1], size=0.75, damp=0.5, predelay_ms=15)
    return np.array([hp(dry[0], 90), hp(dry[1], 90)]) + wet * 0.2


# ====================================================================== HAUPT-STAB
def render_stab():
    dry = np.zeros((2, N))
    cut = C.stab_cutoff(BEAT_AT)
    for nt in C.stab_notes():
        long = nt.dur > 1.0
        dur = nt.dur * C.SPB
        n = int((dur + (0.6 if long else 0.08)) * SR)
        t = np.arange(n) / SR
        f0 = mtof(nt.pitch)
        i0 = min(N - 1, smp(nt.start))
        chans = []
        for det in (-0.08, 0.08):
            fa = np.full(n, f0 * 2 ** (det / 12))
            osc = saw(fa, 0.1) + 0.7 * pulse(np.full(n, f0 * 2 ** (-det / 12)), 0.35, 0.3) \
                + 0.5 * np.sin(2 * np.pi * f0 / 2 * t)
            fc = cut[i0] * (1 + (1.8 if nt.accent else 1.0) * np.exp(-t / (0.35 if long else 0.06)))
            y = svf(osc, fc, 0.5, 0)
            if long:
                amp = np.minimum(t / 0.08, 1) * np.where(t < dur, 1.0, np.exp(-(t - dur) / 0.25))
            else:
                tau = 0.14 if nt.accent else 0.07
                amp = np.where(t < dur, np.exp(-t / tau), np.exp(-dur / tau) * np.exp(-(t - dur) / 0.01))
                amp[:30] *= np.linspace(0, 1, 30)
            chans.append(tube(y * amp * 0.9, 2.6, 0.12))
        add(dry, np.array(chans), nt.start, nt.vel)
    dry = np.array([hp(dry[0], 120), hp(dry[1], 120)])
    haas = int(0.011 * SR)
    dry[1] = np.concatenate([np.zeros(haas), dry[1][:-haas]]) * 0.9 + dry[1] * 0.35
    dl, dr = tape(dry[0], dry[1], 0.75, 1.0, 0.4, 0.42, 0.5, 1.5, 1.0)
    rv = reverb(dry[0] + dry[1], size=0.88, damp=0.45, predelay_ms=20)
    big = ((BAR_AT >= 40) & (BAR_AT < 48)) | ((BAR_AT >= 96) & (BAR_AT < 114))
    rv_amt = smooth(np.where(big, 0.75, 0.22), SR // 2)
    return dry + np.array([hp(dl, 300), hp(dr, 300)]) * 0.3 + rv * rv_amt


# ====================================================================== ATMOSPHAERE (nur Breaks)
def render_atmos():
    g = np.zeros(N)
    for a, b, lvl in C.ATMOS_WINDOWS:
        g = np.where((BAR_AT >= a) & (BAR_AT < b), lvl, g)
    g = smooth(g, SR)
    act = np.nonzero(g > 1e-4)[0]
    out = np.zeros((2, N))
    if len(act) == 0:
        return out
    s0, s1 = act[0], act[-1] + 1
    n = s1 - s0
    t = np.arange(n) / SR
    chans = []
    for ch, det in enumerate((-0.07, 0.07)):
        x = np.zeros(n)
        for m, a in ((49, 1.0), (56, 0.7), (61, 0.5), (68, 0.25)):   # C#3 G#3 C#4 G#4
            f = np.full(n, mtof(m) * 2 ** (det / 12))
            x += a * saw(f, RNG.uniform())
        x += 0.25 * noise(n)
        fc = 600 * 2.0 ** (1.2 * np.sin(2 * np.pi * t / (16 * C.SPB) + ch))
        y = svf(x, fc, 0.6, 0)
        y = phaser(y, 0.06, 300, 4000, 0.5, 6, ch * 1.7)
        y = tube(y * 0.7, 1.8, 0.05)
        chans.append(y)
    seg = np.array(chans) * g[s0:s1]
    hz = int(0.013 * SR)
    seg[1] = np.concatenate([np.zeros(hz), seg[1][:-hz]])
    rv = reverb(seg[0] + seg[1], size=0.92, damp=0.4, predelay_ms=40)
    out[:, s0:s1] = seg + rv[:, :n] * 0.6
    return out


# ====================================================================== WIDE-Textur (Stereo-Feld)
def render_wide():
    """Dekorrelierter, gefilterter Rausch-/Metall-Layer im 16tel-Puls – nur Seitensignal-Breite."""
    g = np.zeros(N)
    for a, b, lvl in ((8, 16, 0.5), (16, 40, 0.8), (48, 78, 0.9), (80, 96, 1.0), (114, 162, 1.0), (162, 178, 0.6)):
        g = np.where((BAR_AT >= a) & (BAR_AT < b), lvl, g)
    g = smooth(g, SR // 4)
    ph = (BEAT_AT * 4) % 1.0
    puls = 0.55 + 0.45 * np.exp(-ph / 0.35)
    fc = 1800 * 2.0 ** (0.8 * np.sin(2 * np.pi * BEAT_AT / 32.0))
    chans = []
    for ch in range(2):
        x = svf(noise(N), fc * (1.0 + 0.15 * ch), 0.35, 1)
        x = phaser(x, 0.05, 400, 6000, 0.4, 4, 1.3 * ch)
        chans.append(hp(x, 350))
    return np.array(chans) * g * puls


# ====================================================================== FX-System
def sweep():
    n = smp(1)
    t = np.linspace(0, 1, n)
    fc = 9000 * (500 / 9000) ** t
    return np.array([svf(noise(n), fc, 0.55, 1), svf(noise(n), fc * 1.1, 0.55, 1)]) * (1 - t) * 0.5


def swell():
    n = smp(1)
    t = np.linspace(0, 1, n)
    x = np.array([hp(noise(n), 2500), hp(noise(n), 2500)]) * t ** 3 * 0.45
    return x


def wash():
    n = int(2.5 * SR)
    t = np.arange(n) / SR
    x = np.array([bp(noise(n), 1800, 0.3), bp(noise(n), 1600, 0.3)]) * np.exp(-t / 0.6)
    return x * 0.6


def render_fx(ghost):
    out = np.zeros((2, N))
    sw, se, wa = sweep(), swell(), wash()
    for kind, b in C.fx_events():
        add(out, {"sweep": sw, "swell": se, "wash": wa}[kind], b, 1.0)
    # Booms im Breakdown
    k, dry = kick_one()
    booms = np.zeros(N)
    for bar, beat in C.BOOMS:
        add(booms, dry, bar * 4 + beat, 1.0)
    bw = reverb(booms, size=0.95, damp=0.6)
    bm = lp(tube(booms + 0.5 * (bw[0] + bw[1]), 2.0, 0.1), 250)
    out += stereo(hp(bm, 70)) * 0.4
    rv = reverb(out[0] + out[1], size=0.85, damp=0.5)
    return out + rv * 0.25


# ====================================================================== Match-EQ zur Referenz
THIRD = np.array([25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800,
                  1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000])


def band_levels(x, sr=SR):
    nfft = 2 ** 15
    win = np.hanning(nfft)
    P = np.zeros(nfft // 2 + 1)
    hopn = nfft // 2
    cnt = 0
    for i in range(0, len(x) - nfft, hopn):
        P += np.abs(np.fft.rfft(x[i:i + nfft] * win)) ** 2
        cnt += 1
    P /= max(cnt, 1)
    fr = np.fft.rfftfreq(nfft, 1 / sr)
    out = []
    for fc in THIRD:
        k = (fr >= fc / 2 ** (1 / 6)) & (fr < fc * 2 ** (1 / 6))
        out.append(10 * np.log10(P[k].sum() + 1e-20))
    return np.array(out)


def ref_main_levels(ref_path):
    x, sr = sf.read(ref_path)
    m = x.mean(1) if x.ndim == 2 else x
    a = int((REF_T0 + 114 * 4 * C.SPB) * sr)
    b = int((REF_T0 + 162 * 4 * C.SPB) * sr)
    return band_levels(m[a:b], sr)


def match_eq_filter(ours, ref, max_db=8.0):
    d = ref - ours
    d -= np.median(d[8:22])              # Gesamtpegel egal – nur Balance zaehlt
    d = np.clip(d, -max_db, max_db)
    d = np.convolve(np.pad(d, 1, mode="edge"), np.ones(3) / 3, mode="valid")
    freqs = np.concatenate([[0], THIRD, [SR / 2]])
    gains = np.concatenate([[d[0]], d, [d[-1]]])
    taps = firwin2(8191, freqs, 10 ** (gains / 20), fs=SR)
    return taps, d


def apply_fir(x, taps):
    d = (len(taps) - 1) // 2
    if x.ndim == 1:
        y = oaconvolve(x, taps)[d:d + x.shape[0]]
    else:
        y = np.array([oaconvolve(c, taps)[d:d + x.shape[1]] for c in x])
    return y


# ====================================================================== MIX & MASTER
TARGET = {  # Start-Balance (RMS dB im PEAK-Teil), danach Match-EQ (geschlossener Regelkreis)
    "01 KICK": -11.0, "02 RUMBLE": -15.0, "03 BASS": -11.0, "04 HATS": -21.0,
    "05 CLAP": -21.5, "06 PERC": -23.0, "07 STAB": -19.0, "08 ATMOS": -27.0, "09 FX": -28.0,
    "10 WIDE": -24.0,
}
REGION = {"08 ATMOS": (96, 114), "09 FX": (0, 178)}
CREST = {"04 HATS": 12.0, "05 CLAP": 14.0, "06 PERC": 13.0, "07 STAB": 12.0, "09 FX": 14.0, "10 WIDE": 11.0}
SC = {"07 STAB": 0.45, "08 ATMOS": 0.5, "04 HATS": 0.1, "06 PERC": 0.15, "10 WIDE": 0.6}
BREAKS = [(40.6, 48.0), (78.6, 80.0), (96.6, 114.0)]  # Breaks ~4 dB leiser: Kontrast wie Referenz (LRA)


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


def sidechain(depth, tau=0.11):
    g = np.ones(N)
    L = int(0.4 * SR)
    t = np.arange(L) / SR
    curve = 1 - depth * np.exp(-t / tau)
    for b, v in C.kick_hits():
        s = smp(b)
        e = min(N, s + L)
        g[s:e] = np.minimum(g[s:e], 1 - (1 - curve[: e - s]) * v)
    return g


def lufs(x):
    import pyloudnorm as pyln
    return pyln.Meter(SR).integrated_loudness(x.T)


def master_chain(mix, gain_db):
    m = mix * db(gain_db)
    m = compressor(m, 0.5 * (m[0] + m[1]), -14.0, 2.0, 15.0, 120.0, 0.0)
    up = resample_poly(m, 4, 1, axis=1)
    up = soft_clip(up, db(-0.2))
    m = resample_poly(up, 1, 4, axis=1)
    m = limiter_fast(m, db(-0.3), int(0.003 * SR), 50.0)
    tp = np.max(np.abs(resample_poly(m, 4, 1, axis=1)))
    return m * min(1.0, db(-0.2) / tp)


def main(ref_path):
    t0 = time.time()
    stems = {}
    kick, ghost = render_kick()
    stems["01 KICK"] = kick
    stems["02 RUMBLE"] = render_rumble(ghost)
    stems["03 BASS"] = render_bass()
    stems["04 HATS"] = render_hats()
    stems["05 CLAP"] = render_clap()
    stems["06 PERC"] = render_perc()
    print("drums/low", round(time.time() - t0))
    stems["07 STAB"] = render_stab()
    stems["08 ATMOS"] = render_atmos()
    stems["09 FX"] = render_fx(ghost)
    stems["10 WIDE"] = render_wide()
    print("synths/fx", round(time.time() - t0))

    scs = {d: sidechain(d) for d in set(SC.values())}
    for k, d in SC.items():
        stems[k] = stems[k] * scs[d]
    for k, tgt in TARGET.items():
        a, b = REGION.get(k, (114, 146))
        stems[k] = stems[k] * db(tgt - rms_db(stems[k], a, b))
        if k in CREST:
            stems[k] = soft_clip(stems[k], db(tgt + CREST[k]))
    # Breaks leiser (Dynamik-Kontrast der Referenz: Breaks ~12 dB unter Main)
    bg = np.ones(N)
    for a, b in BREAKS:
        bg = np.where((BAR_AT >= a) & (BAR_AT < b), db(-4.5), bg)
    bg = smooth(bg, SR // 2)
    for k in stems:
        stems[k] = stems[k] * bg

    ref = ref_main_levels(ref_path)
    raw = dict(stems)

    def build(curve):
        freqs = np.concatenate([[0], THIRD, [SR / 2]])
        gains = np.concatenate([[curve[0]], curve, [curve[-1]]])
        taps = firwin2(8191, freqs, 10 ** (gains / 20), fs=SR)
        st = {}
        mx = np.zeros((2, N))
        for k, v in raw.items():
            v = apply_fir(v, taps)
            if v.ndim == 2:   # M/S pro Stem (linear -> Stem-Summe == Mix)
                mid, side = 0.5 * (v[0] + v[1]), 0.5 * (v[0] - v[1])
                side = hp(side, 150)
                side = side + (db(5.0) - 1) * hp(side, 400)   # Mitten/Hoehen breiter (Referenz: sehr weit)
                v = np.array([mid + side, mid - side])
            st[k] = v
            mx += v if v.ndim == 2 else stereo(v)
        return st, mx

    def master_to(mx, target=-7.5):
        g = 16.0
        m = None
        for _ in range(8):
            m = master_chain(mx, g)
            L = lufs(m)
            if abs(L - target) < 0.15:
                break
            g += (target - L) * 1.6
        return m, g, L

    curve = np.zeros(len(THIRD))
    for it in range(3):
        st, mx = build(curve)
        head = db(-1.0) / np.max(np.abs(mx))
        m, g, L = master_to(mx * head)
        meas = band_levels(0.5 * (m[0] + m[1])[smp(114 * 4):smp(162 * 4)])
        resid = ref - meas
        resid -= np.mean(resid[6:26])
        print(f"Iteration {it + 1}: {L:.2f} LUFS, max. Abweichung {np.max(np.abs(resid[2:27])):.1f} dB")
        if it < 2:
            curve = np.clip(curve + 0.75 * np.clip(resid, -6, 6), -10, 10)
            curve = np.convolve(np.pad(curve, 1, mode="edge"), np.ones(3) / 3, mode="valid")
    print("Match-EQ (dB):", " ".join(f"{int(f)}:{c:+.1f}" for f, c in zip(THIRD, curve)))
    stems = {k: v * head for k, v in st.items()}

    sd = f"{ROOT}/Samples/Stems"
    os.makedirs(sd, exist_ok=True)
    for f in os.listdir(sd):
        os.remove(os.path.join(sd, f))
    end = smp(C.BEATS) + int(2.5 * SR)
    for k, s_ in stems.items():
        sf.write(f"{sd}/{k.replace(' ', '_')}.flac", s_[..., :end].T, SR, subtype="PCM_16")
    m = m[:, :end]
    fo = int(1.5 * SR)
    m[:, -fo:] *= np.linspace(1, 0, fo)
    os.makedirs(f"{ROOT}/bounce", exist_ok=True)
    sf.write(f"{ROOT}/bounce/NACHTSTROM_master.flac", m.T, SR, subtype="PCM_16")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", f"{ROOT}/bounce/NACHTSTROM_master.flac",
                    "-b:a", "320k", f"{ROOT}/bounce/NACHTSTROM_master.mp3"], check=True)
    print("fertig", round(time.time() - t0))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else f"{ROOT}/Samples/Referenz/REFERENZ.mp3")
