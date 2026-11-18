"""NACHTSTROM v9 – Renderer: Sections mit eigener Identitaet + Highlights + Vocals.

Alle Sounds selbst synthetisiert. Klangbalance per Match-EQ (Regelkreis) an
die vermessene Referenz angeglichen – vom Referenz-Audio landet nichts im Track.

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
                 tape_delay, phaser, smooth, limiter_fast, onepole_lp)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RNG = np.random.default_rng(147)
TAIL = 4.0
N = int((C.BEATS * C.SPB + TAIL) * SR)
BEAT_AT = np.arange(N) / SR / C.SPB
BAR_AT = BEAT_AT / 4.0
REF_T0 = 0.0245


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


def tube_os(x, drive=2.0, bias=0.15):
    """Saettigung mit 2x-Oversampling -> kein Aliasing-Klirr."""
    up = resample_poly(x, 2, 1, axis=-1)
    return resample_poly(tube(up, drive, bias), 1, 2, axis=-1)[..., : x.shape[-1]]


def tape(l, r, beats, wow_ms, rate, fb, damp=0.45, drive=1.5, cross=1.0):
    base = beats * C.SPB * SR
    depth = np.full(l.shape[0], wow_ms * SR / 1000.0)
    return tape_delay(l, r, base, depth, rate, fb, damp, drive, cross)


def window(pairs, smooth_n=0):
    g = np.zeros(N)
    for a, b, lvl in pairs:
        g = np.where((BAR_AT >= a) & (BAR_AT < b), lvl, g)
    return smooth(g, smooth_n) if smooth_n else g


def gate_window(phase, a0, a1, r0, r1):
    up = np.clip((phase - a0) / (a1 - a0), 0, 1)
    down = 1 - np.clip((phase - r0) / (r1 - r0), 0, 1)
    return (up * up * (3 - 2 * up)) * down


# ====================================================================== KICK
def kick_one():
    """Wie Referenz: Sweep in ~70 ms auf den Grundton, dann lange Sub-Fahne bis ~½ Beat.
    Wenig Klick, milde Saettigung (2. Teilton ~ -20 dB)."""
    n = int(0.42 * SR)
    t = np.arange(n) / SR
    # Parameter per Fit an die Referenz-Huellkurven (Sub/Low/Low-Mid) bestimmt
    f = C.KICK_HZ + 200 * np.exp(-t / 0.030) + 150 * np.exp(-t / 0.012) - 9.0 * np.clip((t - 0.12) / 0.2, 0, 1)  # Tail sinkt Richtung 43 Hz (Referenz hat Energie um 40 Hz)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR)
    amp = np.where(t < 0.16, 1.0, np.exp(-(t - 0.16) / 0.05))
    amp[:12] *= np.linspace(0, 1, 12)
    amp[-600:] *= np.linspace(1, 0, 600)
    click = hp(noise(n), 5000) * np.exp(-t / 0.0010) * 0.06
    dry = body * amp
    k = tube_os(dry + click, 1.5, 0.04)
    return k / np.max(np.abs(k)), dry


def render_kick():
    k, dry = kick_one()
    main = np.zeros(N)
    ghost = np.zeros(N)
    for b, v in C.kick_hits():
        add(main, k, b, v)
        add(ghost, dry, b, v)
    brk = window([(40.5, 48, 1), (78.5, 80, 1), (96, 114, 1)])
    main = svf(main, smooth(np.where(brk > 0, 170.0, 15.0), SR // 10), 0.1, 2)
    # Kick-Rolls: werden lauter UND duenner (Hochpass steigt) -> Spannung
    roll = np.zeros(N)
    hpc = np.full(N, 15.0)
    for b, v, prog in C.roll_hits():
        add(roll, k, b, v)
        s = smp(b)
        hpc[s:s + smp(0.5)] = np.maximum(hpc[s:s + smp(0.5)], 70 * (5.0 ** prog))
    roll = svf(roll, smooth(hpc, 200), 0.3, 2)
    out = main + roll
    for b in C.PICKUPS:
        add(out, k, b, 1.0)
        add(ghost, dry, b, 1.0)
    return out, ghost


# ====================================================================== RUMBLE + BASS
def offbeat_mask():
    m = np.zeros(N)
    L = smp(1) - smp(0)
    for nt in C.bass_notes():
        s = smp(nt.start - 0.5)
        m[s:s + L] = 1.0
    return m


def render_rumble(ghost):
    wet = reverb(ghost, size=0.93, damp=0.62, predelay_ms=5)
    r = 0.5 * (wet[0] + wet[1])
    r = svf(r, np.full(N, 140.0), 0.35, 0)
    r = tube(r * 9.0, 3.2, 0.2)
    r = svf(r, np.full(N, 190.0), 0.15, 0)
    r = hp(r, 70)
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
        # wie Referenz: fast reiner Sinus (kaum Low-Mid-Obertoene)
        osc = np.sin(2 * np.pi * f0 * t) + 0.12 * np.sin(4 * np.pi * f0 * t)
        y = osc
        att = min(0.035, dur * 0.25)
        amp = np.minimum(t / att, 1) * np.where(t < dur, 1.0, np.exp(-(t - dur) / 0.004))
        add(out, y * amp, nt.start, nt.vel)
    out = tube_os(out * 1.1, 1.3, 0.1)
    out = svf(out, np.full(N, 400.0), 0.0, 0)
    return hp(out, 30)


# ====================================================================== DRUMS
def metal(n, scale=1.0):
    t = np.arange(n) / SR
    fr = np.array([205.3, 304.4, 369.6, 522.7, 540.0, 800.0]) * 2.0 * scale
    s = np.zeros(n)
    for fq in fr:
        s += np.sign(np.sin(2 * np.pi * fq * t + RNG.uniform(0, 6.28)))
    return s / 6.0


def hat_one(kind):
    if kind == "s":
        n = int(0.07 * SR)
        x = hp(bp(noise(n), 5500, 0.25), 3500)
        tt = np.arange(n) / SR
        return x * np.minimum(tt / 0.005, 1) * np.exp(-tt / 0.02)
    decay = {"o1": 0.028, "o2": 0.07, "o3": 0.16, "e": 0.012}
    if kind in decay:
        n = int((decay[kind] * 6 + 0.02) * SR)
        x = noise(n) * 0.85 + metal(n) * 0.35
        x = hp(bp(x, 9000, 0.2), 6000 if kind != "e" else 9000)
        return x * env_exp(n, decay[kind], 0.002)
    n = int(0.5 * SR)
    t = np.arange(n) / SR
    x = metal(n, 2.4) * 0.7 + hp(noise(n), 6000) * 0.5
    return hp(x, 3500) * env_exp(n, 0.16, 0.004) + np.sin(2 * np.pi * 3720 * t) * 0.12 * np.exp(-t / 0.04)


def render_hats():
    out = np.zeros((2, N))
    kinds = ("o1", "o2", "o3", "e", "t", "s")
    bank = {k: [hat_one(k) for _ in range(4)] for k in kinds}
    pans = {"o1": 0.1, "o2": 0.1, "o3": 0.1, "e": -0.3, "t": 0.35, "s": 0.45}
    gains = {"o1": 1.0, "o2": 1.0, "o3": 0.9, "e": 0.35, "t": 0.3, "s": 0.3}
    for i, (b, kind, v) in enumerate(C.hat_events()):
        p = pans[kind]
        if kind.startswith("o"):
            p = 0.28 if int(b) % 2 == 0 else -0.28      # Offbeat-Hat wandert dezent L/R
        add(out, pan(bank[kind][i % 4], p), b, v * gains[kind])
    h = C.hats_tone(BEAT_AT)
    out = np.array([svf(out[0], h, 0.1, 2), svf(out[1], h, 0.1, 2)])
    hz = int(0.006 * SR)                                  # Haas-Breite statt zusaetzlicher Elemente
    out[1] = 0.6 * out[1] + 0.4 * np.concatenate([np.zeros(hz), out[1][:-hz]])
    return out


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
    return tube_os(hp(x * e, 280) + body, 1.4, 0.03)


def render_clap():
    dry = np.zeros(N)
    c = clap_one()
    for b, v in C.clap_events():
        add(dry, c, b, v)
    wet = reverb(dry, size=0.8, damp=0.5, predelay_ms=12)
    return stereo(dry) + wet * 0.18


def tom(f, tau, bend=0.5):
    n = int(0.4 * SR)
    t = np.arange(n) / SR
    fr = f * (1 + bend * np.exp(-t / 0.015))
    x = np.sin(2 * np.pi * np.cumsum(fr) / SR) + 0.15 * bp(noise(n), f * 3, 0.3)
    return tube(x, 2.2, 0.1) * env_exp(n, tau)


def rim():
    n = int(0.07 * SR)
    t = np.arange(n) / SR
    x = np.sin(2 * np.pi * 1700 * t) * 0.6 + np.sin(2 * np.pi * 470 * t) * 0.6 + bp(noise(n), 2700, 0.5)
    return tube(x, 1.6, 0.0) * env_exp(n, 0.011)


def metal_hit(m):
    n = int(0.22 * SR)
    t = np.arange(n) / SR
    f0 = mtof(m)
    x = np.sin(2 * np.pi * f0 * t + 1.6 * np.sin(2 * np.pi * f0 * 2.76 * t) * np.exp(-t / 0.02))
    return x * np.exp(-t / 0.045) * np.minimum(t / 0.001, 1)


def render_perc():
    kit = {"rim": (rim(), 0.4), "tl": (tom(110.0, 0.2), -0.35), "tm": (tom(138.6, 0.16), 0.3),
           "cga": (tom(207.7, 0.08, 0.3), 0.55)}
    metals = {"mt1": metal_hit(73), "mt2": metal_hit(74), "mt3": metal_hit(71)}
    dry = np.zeros((2, N))
    met = np.zeros(N)
    for b, kind, v in C.perc_events():
        if kind in metals:
            add(met, metals[kind], b, v)
            continue
        s_, p = kit[kind]
        add(dry, pan(s_, p), b, v * (0.6 if kind == "rim" else 0.75))
    met = hp(met, 500)
    ph = 0.6 * np.sin(2 * np.pi * BEAT_AT / 5.0)          # Metall wandert durchs Stereobild
    a = (ph + 1) * np.pi / 4
    mst = np.array([met * np.cos(a), met * np.sin(a)]) * np.sqrt(2)
    ml, mr = tape(mst[0], mst[1], 0.5, 2.0, 0.4, 0.45, 0.5, 1.3, 1.0)
    wet = reverb(dry[0] + dry[1], size=0.8, damp=0.5, predelay_ms=15)
    rv_amt = window([(40, 48, 0.5)], SR // 2) + 0.1        # Break 1: Toms im grossen Raum
    return np.array([hp(dry[0], 70), hp(dry[1], 70)]) + wet * rv_amt + mst * 0.5 + np.array([ml, mr]) * 0.3


# ====================================================================== WALL (verzerrte chromatische Stereo-Wand)
def throw_send():
    g = np.zeros(N)
    for b in C.throw_beats():
        s, e = smp(b), smp(b + 0.5)
        g[s:e] = 1.0
    return smooth(g, 300)


def render_wall():
    notes = C.wall_notes()
    lf = np.zeros(N)
    gate = np.zeros(N)
    acc = np.zeros(N)
    for nt in notes:
        s, e = smp(nt.start), smp(nt.start + nt.dur)
        lf[s:e] = np.log2(mtof(nt.pitch))
        gate[s:e] = 1.0
        if nt.accent:
            acc[s:e] = 1.0
    act = np.nonzero(gate)[0]
    out = np.zeros((2, N))
    if len(act) == 0:
        return out
    # Portamento in log-Frequenz
    lf[: act[0]] = lf[act[0]]
    idx = np.where(lf != 0, np.arange(N), 0)
    lf = lf[np.maximum.accumulate(idx)]          # Ton halten bis zum naechsten
    lf = onepole_lp(lf, 12.0)
    freq = 2.0 ** lf
    ph = (BEAT_AT - 0.45) % 1.0          # Puls auf dem Offbeat (wie Referenz-Mitten), Platz nach der Kick
    pluck = 0.35 + 0.65 * np.exp(-ph / 0.25)
    pluck = np.where((BAR_AT >= 104) & (BAR_AT < 110), 0.8, pluck)     # lange Toene ohne Puls
    cut = C.wall_cutoff(BEAT_AT) * (1 + 0.9 * pluck + 0.4 * acc)
    g = smooth(gate, 400)
    # Dichte wie Referenz: Main 1 luftig, Peak dicht
    sect = window([(24, 40, 0.45), (48, 64, 0.5), (64, 80, 0.7), (80, 96, 0.8), (96, 104, 0.6),
                   (114, 146, 1.0), (146, 170, 0.6)], SR // 2)
    chans = []
    for ch, dets in enumerate(((-12, 0, 9), (-8, 0, 13))):
        x = np.zeros(N)
        for d in dets:
            x += saw(freq * 2 ** (d / 1200), RNG.uniform())
        x += 0.35 * pulse(freq / 2, 0.5, 0.25)
        y = svf(x * 0.5, cut, 0.35, 0)
        y = tube_os(y * 1.2, 1.8, 0.05)
        y = svf(y, np.full(N, 5500.0), 0.0, 0)
        chans.append(hp(y, 420) * g * pluck * sect)
    hz = int(0.008 * SR)
    chans[1] = np.concatenate([np.zeros(hz), chans[1][:-hz]])
    st = np.array(chans)
    snd = throw_send()
    dl, dr = tape(st[0] * snd, st[1] * snd, 0.75, 2.0, 0.5, 0.68, 0.45, 1.6, 1.0)
    rv = reverb(st[0] + st[1], size=0.8, damp=0.5, predelay_ms=15)
    rv_amt = window([(104, 110, 0.45)], SR // 2) + 0.06
    return st + np.array([dl, dr]) * 0.8 + rv * rv_amt


# ====================================================================== STAB
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
            osc = (saw(np.full(n, f0 * 2 ** (det / 12)), 0.1)
                   + 0.7 * pulse(np.full(n, f0 * 2 ** (-det / 12)), 0.35, 0.3)
                   + 0.5 * np.sin(2 * np.pi * f0 / 2 * t))
            fc = cut[i0] * (1 + (1.8 if nt.accent else 1.0) * np.exp(-t / (0.35 if long else 0.06)))
            y = svf(osc, fc, 0.5, 0)
            if long:
                amp = np.minimum(t / 0.08, 1) * np.where(t < dur, 1.0, np.exp(-(t - dur) / 0.25))
            else:
                tau = 0.14 if nt.accent else 0.07
                amp = np.where(t < dur, np.exp(-t / tau), np.exp(-dur / tau) * np.exp(-(t - dur) / 0.01))
                amp[:30] *= np.linspace(0, 1, 30)
            chans.append(tube_os(y * amp * 0.8, 1.8, 0.08))
        add(dry, np.array(chans), nt.start, nt.vel)
    dry = np.array([hp(dry[0], 120), hp(dry[1], 120)])
    hz = int(0.011 * SR)
    dry[1] = np.concatenate([np.zeros(hz), dry[1][:-hz]]) * 0.9 + dry[1] * 0.35
    snd = 0.25 + 0.75 * throw_send()
    dl, dr = tape(dry[0] * snd, dry[1] * snd, 0.75, 1.5, 0.4, 0.55, 0.5, 1.5, 1.0)
    rv = reverb(dry[0] + dry[1], size=0.88, damp=0.45, predelay_ms=20)
    big = window([(40, 48, 0.75), (96, 114, 0.75)], SR // 2) + 0.2
    return dry + np.array([hp(dl, 300), hp(dr, 300)]) * 0.35 + rv * big


# ====================================================================== DUB-STAB (Highlight)
def render_dub():
    dry = np.zeros((2, N))
    for nt in C.dub_notes():
        n = int(0.45 * SR)
        t = np.arange(n) / SR
        f0 = mtof(nt.pitch)
        chans = []
        for det in (-0.06, 0.06):
            x = saw(np.full(n, f0 * 2 ** (det / 12)), 0.2) + 0.6 * pulse(np.full(n, f0), 0.4, 0.1)
            y = svf(x, 1800 * (1 + 2.0 * np.exp(-t / 0.04)), 0.3, 0)
            chans.append(y * np.exp(-t / 0.09) * np.minimum(t / 0.003, 1))
        add(dry, np.array(chans), nt.start, nt.vel / 3)
    dry = np.array([hp(c, 200) for c in dry])
    dry = tube_os(dry * 1.2, 1.4, 0.05)
    dl, dr = tape(dry[0], dry[1], 0.75, 2.5, 0.35, 0.66, 0.55, 1.4, 1.0)   # langes Dub-Echo
    rv = reverb(dry[0] + dry[1], size=0.9, damp=0.45, predelay_ms=25)
    return dry + np.array([hp(dl, 300), hp(dr, 300)]) * 0.9 + rv * 0.3


# ====================================================================== VOCAL-SHOTS
def load_shot(name):
    path = f"{ROOT}/Samples/Vocals/{name}.flac"
    if not os.path.exists(path):
        return None
    x, sr_ = sf.read(path)
    return x if x.ndim == 1 else x.mean(1)


def pitch_down(x, semis):
    """Tonhoehe runter per Resampling (wird dabei etwas laenger – gewollt, dunkler)."""
    up, down = {2: (449, 400), 3: (238, 200)}[semis]
    return resample_poly(x, up, down)


def render_vocal():
    out = np.zeros((2, N))
    shots = {k: load_shot(k) for k in ("VOX_1_NACHTSTROM", "VOX_2_TIEFER", "VOX_3_LASS_DICH_FALLEN", "VOX_4_WEITER")}
    if shots["VOX_1_NACHTSTROM"] is None:
        return out
    dly = np.zeros((2, N))
    verb = np.zeros(N)
    for name, b, g, style in C.VOCAL_EVENTS:
        if style == "chop":
            x = shots["VOX_1_NACHTSTROM"][: int(0.30 * SR)].copy()
            x[-300:] *= np.linspace(1, 0, 300)
            x = hp(x, 250)
            send_d, send_r = 0.9, 0.25
        elif style == "deep":
            x = pitch_down(shots[name], 2)
            x = tube_os(hp(x, 90), 1.4, 0.05)
            send_d, send_r = 0.55, 0.35
        else:
            x = hp(shots[name], 180)
            send_d, send_r = 0.7, 0.6
        x = lp(x, 9000)
        x = x / (np.max(np.abs(x)) + 1e-9) * g
        dry = pan(x, 0.0)
        add(out, dry, b, 1.0)
        add(dly, dry * send_d, b, 1.0)
        tmp = np.zeros(N)
        add(tmp, x * send_r, b, 1.0)
        verb += tmp
    dl, dr = tape(dly[0], dly[1], 0.75, 2.0, 0.35, 0.5, 0.5, 1.3, 1.0)
    rv = reverb(verb, size=0.9, damp=0.45, predelay_ms=30)
    return out + np.array([hp(dl, 250), hp(dr, 250)]) * 0.7 + rv * 0.8


# ====================================================================== ATMOS (Drone mit Pitch-Riser)
def render_atmos():
    g = window(C.ATMOS_WINDOWS, SR)
    act = np.nonzero(g > 1e-4)[0]
    out = np.zeros((2, N))
    if len(act) == 0:
        return out
    s0, s1 = act[0], act[-1] + 1
    n = s1 - s0
    t = np.arange(n) / SR
    semi = C.atmos_semitones(BEAT_AT[s0:s1])
    bar = BAR_AT[s0:s1]
    openf = 1.0 + 3.0 * np.clip(semi / 12.0, 0, 1)
    chans = []
    for ch, det in enumerate((-0.07, 0.07)):
        x = np.zeros(n)
        for m, a in ((49, 1.0), (56, 0.7), (61, 0.5), (68, 0.25)):
            x += a * saw(mtof(m) * 2 ** ((det + semi) / 12) * np.ones(n), RNG.uniform())
        x += 0.25 * noise(n)
        fc = 600 * openf * 2.0 ** (1.2 * np.sin(2 * np.pi * t / (16 * C.SPB) + ch))
        y = svf(x, fc, 0.6, 0)
        y = phaser(y, 0.06, 300, 4000, 0.5, 6, ch * 1.7)
        trem = 1.0 - 0.35 * ((bar >= 44) & (bar < 48) | (bar >= 110) & (bar < 114)) * (0.5 + 0.5 * np.sign(np.sin(2 * np.pi * 4 * BEAT_AT[s0:s1])))
        chans.append(tube(y * 0.7, 1.8, 0.05) * trem)
    seg = np.array(chans) * g[s0:s1]
    hz = int(0.013 * SR)
    seg[1] = np.concatenate([np.zeros(hz), seg[1][:-hz]])
    rv = reverb(seg[0] + seg[1], size=0.92, damp=0.4, predelay_ms=40)
    out[:, s0:s1] = seg + rv[:, :n] * 0.6
    return out


# ====================================================================== FX
def fx_zap():
    n = int(0.35 * SR)
    t = np.arange(n) / SR
    f = 70 + 3500 * np.exp(-t / 0.03)
    ph = 2 * np.pi * np.cumsum(f) / SR
    x = np.sin(ph + 2.5 * np.sin(1.5 * ph) * np.exp(-t / 0.05))
    return lp(tube_os(x * env_exp(n, 0.1), 1.6, 0.05), 4000)


def fx_crash(dur=2.0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    return np.array([hp(metal(n, 3.0) * 0.6 + noise(n), 4500) * np.exp(-t / 0.55) for _ in range(2)]) * 0.5


def fx_revcrash(beats):
    n = smp(beats)
    c = fx_crash(max(1.0, beats * C.SPB + 0.2))[:, :n][:, ::-1]
    t = np.linspace(0, 1, n)
    return c[:, :n] * t ** 1.5


def fx_impact():
    n = int(2.0 * SR)
    t = np.arange(n) / SR
    f = 33 + 75 * np.exp(-t / 0.09)
    boom = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.55)
    burst = lp(noise(n), 2500) * np.exp(-t / 0.12) * 0.6
    x = tube(boom + burst, 2.0, 0.05)
    return stereo(x) + fx_crash(2.0) * 0.8


def fx_riser(b0, b1):
    """Industrial-Riser: verzerrtes Rauschen durch resonanten Sweep, Gate beschleunigt 16tel -> 32tel,
    dazu ein steigender Saw-Stack (2 Oktaven)."""
    n = smp(b1) - smp(b0)
    t = np.linspace(0, 1, n)
    beats = np.linspace(0, b1 - b0, n)
    fc = 250 * (9000 / 250) ** (t ** 1.4)
    rate = np.where(t < 0.6, 4.0, np.where(t < 0.85, 8.0, 16.0))
    gate = 0.35 + 0.65 * (np.sin(2 * np.pi * np.cumsum(rate) / n * (b1 - b0)) > -0.2)
    gate = smooth(gate.astype(float), 60)
    chans = []
    for ch in range(2):
        x = svf(noise(n), fc * (1 + 0.05 * ch), 0.75, 1)
        x = tube_os(x * 1.5, 1.6, 0.0)
        f = mtof(49) * 2 ** (2 * t ** 1.6) * (1 + 0.004 * ch)
        y = svf(saw(f) + saw(f * 1.5), 300 + 7000 * t ** 2, 0.4, 0)
        chans.append(svf((0.45 * x + 0.4 * y) * (0.6 + 0.4 * gate) * t ** 2.2, np.full(n, 6000.0), 0.0, 0))
    return np.array(chans)


def fx_down(beats=2.0):
    n = smp(beats)
    t = np.linspace(0, 1, n)
    fc = 8000 * (200 / 8000) ** t
    return np.array([svf(noise(n), fc, 0.55, 1), svf(noise(n), fc * 1.1, 0.55, 1)]) * (1 - t) ** 1.3 * 0.7


def fx_wash():
    n = int(2.5 * SR)
    t = np.arange(n) / SR
    return np.array([bp(noise(n), 1800, 0.3), bp(noise(n), 1600, 0.3)]) * np.exp(-t / 0.6) * 0.6


def fx_whoosh():
    n = smp(1.0)
    t = np.linspace(0, 1, n)
    fc = 600 * (9000 / 600) ** (np.sin(np.pi * t))
    return np.array([svf(noise(n), fc, 0.5, 1), svf(noise(n), fc * 0.9, 0.5, 1)]) * np.sin(np.pi * t) * 0.6


def render_fx(kick, wall):
    out = np.zeros((2, N))
    zaps = np.zeros((2, N))
    risers = np.zeros((2, N))
    k, dry = kick_one()
    booms = np.zeros(N)
    for e in C.fx_events():
        kind, b = e[0], e[1]
        if kind == "zap":
            add(zaps, pan(fx_zap(), 0.3 if int(b) % 8 else -0.3), b, 1.0)
        elif kind == "revcrash":
            beats = (np.floor(b / 4) + 1) * 4 - b
            add(out, fx_revcrash(beats), b, 0.9)
        elif kind == "crash":
            add(out, fx_crash(), b, 0.7)
        elif kind == "impact":
            add(out, fx_impact(), b, 1.0)
        elif kind == "riser":
            add(risers, fx_riser(b, e[2]), b, 1.0)
        elif kind == "down":
            add(out, fx_down(), b, 1.0)
        elif kind == "wash":
            add(out, fx_wash(), b, 1.0)
        elif kind == "whoosh":
            add(out, fx_whoosh(), b, 0.8)
        elif kind == "boom":
            add(booms, dry, b, 1.0)
        elif kind == "subdrop":
            n = int(1.6 * SR)
            t = np.arange(n) / SR
            f = 32 + 60 * np.exp(-t / 0.12)
            sd_ = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.5) * np.minimum(t / 0.004, 1)
            add(out, stereo(sd_), b, 0.9)
        elif kind == "ping":
            n = int(0.8 * SR)
            t = np.arange(n) / SR
            fp = mtof(85)
            x = np.sin(2 * np.pi * fp * t + 1.8 * np.sin(2 * np.pi * fp * 2.76 * t) * np.exp(-t / 0.15))
            pg = x * np.exp(-t / 0.35) * np.minimum(t / 0.002, 1)
            pl, pr = tape(pg, pg * 0.8, 0.75, 1.5, 0.3, 0.55, 0.5, 1.2, 1.0)
            add(out, np.array([pg + 0.7 * pl, pg + 0.7 * pr]) * 0.6, b, 1.0)
    bw = reverb(booms, size=0.95, damp=0.6)
    bm = lp(tube(booms + 0.5 * (bw[0] + bw[1]), 2.0, 0.1), 250)
    out += stereo(hp(bm, 70)) * 0.5
    zl, zr = tape(zaps[0], zaps[1], 0.75, 3.0, 0.5, 0.55, 0.4, 1.5, 1.0)
    out += (zaps + np.array([zl, zr]) * 0.6) * 0.5
    # Wand-Solo mit Resonanz-Sweep in den Stopps
    for b0, b1 in C.WALL_SWEEPS:
        s0, s1 = smp(b0), smp(b1)
        u = np.linspace(0, 1, s1 - s0)
        fc = 300 * (6000 / 300) ** u
        seg = np.array([svf(wall[c, s0:s1], fc, 0.85, 1) for c in range(2)]) * (0.4 + 0.6 * u)
        out[:, s0:s1] += seg * 1.5
    rv = reverb(out[0] + out[1], size=0.85, damp=0.5)
    return out + rv * 0.15, risers


# ====================================================================== WIDE
def render_wide():
    g = window([(80, 96, 0.7), (114, 146, 0.8)], SR // 4)   # nur in den dichten Teilen (wie Referenz)
    ph = (BEAT_AT * 4) % 1.0
    puls = 0.55 + 0.45 * np.exp(-ph / 0.35)
    fc = 1800 * 2.0 ** (0.8 * np.sin(2 * np.pi * BEAT_AT / 32.0))
    chans = []
    for ch in range(2):
        x = svf(noise(N), fc * (1.0 + 0.15 * ch), 0.35, 1)
        x = phaser(x, 0.05, 400, 6000, 0.4, 4, 1.3 * ch)
        chans.append(hp(x, 350))
    return np.array(chans) * g * puls


# ====================================================================== EDITS (Tape-Stop, Stutter, Filter-Fahrten)
def apply_edits(x):
    y = x.copy()
    hpc = np.full(N, 10.0)
    lpc = np.full(N, 20000.0)
    for e in C.EDITS:
        kind = e[0]
        if kind == "tapestop":
            b0, dur = e[1], e[2]
            s0, L = smp(b0), smp(b0 + dur) - smp(b0)
            u = np.arange(L) / L
            speed = (1 - u) ** 1.4
            r = s0 + np.cumsum(speed)
            mute_end = smp((np.floor((b0 + dur) / 4 + 1e-9) + 1) * 4)
            fade = np.ones(L)
            fade[-200:] = np.linspace(1, 0, 200)
            fin = np.linspace(0, 1, 260)          # sanfter Wiedereinstieg nach dem Stopp (kein Klick)
            if y.ndim == 1:
                y[s0:s0 + L] = np.interp(r, np.arange(N), x) * fade
                y[s0 + L:mute_end] = 0
                y[mute_end:mute_end + 260] *= fin
            else:
                for c in range(2):
                    y[c, s0:s0 + L] = np.interp(r, np.arange(N), x[c]) * fade
                y[:, s0 + L:mute_end] = 0
                y[:, mute_end:mute_end + 260] *= fin
        elif kind == "stutter":
            b0, dur, sl = e[1], e[2], e[3]
            s0, Ls = smp(b0), smp(b0 + sl) - smp(b0)
            reps = int(round(dur / sl))
            src = x[..., s0:s0 + Ls].copy()
            f = min(60, Ls // 4)
            env = np.ones(Ls)
            env[:f] = np.linspace(0, 1, f)
            env[-f:] = np.linspace(1, 0, f)
            for k in range(reps):
                a = s0 + k * Ls
                y[..., a:a + Ls] = src * env
        elif kind == "hpsweep":
            b0, b1, f0, f1 = e[1:]
            s0, s1 = smp(b0), smp(b1)
            u = np.linspace(0, 1, s1 - s0)
            hpc[s0:s1] = f0 * (f1 / f0) ** (u ** 2)
        elif kind == "lpcut":
            b0, b1, f = e[1:]
            lpc[smp(b0):smp(b1)] = f
        elif kind == "lpdive":
            b0, b1, f0, f1 = e[1:]
            s0, s1 = smp(b0), smp(b1)
            u = np.linspace(0, 1, s1 - s0)
            lpc[s0:s1] = f0 * (f1 / f0) ** (u ** 0.7)
        elif kind == "cut":
            b0, b1 = e[1:]
            s0, s1 = smp(b0), smp(b1)
            f = min(150, (s1 - s0) // 4)
            y[..., s0:s1] = 0.0
            if y.ndim == 1:
                y[s0 - f:s0] *= np.linspace(1, 0, f)
            else:
                y[:, s0 - f:s0] *= np.linspace(1, 0, f)
    hpc = smooth(hpc, 300)
    lpc = smooth(lpc, 600)
    if y.ndim == 1:
        return svf(svf(y, hpc, 0.2, 2), lpc, 0.2, 0)
    return np.array([svf(svf(c, hpc, 0.2, 2), lpc, 0.2, 0) for c in y])


# ====================================================================== Match-EQ zur Referenz
THIRD = np.array([25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800,
                  1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000])


def band_levels(x, sr=SR):
    nfft = 2 ** 15
    win = np.hanning(nfft)
    P = np.zeros(nfft // 2 + 1)
    cnt = 0
    for i in range(0, len(x) - nfft, nfft // 2):
        P += np.abs(np.fft.rfft(x[i:i + nfft] * win)) ** 2
        cnt += 1
    P /= max(cnt, 1)
    fr = np.fft.rfftfreq(nfft, 1 / sr)
    return np.array([10 * np.log10(P[(fr >= fc / 2 ** (1 / 6)) & (fr < fc * 2 ** (1 / 6))].sum() + 1e-20) for fc in THIRD])


def ref_main_levels(ref_path):
    x, sr = sf.read(ref_path)
    m = x.mean(1) if x.ndim == 2 else x
    a = int((REF_T0 + 114 * 4 * C.SPB) * sr)
    b = int((REF_T0 + 162 * 4 * C.SPB) * sr)
    return band_levels(m[a:b], sr)


def apply_fir(x, taps):
    d = (len(taps) - 1) // 2
    if x.ndim == 1:
        return oaconvolve(x, taps)[d:d + x.shape[0]]
    return np.array([oaconvolve(c, taps)[d:d + x.shape[1]] for c in x])


# ====================================================================== MIX & MASTER
TARGET = {
    "01 KICK": -9.0, "02 RUMBLE": -23.0, "03 BASS": -12.0, "04 HATS": -21.0,
    "05 CLAP": -21.0, "06 PERC": -25.0, "07 WALL": -21.5, "08 DUB STAB": -24.0,
    "09 ATMOS": -27.0, "10 FX": -31.0, "11 RISER": -24.0, "13 STAB": -22.5,
}
REGION = {"08 DUB STAB": (130, 146), "09 ATMOS": (96, 114), "10 FX": (0, 178), "11 RISER": (112, 114), "13 STAB": (114, 130)}
CREST = {"04 HATS": 12.0, "05 CLAP": 14.0, "06 PERC": 13.0, "07 WALL": 11.0, "08 DUB STAB": 14.0,
         "10 FX": 16.0, "11 RISER": 10.0, "13 STAB": 12.0}
SC = {"07 WALL": 0.6, "08 DUB STAB": 0.4, "09 ATMOS": 0.5, "04 HATS": 0.1, "06 PERC": 0.15, "13 STAB": 0.45}
EDITED = ["01 KICK", "02 RUMBLE", "03 BASS", "04 HATS", "05 CLAP", "06 PERC", "07 WALL", "08 DUB STAB", "13 STAB"]


def rms_db(x, b0, b1):
    s, e = smp(b0 * 4), smp(b1 * 4)
    return 20 * np.log10(np.sqrt(np.mean(x[..., s:e] ** 2)) + 1e-12)


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
    print("drums/low", round(time.time() - t0), flush=True)
    stems["07 WALL"] = render_wall()
    stems["08 DUB STAB"] = render_dub()
    stems["09 ATMOS"] = render_atmos()
    fx, ris = render_fx(kick, stems["07 WALL"])
    stems["10 FX"] = fx
    stems["11 RISER"] = ris
    stems["12 VOCAL"] = render_vocal()
    stems["13 STAB"] = render_stab()
    print("synths/fx/vocal", round(time.time() - t0), flush=True)

    scs = {d: sidechain(d) for d in set(SC.values())}
    for k, d in SC.items():
        stems[k] = stems[k] * scs[d]
    for k, tgt in TARGET.items():
        a, b = REGION.get(k, (114, 146))
        stems[k] = stems[k] * db(tgt - rms_db(stems[k], a, b))
        if k in CREST:
            stems[k] = soft_clip(stems[k], db(tgt + CREST[k]))
    vp = np.max(np.abs(stems["12 VOCAL"]))
    if vp > 0:
        stems["12 VOCAL"] = stems["12 VOCAL"] * (np.max(np.abs(stems["01 KICK"])) * db(-5.0) / vp)
    for k in EDITED:
        stems[k] = apply_edits(stems[k])
    # Spannungsbogen: Break leise & dunkel -> Crescendo im Aufbau -> Drop
    bgdb = np.zeros(N)
    for a, b in ((40.6, 44.0), (78.6, 80.0), (96.6, 110.0)):
        bgdb = np.where((BAR_AT >= a) & (BAR_AT < b), -6.5, bgdb)
    for a, b in ((44.0, 48.0), (110.0, 114.0)):
        u = np.clip((BAR_AT - a) / (b - a), 0, 1)
        bgdb = np.where((BAR_AT >= a) & (BAR_AT < b), -6.5 + 5.5 * u ** 1.5, bgdb)
    bg = smooth(10 ** (bgdb / 20), SR // 4)
    for k in stems:
        if k not in ("11 RISER", "10 FX", "12 VOCAL"):
            stems[k] = stems[k] * bg
    print("edits", round(time.time() - t0), flush=True)

    ref = ref_main_levels(ref_path)
    raw = dict(stems)

    def build(curve):
        freqs = np.concatenate([[0], THIRD, [SR / 2]])
        gains = np.concatenate([[curve[0]], curve, [curve[-1]]])
        taps = firwin2(8191, freqs, 10 ** (gains / 20), fs=SR)
        st, mx = {}, np.zeros((2, N))
        for k, v in raw.items():
            v = apply_fir(v, taps)
            if v.ndim == 2:
                mid, side = 0.5 * (v[0] + v[1]), 0.5 * (v[0] - v[1])
                side = hp(side, 150)
                side = side + (db(5.0) - 1) * hp(side, 400)
                v = np.array([mid + side, mid - side])
            st[k] = v
            mx += v if v.ndim == 2 else stereo(v)
        return st, mx

    def master_to(mx, target=-7.4):
        g, m, L = 17.0, None, 0
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
        print(f"Iteration {it + 1}: {L:.2f} LUFS, max. Abweichung {np.max(np.abs(resid[2:27])):.1f} dB", flush=True)
        if it < 2:
            curve = np.clip(curve + 0.75 * np.clip(resid, -6, 6), -10, 10)
            curve = np.convolve(np.pad(curve, 1, mode="edge"), np.ones(3) / 3, mode="valid")
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
    print("fertig", round(time.time() - t0), flush=True)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else f"{ROOT}/Samples/Referenz/REFERENZ.mp3")
