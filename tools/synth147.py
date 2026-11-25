#!/usr/bin/env python3
"""
synth147 - generiert 10 Synthesizer-Samples a 15 Sekunden bei 147 BPM.

Alles wird von Grund auf synthetisiert (keine fremden Samples):
PolyBLEP-Oszillatoren, Supersaw-Unison, zeitvariable Resonanzfilter,
FM-Glocken, Formant-"Vocal Chops", synthetische Drums, Sidechain,
Ping-Pong-Delay, Faltungshall und ein Soft-Clip-Master.

Aufbau jedes Samples (147 BPM, 1 Beat = 0,408 s):
  Takt 1      (0,0 - 1,6 s)   Build: Hook-Teaser, Riser, Snare-Roll
  Takt 2-9    (1,6 - 14,7 s)  Drop: Hook 2x (Frage/Antwort-Phrase)
  Ende        (14,7 - 15,0 s) Final Hit + Hallfahne

Aufruf:  python3 tools/synth147.py [ausgabe_ordner]
"""
import os
import sys

import numpy as np
from scipy import signal
from scipy.io import wavfile

SR = 44100
BPM = 147
BEAT = 60.0 / BPM
DUR = 15.0
N = int(SR * DUR)
DROP = 4          # Drop beginnt bei Beat 4
END = 36          # Final Hit bei Beat 36 (14,69 s)

rng = np.random.default_rng(147)

NOTE = {'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3, 'E': 4, 'F': 5,
        'F#': 6, 'Gb': 6, 'G': 7, 'G#': 8, 'Ab': 8, 'A': 9, 'A#': 10, 'Bb': 10, 'B': 11}


# ----------------------------------------------------------------- Helfer
def b2s(b):
    return int(round(b * BEAT * SR))


def mtof(m):
    return 440.0 * 2 ** ((np.asarray(m, dtype=float) - 69) / 12)


def nm(s):
    return 12 * (int(s[-1]) + 1) + NOTE[s[:-1]]


def H(lst, offset=0.0, vel=1.0, transpose=0):
    """[(beat, dauer, 'C5'), ...] -> [(beat, dauer, midi, vel)]"""
    out = []
    for it in lst:
        st, du, n = it[:3]
        v = it[3] if len(it) > 3 else vel
        out.append((st + offset, du, nm(n) + transpose, v))
    return out


def peak(x):
    return np.max(np.abs(x)) + 1e-12


def rms(x):
    return np.sqrt(np.mean(x ** 2)) + 1e-12


def norm(x, p=1.0):
    return x / peak(x) * p


def sat(x, drive=2.0):
    x = x / peak(x)
    return np.tanh(drive * x) / np.tanh(drive)


def stereo(x, pan=0.0):
    x = np.asarray(x)
    if x.ndim == 2:
        return x
    return np.vstack([x * min(1.0, 1.0 - pan), x * min(1.0, 1.0 + pan)])


def place(buf, x, beat, gain=1.0, pan=0.0):
    s0 = b2s(beat)
    if s0 >= N or s0 < 0:
        return
    x = stereo(x, pan)
    L = min(x.shape[-1], N - s0)
    buf[:, s0:s0 + L] += x[:, :L] * gain


def sos(kind, fc, order=2):
    return signal.butter(order, fc, kind, fs=SR, output='sos')


def filt(x, kind, fc, order=2):
    return signal.sosfilt(sos(kind, fc, order), x, axis=-1)


# ------------------------------------------------------------ Oszillatoren
def polyblep(t, dt):
    out = np.zeros_like(t)
    m = t < dt
    x = t[m] / dt[m]
    out[m] = x + x - x * x - 1.0
    m = t > 1.0 - dt
    x = (t[m] - 1.0) / dt[m]
    out[m] = x * x + x + x + 1.0
    return out


def osc(freq, wave='saw', phase0=0.0, pw=0.5):
    freq = np.asarray(freq, dtype=float)
    dt = np.clip(freq / SR, 1e-9, 0.49)
    ph = (phase0 + np.cumsum(dt)) % 1.0
    if wave == 'sine':
        return np.sin(2 * np.pi * ph)
    if wave == 'saw':
        return 2.0 * ph - 1.0 - polyblep(ph, dt)
    if wave == 'square':
        s = np.where(ph < pw, 1.0, -1.0)
        s = s + polyblep(ph, dt) - polyblep((ph + 1.0 - pw) % 1.0, dt)
        return s
    if wave == 'tri':
        return 2.0 * np.abs(2.0 * ph - 1.0) - 1.0
    if wave == 'sawsq':
        return 0.65 * osc(freq, 'saw', phase0) + 0.45 * osc(freq, 'square', phase0, pw)
    raise ValueError(wave)


def adsr(n_on, a, d, s, r):
    A = max(1, int(a * SR))
    R = max(1, int(r * SR))
    t = np.arange(max(n_on, 1), dtype=float)
    e = np.where(t < A, t / A, s + (1 - s) * np.exp(-(t - A) / max(1.0, d * SR)))
    last = e[-1]
    tr = np.arange(R, dtype=float)
    rel = last * np.exp(-tr / (R / 4.0)) * (1 - tr / R)
    return np.concatenate([e, rel])


# ---------------------------------------------------------------- Filter
def biquad(fc, Q, mode):
    fc = float(np.clip(fc, 20.0, SR * 0.45))
    w = 2 * np.pi * fc / SR
    cw, sw = np.cos(w), np.sin(w)
    al = sw / (2 * Q)
    if mode == 'lp':
        b = [(1 - cw) / 2, 1 - cw, (1 - cw) / 2]
    elif mode == 'hp':
        b = [(1 + cw) / 2, -(1 + cw), (1 + cw) / 2]
    else:  # bp, 0 dB Spitze
        b = [al, 0.0, -al]
    a = [1 + al, -2 * cw, 1 - al]
    return np.array(b) / a[0], np.array(a) / a[0]


def tvf(x, fc, Q=0.707, mode='lp', block=32):
    """Zeitvariables Resonanzfilter (Blockweise Koeffizienten)."""
    one = np.asarray(x).ndim == 1
    x = np.atleast_2d(x)
    if np.isscalar(fc):
        b, a = biquad(fc, Q, mode)
        y = signal.lfilter(b, a, x, axis=-1)
        return y[0] if one else y
    fc = np.asarray(fc)
    y = np.empty_like(x)
    zi = np.zeros((x.shape[0], 2))
    n = x.shape[-1]
    for i in range(0, n, block):
        b, a = biquad(fc[i], Q, mode)
        y[:, i:i + block], zi = signal.lfilter(b, a, x[:, i:i + block], axis=-1, zi=zi)
    return y[0] if one else y


# ------------------------------------------------------------- Synths
def poly(notes, wave='saw', unison=1, detune=0.15, spread=0.8, a=0.004, d=0.25, s=0.7, r=0.15,
         fc=6000.0, fenv=0.0, fdecay=0.15, Q=0.8, mode='lp', pitch_env=0.0, pitch_decay=0.02,
         vib=0.0, sub=0.0, pw=0.5, octave_layer=0.0):
    out = np.zeros((2, N))
    for st, du, m, v in notes:
        s0 = b2s(st)
        if s0 >= N:
            continue
        non = max(1, b2s(st + du) - s0)
        env = adsr(non, a, d, s, r)
        L = min(len(env), N - s0)
        env = env[:L]
        t = np.arange(L) / SR
        f = mtof(m) * np.ones(L)
        if pitch_env:
            f = f * 2 ** (pitch_env * np.exp(-t / pitch_decay) / 12)
        if vib:
            f = f * 2 ** (vib * np.sin(2 * np.pi * 5.6 * t) * np.clip((t - 0.12) / 0.2, 0, 1) / 12)
        sl = np.zeros(L)
        sr_ = np.zeros(L)
        layers = [(1.0, 1.0)]
        if octave_layer:
            layers.append((0.5, octave_layer))
        for mult, lg in layers:
            for k in range(unison):
                if unison > 1:
                    pos = k / (unison - 1) - 0.5
                    off, pan = pos * 2 * detune, pos * 2 * spread
                else:
                    off, pan = 0.0, 0.0
                o = osc(f * mult * 2 ** (off / 12), wave, rng.random(), pw) * lg
                sl += o * np.sqrt(0.5 * (1 - pan))
                sr_ += o * np.sqrt(0.5 * (1 + pan))
        sig = np.vstack([sl, sr_]) / np.sqrt(unison)
        if sub:
            sig += sub * osc(f * 0.5, 'sine')
        sig *= env * v
        if fenv:
            cut = fc * 2 ** (fenv * np.exp(-t / fdecay))
            sig = tvf(sig, cut, Q, mode)
        out[:, s0:s0 + L] += sig
    if not fenv:
        out = tvf(out, fc, Q, mode)
    return out


def mono(notes, wave='saw', unison=1, detune=0.1, spread=0.6, glide=0.03, a=0.003, d=0.15, s=0.6,
         r=0.04, fc=800.0, fenv=2.0, fdecay=0.12, Q=1.0, mode='lp', drive=0.0, sub=0.0, vib=0.0, pw=0.5):
    """Monophoner Synth mit Glide/Slide und Akzent (notes: st,du,m,v[,slide[,accent]])."""
    notes = sorted(notes, key=lambda n: n[0])
    logf = np.full(N, np.log2(mtof(notes[0][2])))
    amp = np.zeros(N)
    fe = np.zeros(N)
    prev = None
    for nt in notes:
        st, du, m, v = nt[:4]
        slide = len(nt) > 4 and nt[4]
        acc = nt[5] if len(nt) > 5 else 0.0
        s0 = b2s(st)
        if s0 >= N:
            continue
        lf = float(np.log2(mtof(m)))
        tt = np.arange(N - s0) / SR
        if slide and prev is not None:
            logf[s0:] = lf + (prev - lf) * np.exp(-tt / glide)
        else:
            logf[s0:] = lf
        prev = lf
        non = max(1, b2s(st + du) - s0)
        e = adsr(non, 0.0005 if slide else a, d, s, r)
        L = min(len(e), N - s0)
        amp[s0:s0 + L] = np.maximum(amp[s0:s0 + L], e[:L] * v)
        if not slide:
            fe[s0:s0 + L] = np.maximum(fe[s0:s0 + L], (0.55 + acc) * np.exp(-tt[:L] / fdecay))
    f = 2 ** logf
    if vib:
        f = f * 2 ** (vib * np.sin(2 * np.pi * 5.8 * np.arange(N) / SR) / 12)
    sl = np.zeros(N)
    sr_ = np.zeros(N)
    for k in range(unison):
        if unison > 1:
            pos = k / (unison - 1) - 0.5
            off, pan = pos * 2 * detune, pos * 2 * spread
        else:
            off, pan = 0.0, 0.0
        o = osc(f * 2 ** (off / 12), wave, rng.random(), pw)
        sl += o * np.sqrt(0.5 * (1 - pan))
        sr_ += o * np.sqrt(0.5 * (1 + pan))
    sig = np.vstack([sl, sr_]) / np.sqrt(unison)
    sig *= amp
    cut = np.asarray(fc) * 2 ** (fenv * fe)
    sig = tvf(sig, cut, Q, mode)
    if drive:
        sig = np.tanh(drive * sig / peak(sig)) / np.tanh(drive) * amp.max()
    if sub:
        sig += sub * osc(f * 0.5, 'sine') * amp
    return sig


def fm_bell(notes, ratio=3.5, index=3.5, decay=0.9, idecay=0.25):
    out = np.zeros((2, N))
    for st, du, m, v in notes:
        s0 = b2s(st)
        L = min(b2s(du) + int(decay * 3 * SR), N - s0)
        if L <= 0:
            continue
        t = np.arange(L) / SR
        f = float(mtof(m))
        att = np.clip(t / 0.002, 0, 1)
        for ch, cents in ((0, -4), (1, 4)):
            ff = f * 2 ** (cents / 1200)
            mod = np.sin(2 * np.pi * ff * ratio * t) * index * np.exp(-t / idecay)
            car = np.sin(2 * np.pi * ff * t + mod) * np.exp(-t / decay)
            car += 0.25 * np.sin(2 * np.pi * ff * 2 * t) * np.exp(-t / 0.35)
            out[ch, s0:s0 + L] += car * att * v
    return out


FORMANTS = {
    'a': [(800, 80, 1.0), (1150, 90, 0.55), (2900, 120, 0.3)],
    'e': [(400, 70, 1.0), (1700, 90, 0.5), (2600, 110, 0.35)],
    'i': [(300, 60, 1.0), (2200, 100, 0.45), (3000, 120, 0.35)],
    'o': [(470, 70, 1.0), (850, 80, 0.6), (2600, 110, 0.2)],
    'u': [(340, 60, 1.0), (720, 70, 0.4), (2500, 110, 0.15)],
}


def vox(notes, vowels):
    """Formant-Synth: klingt wie gechoppte Vocals."""
    out = np.zeros((2, N))
    for i, (st, du, m, v) in enumerate(notes):
        s0 = b2s(st)
        non = max(1, b2s(st + du) - s0 - int(0.012 * SR))
        R = int(0.03 * SR)
        L = min(non + R, N - s0)
        if L <= int(0.01 * SR):
            continue
        t = np.arange(L) / SR
        f = float(mtof(m)) * 2 ** ((-0.9 * np.exp(-t / 0.025) + 0.12 * np.sin(2 * np.pi * 6 * t)) / 12)
        src = osc(f, 'saw', rng.random()) + 0.6 * osc(f * 1.003, 'saw', rng.random())
        src += 0.08 * rng.standard_normal(L)
        y = np.zeros(L)
        for fcf, bw, g in FORMANTS[vowels[i % len(vowels)]]:
            y += g * tvf(src, fcf, fcf / bw, 'bp')
        env = np.ones(L)
        A = int(0.004 * SR)
        env[:A] = np.linspace(0, 1, A)
        env[non:] = np.linspace(1, 0, L - non) if L > non else env[non:]
        y *= env * v
        out[:, s0:s0 + L] += np.vstack([y, y])
    return out


# --------------------------------------------------------------- Drums
def kick_os(f0=165, f1=47, pdecay=0.038, decay=0.32, drive=2.8, click=0.6, length=0.5):
    L = int(length * SR)
    t = np.arange(L) / SR
    f = f1 + (f0 - f1) * np.exp(-t / pdecay)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR)
    amp = np.exp(-t / decay) * np.clip((length - t) / 0.04, 0, 1)
    cl = filt(rng.standard_normal(L), 'bandpass', [1500, 9000]) * np.exp(-t / 0.004)
    k = body * amp + click * 0.5 * cl
    return np.tanh(drive * k) / np.tanh(drive)


def hard_kick(note=35):
    length = BEAT * 0.96
    L = int(length * SR)
    t = np.arange(L) / SR
    f1 = float(mtof(note))
    f = f1 + (420 - f1) * np.exp(-t / 0.022)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR)
    amp = np.exp(-t / 0.5) * np.clip((length - t) / 0.03, 0, 1)
    k = np.tanh(9.0 * body * amp)
    k = filt(k, 'lowpass', 5500, 4)
    cl = filt(rng.standard_normal(L), 'highpass', 3000) * np.exp(-t / 0.003)
    return norm(k + 0.4 * cl)


def b808(m, dur_s, drive=2.2):
    L = int((dur_s + 0.06) * SR)
    t = np.arange(L) / SR
    f = float(mtof(m)) * (1 + 0.9 * np.exp(-t / 0.018))
    y = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 1.3)
    y *= np.clip((L / SR - t) / 0.05, 0, 1)
    return np.tanh(drive * y) / np.tanh(drive)


def clap_os(length=0.45, tone=1300):
    L = int(length * SR)
    t = np.arange(L) / SR
    n = rng.standard_normal(L)
    env = np.zeros(L)
    for off in (0.0, 0.010, 0.021):
        m = t >= off
        env[m] += np.exp(-(t[m] - off) / 0.0055)
    m = t >= 0.03
    env[m] += 0.85 * np.exp(-(t[m] - 0.03) / 0.11)
    y = filt(n, 'bandpass', [tone * 0.6, tone * 3.2]) * env
    return norm(y)


def snare_os(length=0.35, tone=190, snap=3800):
    L = int(length * SR)
    t = np.arange(L) / SR
    noise = filt(rng.standard_normal(L), 'bandpass', [snap * 0.4, min(snap * 3, 16000)]) * np.exp(-t / 0.12)
    body = np.sin(2 * np.pi * tone * t) * np.exp(-t / 0.06) + 0.5 * np.sin(2 * np.pi * tone * 1.7 * t) * np.exp(-t / 0.04)
    return norm(np.tanh(1.5 * (noise * 1.2 + body * 0.9)))


def hat_os(decay=0.035, length=0.25):
    L = int(length * SR)
    t = np.arange(L) / SR
    metal = sum(np.sign(np.sin(2 * np.pi * f * t + rng.random() * 6)) for f in (205.3, 304.4, 369.6, 522.7, 540.0, 800.0))
    y = 0.6 * rng.standard_normal(L) + 0.25 * metal
    y = filt(y, 'highpass', 7200, 4) * np.exp(-t / decay)
    return norm(y)


def crash_os(length=2.5):
    L = int(length * SR)
    t = np.arange(L) / SR
    y = filt(rng.standard_normal((2, L)), 'highpass', 4500, 2) * np.exp(-t / 0.9)
    y += 0.3 * filt(rng.standard_normal((2, L)), 'bandpass', [2500, 6000]) * np.exp(-t / 0.25)
    return norm(y)


def impact_os(length=2.2):
    L = int(length * SR)
    t = np.arange(L) / SR
    f = 32 + 70 * np.exp(-t / 0.08)
    boom = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.8)
    return norm(np.tanh(2.2 * boom))


def riser_os(beats=4.0, f_lo=300, f_hi=9000, tonal=None):
    L = b2s(beats)
    t = np.arange(L) / L
    n = rng.standard_normal((2, L))
    cut = f_lo * (f_hi / f_lo) ** (t ** 1.4)
    y = tvf(n, cut, 2.5, 'bp', block=64)
    if tonal is not None:
        ff = mtof(tonal) * 2 ** (t ** 2 * 2)
        y += 0.25 * stereo(osc(ff, 'saw')) * 0.5 + 0.25 * stereo(osc(ff * 1.01, 'saw')) * 0.5
    return norm(y) * (t ** 2)


def sidechain(kick_beats, depth=0.8, release=0.2):
    g = np.ones(N)
    for b in kick_beats:
        s0 = b2s(b)
        if s0 >= N:
            continue
        L = min(int(release * SR), N - s0)
        t = np.arange(L) / SR
        curve = 1 - depth * np.clip(1 - t / release, 0, 1) ** 2
        A = min(L, int(0.003 * SR))
        curve[:A] = 1 - depth * np.linspace(0, 1, A)
        g[s0:s0 + L] = np.minimum(g[s0:s0 + L], curve)
    return g


def gate(pattern, start=DROP, end=END, step=0.25, smooth=0.004):
    g = np.zeros(N)
    b = start
    i = 0
    while b < end:
        if pattern[i % len(pattern)]:
            s0, s1 = b2s(b), min(N, b2s(b + step * 0.85))
            g[s0:s1] = 1.0
        b += step
        i += 1
    k = max(1, int(smooth * SR))
    return np.convolve(g, np.ones(k) / k, mode='same')


# ----------------------------------------------------------------- FX
def reverb(x, decay=2.0, lp=7000, predelay=0.02, hp=250):
    L = int(decay * SR)
    t = np.arange(L) / SR
    ir = rng.standard_normal((2, L)) * np.exp(-t * 6.9 / decay)
    ir = filt(ir, 'lowpass', lp)
    ir = np.concatenate([np.zeros((2, int(predelay * SR))), ir], axis=1)
    wet = signal.fftconvolve(stereo(x), ir, axes=1)[:, :N]
    wet = filt(wet, 'highpass', hp)
    return wet / rms(wet) * rms(x)


def pingpong(x, beats=0.75, fb=0.45, taps=7, lp=4500, hp=300):
    x = stereo(x)
    d = b2s(beats)
    m = x.mean(axis=0)
    out = np.zeros((2, N))
    for k in range(1, taps + 1):
        sh = d * k
        if sh >= N:
            break
        out[k % 2, sh:] += m[:N - sh] * fb ** (k - 1)
    return filt(filt(out, 'lowpass', lp), 'highpass', hp)


def master(mix, drive=2.0, ceiling=0.966):
    mix = filt(mix, 'highpass', 28)
    ref = np.percentile(np.abs(mix), 99.95)
    mix = mix / ref
    mix = np.tanh(drive * mix * 0.55) / np.tanh(drive * 0.55)
    mix = mix / peak(mix) * ceiling
    fi = int(0.003 * SR)
    mix[:, :fi] *= np.linspace(0, 1, fi)
    fo = int(0.30 * SR)
    mix[:, -fo:] *= np.linspace(1, 0, fo) ** 1.5
    return mix


# --------------------------------------------------------- Arrangement
def bars(progression, start=DROP, end=END, beats_per=4):
    """Liefert (bar_start_beat, element) fuer jede Takt-Position im Drop."""
    out = []
    b, i = start, 0
    while b < end:
        out.append((b, progression[i % len(progression)]))
        b += beats_per
        i += 1
    return out


def build_fx(mix, snare=None, tonal=None, roll_gain=0.55, riser_gain=0.5):
    snare = snare if snare is not None else snare_os()
    beats = list(np.arange(0, 2, 0.5)) + list(np.arange(2, 3, 0.25)) + list(np.arange(3, 4, 0.125))
    for b in beats:
        vel = 0.2 + 0.8 * (b / 4) ** 1.6
        place(mix, snare, b, roll_gain * vel, pan=0.15 * np.sin(b * 7))
    place(mix, riser_os(4, tonal=tonal), 0, riser_gain)


def impacts(mix, gain=0.6, beats=(DROP, END)):
    cr = crash_os()
    im = impact_os()
    for b in beats:
        place(mix, cr, b, 0.35 * gain)
        place(mix, im, b, 0.9 * gain)


def four_floor(mix, kick, gain=1.0, start=DROP, end=END):
    kb = list(np.arange(start, end, 1.0))
    for b in kb:
        place(mix, kick, b, gain)
    return kb


def hats(mix, start=DROP, end=END, closed=0.16, opened=0.2, swing=0.0, ohat_decay=0.2):
    ch = hat_os(0.03)
    oh = hat_os(ohat_decay, 0.6)
    accents = [0.55, 0.35, 1.0, 0.35]
    b = start
    i = 0
    while b < end:
        sw = swing if i % 2 else 0.0
        if closed and i % 4 != 2:
            place(mix, ch, b + sw, closed * accents[i % 4], pan=0.25 if i % 2 else -0.15)
        if opened and i % 4 == 2:
            place(mix, oh, b, opened, pan=0.1)
        b += 0.25
        i += 1


def finish(stems, kick_beats=None):
    mix = np.zeros((2, N))
    for s in stems:
        mix += s
    return master(mix)


# ========================================================== 10 SAMPLES

def s01_neon_rush():
    """F-Moll Supersaw-Hymne, Four-on-the-floor, gepumpte Pads."""
    A = [(0, .75, 'C5'), (.75, .75, 'C5'), (1.5, .5, 'Ab4'), (2, .5, 'C5'), (2.5, 1, 'Eb5'), (3.5, .5, 'C5'),
         (4, .75, 'Db5'), (4.75, .75, 'Db5'), (5.5, .5, 'C5'), (6, .5, 'Ab4'), (6.5, 1.5, 'F4'),
         (8, .75, 'C5'), (8.75, .75, 'C5'), (9.5, .5, 'Eb5'), (10, .5, 'F5'), (10.5, .5, 'Eb5'), (11, 1, 'C5')]
    endA = [(12, .75, 'Bb4'), (12.75, .75, 'C5'), (13.5, .5, 'Bb4'), (14, 1.5, 'G4')]
    endB = [(12, .75, 'Bb4'), (12.75, .75, 'C5'), (13.5, .5, 'Eb5'), (14, 2, 'F5')]
    hook = H(A + endA, DROP) + H(A + endB, DROP + 16) + H([(0, 2, 'F5')], END)
    teaser = H(A[:6], 0, 0.8)
    chords = {'Fm': [53, 56, 60, 65], 'Db': [53, 56, 61, 65], 'Ab': [51, 56, 60, 63], 'Eb': [51, 55, 58, 63]}
    roots = {'Fm': 41, 'Db': 37, 'Ab': 32, 'Eb': 39}
    prog = ['Fm', 'Db', 'Ab', 'Eb']

    kick = kick_os()
    drums = np.zeros((2, N))
    kb = four_floor(drums, kick, 1.0)
    place(drums, kick, END, 1.0)
    clap = clap_os()
    for b in np.arange(DROP + 1, END, 2):
        place(drums, clap, b, 0.55)
    hats(drums)
    build_fx(drums, tonal=nm('F3'))
    impacts(drums)
    sc = sidechain(kb + [END], 0.85, 0.22)

    lead = poly(hook + teaser, 'saw', unison=7, detune=0.22, spread=0.9, a=0.004, d=0.35, s=0.75, r=0.18,
                fc=7500, octave_layer=0.6)
    tease_cut = np.ones(N)
    lead_f = lead.copy()
    lead_f[:, :b2s(DROP)] = tvf(lead[:, :b2s(DROP)], 300 * 2 ** (np.linspace(0, 1, b2s(DROP)) ** 2 * 3.5), 2.0)
    lead = norm(lead_f, 0.5) * sidechain(kb + [END], 0.35, 0.18)

    pad_notes = []
    for b, c in bars(prog):
        pad_notes += [(b, 4, m, 0.8) for m in chords[c]]
    pad_notes += [(END, 1, m, 0.8) for m in chords['Fm']]
    pad = norm(poly(pad_notes, 'saw', 5, 0.2, 0.9, a=0.02, d=1, s=0.8, r=0.3, fc=3200), 0.32) * sc

    bass_notes = []
    for b, c in bars(prog):
        for o in (0.5, 1.5, 2.5, 3.5):
            bass_notes.append((b + o, 0.4, roots[c], 1.0))
    bass = mono(bass_notes, 'saw', unison=2, detune=0.08, fc=380, fenv=2.2, fdecay=0.09, Q=1.4, sub=0.9,
                d=0.12, s=0.5)
    bass = norm(bass, 0.6) * sc

    sends = reverb(lead, 2.4) * 0.35 + pingpong(lead, 0.75, 0.4) * 0.25 + reverb(pad, 1.5) * 0.2
    return finish([norm(drums, 1.0), lead, pad, bass, sends])


def s02_acid_magnet():
    """A-Moll 303-Acid mit Slides, Resonanz-Sweep und 3-3-2-Chord-Stabs."""
    pat = [('A2', 1, 0, 1), ('A2', 0, 0, 0), ('A3', 1, 1, 0), ('A2', 1, 0, 1), (None,),
           ('C3', 1, 0, 0), ('A2', 1, 0, 1), ('G2', 1, 1, 0), ('A2', 1, 0, 0), ('E3', 1, 0, 1),
           (None,), ('D3', 1, 1, 0), ('E3', 1, 0, 0), ('A2', 1, 0, 0), ('G3', 1, 0, 1), ('C3', 1, 0, 0)]
    trans = [0, 0, -4, -2]
    notes = []
    for bi, b in enumerate(np.arange(0, END, 4)):
        tr = trans[bi % 4] if b >= DROP else 0
        for i, p in enumerate(pat):
            if p[0] is None:
                continue
            n, on, sl, acc = p
            notes.append((b + i * 0.25, 0.22 if not sl else 0.3, nm(n) + tr, 0.75 + 0.25 * acc, bool(sl), 0.6 * acc))
    notes.append((END, 0.5, nm('A2'), 1.0, False, 0.8))
    tt = np.arange(N) / N
    lfo = np.sin(2 * np.pi * np.arange(N) / (b2s(8)))
    cut = 220 * (8.0 ** (tt ** 0.8)) * 2 ** (0.45 * lfo)
    acid = mono(notes, 'saw', fc=cut, fenv=2.6, fdecay=0.11, Q=9.0, glide=0.028, a=0.002, d=0.12, s=0.55,
                r=0.03, drive=3.2)
    acid = filt(acid, 'highpass', 60)

    kick = kick_os(f0=150, f1=45, decay=0.36, drive=3.5)
    drums = np.zeros((2, N))
    kb = four_floor(drums, kick, 1.0)
    place(drums, kick, END, 1.0)
    for b in np.arange(DROP + 1, END, 2):
        place(drums, clap_os(tone=1500), b, 0.5)
    hats(drums, closed=0.12, opened=0.22)
    build_fx(drums, roll_gain=0.45)
    impacts(drums, 0.5)
    sc = sidechain(kb + [END], 0.75, 0.2)
    acid = norm(acid, 0.55) * sidechain(kb + [END], 0.45, 0.16)

    stab_types = [(57, [0, 3, 7, 10]), (57, [0, 3, 7, 10]), (53, [0, 4, 7, 11]), (55, [0, 4, 7, 9])]
    stabs = []
    for bi, (b, _) in enumerate(bars([0])):
        root, iv = stab_types[bi % 4]
        for o in (0, .75, 1.5, 2, 2.75, 3.5):
            stabs += [(b + o, 0.2, root + x, 0.9) for x in iv]
    stabs += [(END, 0.5, 57 + x, 1.0) for x in [0, 3, 7, 10]]
    stab = poly(stabs, 'sawsq', 3, 0.12, 0.7, a=0.002, d=0.12, s=0.0, r=0.1, fc=1200, fenv=1.8, fdecay=0.07, Q=2.0)
    stab = norm(stab, 0.33) * sc

    sends = reverb(stab, 1.8) * 0.4 + pingpong(stab, 0.75, 0.5) * 0.35 + pingpong(acid, 0.5, 0.3) * 0.15
    return finish([norm(drums, 1.0), acid, stab, sends])


def s03_hyper_pluck():
    """C#-Moll Hyperpop: 16tel-Pluck-Arp, Chirp-Hook, 808."""
    chords = {'C#m': [61, 64, 68], 'A': [57, 61, 64], 'E': [64, 68, 71], 'B': [59, 63, 66]}
    roots = {'C#m': 37, 'A': 33, 'E': 40, 'B': 35}
    prog = ['C#m', 'A', 'E', 'B']
    order = [0, 2, 1, 3, 2, 4, 3, 5, 4, 3, 5, 2, 4, 1, 3, 2]
    arp = []
    for b, c in bars(prog, 0):
        tones = chords[c] + [x + 12 for x in chords[c]]
        for i, o in enumerate(order):
            arp.append((b + i * 0.25, 0.2, tones[o], 0.6 + 0.4 * (i % 4 == 0)))
    pl = poly(arp, 'sawsq', 3, 0.1, 0.6, a=0.001, d=0.12, s=0.0, r=0.08, fc=700, fenv=3.6, fdecay=0.07, Q=1.6)

    A = [(0, .5, 'G#5'), (.75, .5, 'G#5'), (1.5, .5, 'E5'), (2, .5, 'F#5'), (2.5, .5, 'G#5'), (3, 1, 'B5'),
         (4, .5, 'A5'), (4.75, .5, 'G#5'), (5.5, .5, 'E5'), (6, 1.5, 'C#5'),
         (8, .5, 'E5'), (8.75, .5, 'F#5'), (9.5, .5, 'G#5'), (10, .5, 'B5'), (10.5, .5, 'G#5'), (11, 1, 'E5')]
    eA = [(12, .5, 'F#5'), (12.75, .5, 'D#5'), (13.5, .5, 'F#5'), (14, 2, 'G#5')]
    eB = [(12, .5, 'F#5'), (12.75, .5, 'G#5'), (13.5, .5, 'B5'), (14, 2, 'C#6')]
    hook = H(A + eA, DROP) + H(A + eB, DROP + 16) + H([(0, 1.5, 'C#6')], END)
    chirp = poly(hook, 'square', 2, 0.06, 0.5, a=0.002, d=0.2, s=0.6, r=0.12, fc=5500, pitch_env=12,
                 pitch_decay=0.012, vib=0.25, pw=0.35)
    chirp2 = poly([(s, d, m - 12, v * 0.6) for s, d, m, v in hook], 'saw', 5, 0.18, 0.9, a=0.004, d=0.3, s=0.6,
                  r=0.12, fc=4000)

    drums = np.zeros((2, N))
    kick = kick_os(f0=180, decay=0.25, drive=3.0)
    kb = []
    eights = []
    for b, c in bars(prog):
        for o, du in ((0, 1.5), (1.75, 0.6), (2.5, 1.4)):
            place(drums, kick, b + o, 0.85)
            kb.append(b + o)
            eights.append((b + o, du, roots[c]))
        place(drums, snare_os(tone=210), b + 1, 0.7)
        place(drums, clap_os(), b + 3, 0.6)
        place(drums, snare_os(tone=210), b + 3, 0.45)
    ch = hat_os(0.025)
    for i, b in enumerate(np.arange(DROP, END, 0.5)):
        place(drums, ch, b, 0.16 if i % 2 else 0.24, pan=0.2)
        if (b - DROP) % 8 == 7.5:
            for k in range(4):
                place(drums, ch, b + k * 0.125, 0.12 + 0.03 * k, pan=-0.3)
    place(drums, kick, END, 0.9)
    build_fx(drums, roll_gain=0.45, tonal=nm('C#3'))
    impacts(drums, 0.55)
    bass = np.zeros((2, N))
    for st, du, m in eights + [(END, 1.2, 37)]:
        place(bass, b808(m, du * BEAT), st, 1.0)
    sc = sidechain(kb + [END], 0.55, 0.15)

    pl = norm(pl, 0.38) * sc
    chirp = norm(chirp, 0.38)
    chirp2 = norm(chirp2, 0.2) * sc
    sends = pingpong(pl, 0.75, 0.45) * 0.35 + reverb(chirp + chirp2, 1.6) * 0.3 + pingpong(chirp, 0.5, 0.3) * 0.15
    return finish([norm(drums, 0.95), norm(bass, 0.75), pl, chirp, chirp2, sends])


def s04_reese_thunder():
    """E-Moll Halftime: Reese-Bass mit LFO, FM-Glocken-Hook, dunkles Pad."""
    prog = [('E', 40, [52, 55, 59, 64]), ('C', 36, [52, 55, 60, 64]), ('Am', 33, [52, 57, 60, 64]),
            ('B', 35, [51, 54, 59, 63])]
    rn = []
    for b, (_, r, _) in bars(prog):
        rn.append((b, 2.4, r, 1.0))
        rn.append((b + 2.5, 1.4, r + (7 if b % 8 else 12), 0.9))
    rn.append((END, 1.0, 40, 1.0))
    lfo = 0.5 + 0.5 * np.sin(2 * np.pi * np.arange(N) / (b2s(1) * 0.75))
    cut = 180 * 2 ** (3.2 * lfo)
    reese = mono(rn, 'saw', unison=4, detune=0.22, spread=0.7, fc=cut, fenv=0.8, fdecay=0.2, Q=2.2, a=0.01,
                 d=0.5, s=0.9, r=0.08, drive=3.5, sub=0.0)
    reese = filt(reese, 'lowpass', 4200)
    subn = mono([(s, d, m - 12, v) for s, d, m, v in rn], 'sine', fc=2000, fenv=0, a=0.005, d=1, s=1, r=0.05)

    A = [(0, .5, 'B5'), (.5, .5, 'G5'), (1, .5, 'E5'), (1.5, .5, 'B5'), (2, .75, 'A5'), (2.75, .75, 'G5'),
         (3.5, .5, 'F#5'), (4, .5, 'E5'), (4.5, .5, 'G5'), (5, 1, 'C6'), (6, .5, 'B5'), (6.5, 1.5, 'G5'),
         (8, .5, 'A5'), (8.5, .5, 'C6'), (9, 1, 'E6'), (10, .5, 'D6'), (10.5, .5, 'C6'), (11, 1, 'B5')]
    eA = [(12, .5, 'F#5'), (12.5, .5, 'A5'), (13, 1, 'B5'), (14, 2, 'D#6')]
    eB = [(12, .5, 'F#5'), (12.5, .5, 'A5'), (13, 1, 'B5'), (14, .5, 'A5'), (14.5, .5, 'G5'), (15, 1, 'F#5')]
    hook = H(A + eA, DROP) + H(A + eB, DROP + 16) + H([(0, 2, 'E6')], END) + H(A[:7], 0, 0.6)
    bell = fm_bell(hook, ratio=3.5, index=3.0, decay=0.8)

    padn = []
    for b, (_, _, ch) in bars(prog):
        padn += [(b, 4, m, 0.7) for m in ch]
    padn += [(END, 1, m, 0.7) for m in prog[0][2]]
    pad = poly(padn, 'saw', 5, 0.25, 1.0, a=0.25, d=1.0, s=0.9, r=0.5, fc=1400)

    drums = np.zeros((2, N))
    kick = kick_os(f0=150, f1=44, decay=0.4, drive=3.2)
    sn = snare_os(tone=180, snap=3000)
    kb = []
    for b, _ in bars(prog):
        for o in (0, 2.5) if (b // 4) % 2 == 0 else (0, 1.75, 2.5):
            place(drums, kick, b + o, 1.0)
            kb.append(b + o)
        place(drums, sn, b + 2, 0.85)
        place(drums, clap_os(), b + 2, 0.4)
    place(drums, kick, END, 1.0)
    hats(drums, closed=0.14, opened=0.0, swing=0.03)
    build_fx(drums, sn, tonal=nm('E2'))
    impacts(drums, 0.7)
    sc = sidechain(kb + [END], 0.7, 0.18)

    reese = norm(reese, 0.5) * sc
    subn = norm(subn, 0.5) * sc
    bell = norm(bell, 0.45)
    pad = norm(pad, 0.22) * sc
    sends = reverb(bell, 2.8) * 0.45 + pingpong(bell, 0.75, 0.4) * 0.25 + reverb(pad, 2.5) * 0.3
    return finish([norm(drums, 1.0), reese, subn, bell, pad, sends])


def s05_laser_chip():
    """G-Moll Chiptune-Power: Pulse-Lead mit Glide, 32tel-Arps, Laser-Zaps."""
    A = [(0, .25, 'G5'), (.25, .25, 'Bb5'), (.5, .5, 'D6'), (1, .25, 'Bb5'), (1.25, .25, 'D6'), (1.5, 1, 'G6'),
         (2.5, .5, 'F6'), (3, 1, 'D6'),
         (4, .5, 'Eb6'), (4.5, .5, 'D6'), (5, .5, 'Bb5'), (5.5, .5, 'G5'), (6, 1, 'Bb5'), (7, .5, 'G5'), (7.5, .5, 'F5'),
         (8, .25, 'D6'), (8.25, .25, 'F6'), (8.5, .5, 'D6'), (9, .5, 'Bb5'), (9.5, 1, 'F6'), (10.5, .5, 'Eb6'), (11, 1, 'D6')]
    eA = [(12, .5, 'C6'), (12.5, .5, 'A5'), (13, .5, 'F5'), (13.5, .5, 'A5'), (14, 1, 'C6'), (15, 1, 'D6')]
    eB = [(12, .5, 'C6'), (12.5, .5, 'D6'), (13, .5, 'F6'), (13.5, .5, 'A6'), (14, 2, 'G6')]
    hook = H(A + eA, DROP) + H(A + eB, DROP + 16) + H([(0, 1, 'G6')], END)
    hook_s = [(s, d, m, v, i % 3 == 1) for i, (s, d, m, v) in enumerate(hook)]
    lead = mono(hook_s, 'square', unison=2, detune=0.08, spread=0.4, glide=0.02, pw=0.25, fc=6000, fenv=1.0,
                fdecay=0.1, Q=0.9, a=0.002, d=0.25, s=0.75, r=0.06, vib=0.12)
    lead_oct = mono([(s, d, m - 12, v) for s, d, m, v in hook], 'saw', fc=3000, fenv=1.0, Q=0.8, d=0.2, s=0.7)

    chords = {'Gm': [55, 58, 62], 'Eb': [55, 58, 63], 'Bb': [53, 58, 62], 'F': [53, 57, 60]}
    roots = {'Gm': 43, 'Eb': 39, 'Bb': 46, 'F': 41}
    prog = ['Gm', 'Eb', 'Bb', 'F']
    arp = []
    for b, c in bars(prog, 0):
        tones = chords[c] + [chords[c][0] + 12]
        for i in range(32):
            arp.append((b + i * 0.125, 0.1, tones[i % 4] + 12 * ((i // 8) % 2), 0.7))
    arps = poly(arp, 'square', 1, pw=0.5, a=0.001, d=0.06, s=0.2, r=0.03, fc=5000)
    bn = []
    for b, c in bars(prog):
        for i, o in enumerate(np.arange(0, 4, 0.5)):
            bn.append((b + o, 0.4, roots[c] + (12 if i in (3, 6) else 0), 1.0))
    bn.append((END, 1, 43, 1.0))
    bass = mono(bn, 'square', fc=900, fenv=1.6, fdecay=0.08, Q=1.2, pw=0.5, sub=0.8, d=0.1, s=0.5)

    drums = np.zeros((2, N))
    kick = kick_os(f0=190, f1=50, decay=0.28, drive=3.0)
    kb = four_floor(drums, kick, 1.0)
    place(drums, kick, END, 1.0)
    sn = snare_os(tone=240, snap=5000)
    for b in np.arange(DROP + 1, END, 2):
        place(drums, sn, b, 0.7)
    hats(drums, closed=0.18, opened=0.12)
    zap = np.zeros(int(0.25 * SR))
    tz = np.arange(len(zap)) / SR
    zap = osc(2400 * np.exp(-tz / 0.04) + 120, 'square') * np.exp(-tz / 0.08)
    for b in (DROP + 15.5, DROP + 31.5, 1.5, 3.5):
        place(drums, zap, b, 0.25, pan=0.4)
    build_fx(drums, sn, tonal=nm('G3'))
    impacts(drums, 0.55)
    sc = sidechain(kb + [END], 0.6, 0.17)

    lead = norm(lead, 0.42)
    lead_oct = norm(lead_oct, 0.16) * sc
    arps = norm(arps, 0.18) * sc * np.clip((np.arange(N) / SR) / 1.6, 0.25, 1)
    bass = norm(bass, 0.5) * sc
    sends = pingpong(lead, 0.75, 0.35) * 0.25 + reverb(lead + arps, 1.4) * 0.25
    return finish([norm(drums, 1.0), lead, lead_oct, arps, bass, sends])


def s06_hard_screech():
    """H-Moll Hardstyle-Energie: verzerrte Kicks, euphorische Supersaw + Screech-Layer."""
    A = [(0, .75, 'F#5'), (.75, .75, 'F#5'), (1.5, .5, 'D5'), (2, .5, 'E5'), (2.5, .5, 'F#5'), (3, 1, 'A5'),
         (4, .75, 'G5'), (4.75, .75, 'F#5'), (5.5, .5, 'E5'), (6, 2, 'D5'),
         (8, .75, 'F#5'), (8.75, .75, 'A5'), (9.5, .5, 'B5'), (10, .5, 'A5'), (10.5, .5, 'F#5'), (11, 1, 'E5')]
    eA = [(12, .75, 'E5'), (12.75, .75, 'F#5'), (13.5, .5, 'E5'), (14, 2, 'C#5')]
    eB = [(12, .75, 'E5'), (12.75, .75, 'F#5'), (13.5, .5, 'A5'), (14, 2, 'B5')]
    hook = H(A + eA, DROP) + H(A + eB, DROP + 16) + H([(0, 2, 'B5')], END)
    lead = poly(hook + H(A[:6], 0, 0.7), 'saw', 7, 0.28, 1.0, a=0.003, d=0.4, s=0.8, r=0.2, fc=9000, octave_layer=0.5)
    scr = mono([(s, d, m - 12, v, False) for s, d, m, v in hook], 'saw', unison=3, detune=0.15, fc=1800, fenv=1.5,
               fdecay=0.05, Q=6.0, mode='bp', a=0.001, d=0.2, s=0.8, r=0.05, vib=0.4)
    scr = sat(scr, 6.0)
    scr = filt(scr, 'lowpass', 7000)

    prog = [[59, 62, 66], [55, 59, 62], [57, 62, 66], [57, 61, 64]]
    tails = [35, 31, 38, 33]
    drums = np.zeros((2, N))
    kb = []
    for bi, (b, _) in enumerate(bars(prog)):
        k = hard_kick(tails[bi % 4])
        for o in range(4):
            place(drums, k, b + o, 1.0)
            kb.append(b + o)
    place(drums, hard_kick(35), END, 1.0)
    for b in np.arange(DROP + 1, END, 2):
        place(drums, clap_os(tone=1600), b, 0.45)
    hats(drums, closed=0.1, opened=0.25)
    build_fx(drums, tonal=nm('B2'), riser_gain=0.6)
    impacts(drums, 0.5)
    sc = sidechain(kb + [END], 0.9, 0.25)

    padn = []
    for b, ch in bars(prog):
        padn += [(b, 4, m, 0.7) for m in ch + [ch[0] + 12]]
    pad = poly(padn, 'saw', 5, 0.2, 0.9, a=0.01, d=1, s=0.8, r=0.3, fc=4000)

    lead = norm(lead, 0.5) * sidechain(kb + [END], 0.5, 0.22)
    scr = norm(scr, 0.22) * sc
    pad = norm(pad, 0.24) * sc
    sends = reverb(lead, 2.6) * 0.4 + pingpong(lead, 0.75, 0.35) * 0.2 + reverb(pad, 1.8) * 0.2
    return finish([norm(drums, 1.0), lead, scr, pad, sends])


def s07_festival_stab():
    """D-Moll Big-Room: Laser-Stab-Lead mit Pitch-Drop, Tom-Fills, Mega-Drop."""
    A = [(0, .5, 'D5'), (.75, .5, 'D5'), (1.5, .5, 'D5'), (2.5, .5, 'F5'), (3, .5, 'E5'), (3.5, .5, 'C5'),
         (4, .5, 'D5'), (4.75, .5, 'D5'), (5.5, .5, 'A4'), (6, .5, 'C5'), (6.5, 1.5, 'D5'),
         (8, .5, 'D5'), (8.75, .5, 'D5'), (9.5, .5, 'D5'), (10, .5, 'F5'), (10.5, .5, 'G5'), (11, 1, 'A5')]
    eA = [(12, .5, 'G5'), (12.75, .5, 'F5'), (13.5, .5, 'E5'), (14, 2, 'C5')]
    eB = [(12, .5, 'G5'), (12.75, .5, 'F5'), (13.5, .5, 'E5'), (14, 1, 'A5'), (15, 1, 'D6')]
    hook = H(A + eA, DROP) + H(A + eB, DROP + 16) + H([(0, 1, 'D6')], END)
    stab = poly(hook, 'saw', 7, 0.3, 1.0, a=0.001, d=0.18, s=0.35, r=0.12, fc=2800, fenv=1.6, fdecay=0.06, Q=1.2,
                pitch_env=7, pitch_decay=0.012, octave_layer=0.8)
    stab_sq = poly([(s, d, m + 12, v * 0.5) for s, d, m, v in hook], 'square', 1, a=0.001, d=0.1, s=0.2, r=0.08,
                   fc=4000, pitch_env=12, pitch_decay=0.008)
    subl = mono([(s, d, m - 24, v) for s, d, m, v in hook], 'sine', fc=3000, fenv=0, a=0.002, d=0.2, s=0.7, r=0.05)

    drums = np.zeros((2, N))
    kick = kick_os(f0=200, f1=46, pdecay=0.03, decay=0.42, drive=4.0, click=0.9)
    kb = four_floor(drums, kick, 1.0)
    place(drums, kick, END, 1.0)
    clap = clap_os(tone=1100)
    for b in np.arange(DROP + 1, END, 2):
        place(drums, clap, b, 0.6)
    hats(drums, closed=0.12, opened=0.22)
    tom_t = np.arange(int(0.3 * SR)) / SR
    for i, b in enumerate([DROP + 14.5, DROP + 15, DROP + 15.5, DROP + 30.5, DROP + 31, DROP + 31.5]):
        f = (140 - 25 * (i % 3)) * (1 + 0.5 * np.exp(-tom_t / 0.02))
        tom = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tom_t / 0.12)
        place(drums, tom, b, 0.6, pan=0.4 - 0.4 * (i % 3))
    # Build: Kick-Roll + Snare-Roll + Riser (klassischer Festival-Build)
    for b in np.arange(0, 4, 0.5):
        place(drums, kick, b, 0.3 + 0.15 * b)
    build_fx(drums, roll_gain=0.6, tonal=nm('D3'), riser_gain=0.6)
    impacts(drums, 0.8)
    sc = sidechain(kb + [END], 0.5, 0.15)

    stab = norm(stab, 0.5) * sc
    stab_sq = norm(stab_sq, 0.12) * sc
    subl = norm(subl, 0.35) * sidechain(kb + [END], 0.85, 0.2)
    sends = reverb(stab, 2.2) * 0.45 + pingpong(stab, 0.5, 0.3) * 0.15
    return finish([norm(drums, 1.0), stab, stab_sq, subl, sends])


def s08_dark_pulse():
    """F#-Moll Techno: Rolling Bass, 3-gegen-4 Polymeter-Sequenz, Dub-Stabs."""
    drums = np.zeros((2, N))
    kick = kick_os(f0=140, f1=44, decay=0.38, drive=3.0)
    kb = four_floor(drums, kick, 1.0)
    place(drums, kick, END, 1.0)
    rumble = np.zeros((2, N))
    for b in kb:
        place(rumble, kick, b, 1.0)
    rumble = filt(reverb(rumble, 1.2, lp=300, hp=40), 'lowpass', 180) * 0.6
    rumble = stereo(rumble.mean(axis=0))  # Sub-Bereich mono halten
    for b in np.arange(DROP + 1, END, 2):
        place(drums, clap_os(tone=1200), b, 0.5)
    hats(drums, closed=0.14, opened=0.24, ohat_decay=0.12)
    ride = hat_os(0.3, 0.6)
    for b in np.arange(DROP + 16, END, 0.5):
        place(drums, filt(ride, 'bandpass', [4000, 12000]), b, 0.08 if b % 1 else 0.05, pan=0.3)
    build_fx(drums, roll_gain=0.4)
    impacts(drums, 0.5)
    sc = sidechain(kb + [END], 0.85, 0.2)

    prog = [42, 42, 38, 40]
    bn = []
    for bi, (b, r) in enumerate(bars(prog)):
        for beat in range(4):
            for st in (1, 2, 3):
                bn.append((b + beat + st * 0.25, 0.2, r + (12 if st == 3 and beat == 3 else 0), 0.9 if st == 2 else 0.75))
    bass = mono(bn, 'saw', fc=260, fenv=2.0, fdecay=0.05, Q=1.8, a=0.001, d=0.08, s=0.3, r=0.02, sub=0.8)
    bass = norm(bass, 0.55) * sc

    seqn = []
    cyc = ['F#4', 'A4', 'C#5']
    b = 0.0
    i = 0
    while b < END:
        seqn.append((b, 0.2, nm(cyc[i % 3]) + (12 if (i // 3) % 5 == 4 else 0), 0.8))
        b += 0.25
        i += 1
    lfo = 0.5 + 0.5 * np.sin(2 * np.pi * np.arange(N) / b2s(8) - np.pi / 2)
    seq = poly(seqn, 'sawsq', 2, 0.08, 0.5, a=0.001, d=0.1, s=0.0, r=0.06, fc=600, fenv=2.5, fdecay=0.06, Q=3.0)
    seq = tvf(seq, 900 * 2 ** (2.5 * lfo), 1.0)
    seq = norm(seq, 0.32) * sidechain(kb + [END], 0.5, 0.15)

    stabn = []
    chord = [54, 57, 61, 64, 68]
    for bi, (b, r) in enumerate(bars(prog)):
        offs = (1.5,) if bi % 2 == 0 else (1.5, 3.75)
        for o in offs:
            stabn += [(b + o, 0.25, m + (r - 42), 0.9) for m in chord]
    stabn += [(END, 0.5, m, 1.0) for m in chord]
    stab = poly(stabn, 'saw', 3, 0.1, 0.6, a=0.002, d=0.15, s=0.0, r=0.15, fc=900, fenv=1.4, fdecay=0.08, Q=1.5)
    stab = norm(stab, 0.3)

    A = [(0, 1.5, 'C#5'), (1.5, .5, 'A4'), (2, 2, 'B4'), (4, 1.5, 'C#5'), (5.5, .5, 'E5'), (6, 2, 'D5'),
         (8, 1.5, 'C#5'), (9.5, .5, 'A4'), (10, 2, 'B4'), (12, 1.5, 'C#5'), (13.5, .5, 'B4'), (14, 2, 'A4')]
    leadn = H(A, DROP + 16, 0.9)
    lead = poly(leadn, 'saw', 5, 0.15, 0.8, a=0.03, d=1.0, s=0.85, r=0.3, fc=2200, vib=0.15)
    lead = norm(lead, 0.3)

    sends = (pingpong(stab, 0.75, 0.6, taps=9, lp=2500) * 0.6 + reverb(stab, 3.0) * 0.45
             + pingpong(seq, 0.75, 0.35) * 0.2 + reverb(lead, 2.5) * 0.4)
    return finish([norm(drums, 1.0), rumble, bass, seq, stab, lead, sends])


def s09_vox_chop():
    """Bb-Moll Future Bass: Formant-Vocal-Chops, wabbelnde Supersaw-Chords, Halftime."""
    A = [(0, .25, 'F5'), (.25, .25, 'Db5'), (.5, .5, 'F5'), (1, .5, 'Ab5'), (1.5, .25, 'F5'), (1.75, .25, 'Eb5'),
         (2, .5, 'Db5'), (2.5, .5, 'Bb4'), (3, .5, 'Db5'), (3.5, .5, 'Eb5'),
         (4, .5, 'F5'), (4.5, .25, 'Eb5'), (4.75, .25, 'Db5'), (5, .5, 'Eb5'), (5.5, .5, 'Ab4'), (6, 1, 'Bb4'),
         (8, .25, 'F5'), (8.25, .25, 'Ab5'), (8.5, .5, 'Bb5'), (9, .5, 'Ab5'), (9.5, .5, 'F5'), (10, .25, 'Eb5'),
         (10.25, .25, 'F5'), (10.5, .5, 'Db5'), (11, .5, 'Eb5')]
    eA = [(12, .5, 'Db5'), (12.5, .5, 'Bb4'), (13, .5, 'Db5'), (13.5, .5, 'Eb5'), (14, 1.5, 'F5')]
    eB = [(12, .5, 'Db5'), (12.5, .5, 'Eb5'), (13, .5, 'F5'), (13.5, .5, 'Ab5'), (14, 2, 'Bb5')]
    hook = H(A + eA, DROP) + H(A + eB, DROP + 16) + H([(0, 1, 'Bb5')], END)
    teaser = H(A[:10], 0, 0.7)
    vowels = ['a', 'o', 'e', 'a', 'i', 'o', 'a', 'e', 'u', 'a', 'o']
    chop = vox(hook + teaser, vowels)
    chop[:, :b2s(DROP)] = tvf(chop[:, :b2s(DROP)], 500 * 2 ** (np.linspace(0, 1, b2s(DROP)) * 3), 1.0)

    prog = [(42, [54, 58, 61, 65]), (44, [56, 60, 63, 68]), (41, [53, 56, 60, 63]), (46, [53, 58, 61, 65])]
    cn = []
    for b, (r, ch) in bars(prog):
        for o, du in ((0, 1.4), (1.5, 0.45), (2, 0.9), (3, 0.45), (3.5, 0.45)):
            cn += [(b + o, du, m, 0.8) for m in ch + [ch[1] + 12]]
    cn += [(END, 1, m, 0.8) for m in prog[3][1]]
    chords = poly(cn, 'saw', 7, 0.3, 1.0, a=0.004, d=0.6, s=0.8, r=0.12, fc=5000)
    wob_ph = (np.arange(N) / b2s(0.5)) % 1.0
    wob = 0.45 + 0.55 * (1 - wob_ph) ** 1.5
    wob[:b2s(DROP)] = 1.0
    chords = chords * wob

    drums = np.zeros((2, N))
    kick = kick_os(f0=170, f1=48, decay=0.3, drive=3.0)
    sn = snare_os(tone=200, snap=4200)
    kb = []
    for bi, (b, _) in enumerate(bars(prog)):
        ks = (0, 2.75) if bi % 2 == 0 else (0, 0.75, 2.75, 3.5)
        for o in ks:
            place(drums, kick, b + o, 1.0)
            kb.append(b + o)
        place(drums, sn, b + 2, 0.85)
        place(drums, clap_os(tone=1400), b + 2, 0.45)
    place(drums, kick, END, 1.0)
    ch = hat_os(0.025)
    for i, b in enumerate(np.arange(DROP, END, 0.5)):
        place(drums, ch, b, 0.2 if i % 2 else 0.12, pan=0.25)
    for b in np.arange(DROP + 3, END, 4):
        for k in range(6):
            place(drums, ch, b + k / 6.0 * 1.0, 0.07 + 0.015 * k, pan=-0.3)
    build_fx(drums, sn, tonal=nm('Bb2'))
    impacts(drums, 0.6)
    sc = sidechain(kb + [END], 0.85, 0.24)

    subn = []
    for b, (r, _) in bars(prog):
        subn.append((b, 3.9, r - 12, 1.0))
    subn.append((END, 1, 34, 1.0))
    sub = mono(subn, 'sine', fc=1000, fenv=0, a=0.01, d=1, s=1, r=0.05)
    sub = sat(sub, 1.6)

    chop = norm(chop, 0.48)
    chords = norm(chords, 0.32) * sc
    sub = norm(sub, 0.5) * sc
    sends = reverb(chop, 2.0) * 0.35 + pingpong(chop, 0.75, 0.4) * 0.25 + reverb(chords, 1.8) * 0.25
    return finish([norm(drums, 1.0), chop, chords, sub, sends])


def s10_euphoria():
    """Eb-Moll Trance: Trance-Gate-Pads, Pluck-Arp, Rolling Bass, Hymnen-Lead."""
    prog = [(39, [51, 54, 58, 63]), (35, [54, 59, 63, 66]), (42, [54, 58, 61, 66]), (37, [53, 56, 61, 65])]
    A = [(0, .75, 'Bb5'), (.75, .75, 'Gb5'), (1.5, .5, 'Eb5'), (2, .5, 'Bb5'), (2.5, .5, 'Ab5'), (3, .5, 'Gb5'),
         (3.5, .5, 'F5'),
         (4, .75, 'Gb5'), (4.75, .75, 'Eb5'), (5.5, .5, 'B4'), (6, 1, 'Eb5'), (7, .5, 'F5'), (7.5, .5, 'Gb5'),
         (8, .75, 'Bb5'), (8.75, .75, 'Gb5'), (9.5, .5, 'Db6'), (10, .5, 'Bb5'), (10.5, .5, 'Ab5'), (11, 1, 'Gb5')]
    eA = [(12, .75, 'F5'), (12.75, .75, 'Db5'), (13.5, .5, 'Ab5'), (14, 1, 'F5'), (15, 1, 'Ab5')]
    eB = [(12, .75, 'F5'), (12.75, .75, 'Gb5'), (13.5, .5, 'Ab5'), (14, 2, 'Bb5')]
    hook = H(A + eA, DROP) + H(A + eB, DROP + 16) + H([(0, 2, 'Eb6')], END)
    lead = poly(hook, 'saw', 7, 0.25, 1.0, a=0.005, d=0.4, s=0.8, r=0.25, fc=8000, octave_layer=0.7, vib=0.1)

    padn = []
    for b, (_, ch) in bars(prog, 0):
        padn += [(b, 4, m, 0.8) for m in ch]
    padn += [(END, 1, m, 0.8) for m in prog[0][1]]
    pad = poly(padn, 'saw', 7, 0.25, 1.0, a=0.01, d=1, s=0.9, r=0.1, fc=5000)
    g = gate([1, 0, 1, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1], start=0)
    g[b2s(END):] = 1.0
    pad = pad * g

    arp = []
    for b, (_, ch) in bars(prog, 0):
        tones = ch + [ch[1] + 12, ch[2] + 12]
        for i, o in enumerate([0, 2, 1, 3, 2, 4, 3, 5, 4, 3, 2, 1, 2, 3, 4, 5]):
            arp.append((b + i * 0.25, 0.2, tones[o] + 12, 0.7))
    pl = poly(arp, 'saw', 2, 0.07, 0.5, a=0.001, d=0.1, s=0.0, r=0.08, fc=900, fenv=3.0, fdecay=0.06, Q=1.4)

    bn = []
    for b, (r, _) in bars(prog):
        for beat in range(4):
            for st in (1, 2, 3):
                bn.append((b + beat + st * 0.25, 0.2, r + 12, 0.85))
    bass = mono(bn, 'saw', unison=2, detune=0.06, fc=420, fenv=1.6, fdecay=0.06, Q=1.2, a=0.001, d=0.09, s=0.3,
                r=0.02, sub=0.7)

    drums = np.zeros((2, N))
    kick = kick_os(f0=160, f1=47, decay=0.33, drive=3.0)
    kb = four_floor(drums, kick, 1.0)
    place(drums, kick, END, 1.0)
    for b in np.arange(DROP + 1, END, 2):
        place(drums, clap_os(tone=1300), b, 0.5)
    hats(drums, closed=0.12, opened=0.22)
    ride = filt(hat_os(0.35, 0.7), 'bandpass', [5000, 14000])
    for b in np.arange(DROP, END, 1):
        place(drums, ride, b + 0.5, 0.08, pan=-0.3)
    build_fx(drums, tonal=nm('Eb3'), riser_gain=0.55)
    impacts(drums, 0.6)
    sc = sidechain(kb + [END], 0.8, 0.22)

    lead = norm(lead, 0.45) * sidechain(kb + [END], 0.3, 0.18)
    pad = norm(pad, 0.26) * sc
    pl = norm(pl, 0.24) * sc
    bass = norm(bass, 0.5) * sc
    sends = reverb(lead, 3.2) * 0.5 + pingpong(lead, 0.75, 0.4) * 0.25 + pingpong(pl, 0.75, 0.45) * 0.2
    return finish([norm(drums, 1.0), lead, pad, pl, bass, sends])


SAMPLES = [
    ('01_Neon_Rush_147bpm_Fmin', s01_neon_rush),
    ('02_Acid_Magnet_147bpm_Amin', s02_acid_magnet),
    ('03_Hyper_Pluck_147bpm_CSharpmin', s03_hyper_pluck),
    ('04_Reese_Thunder_147bpm_Emin', s04_reese_thunder),
    ('05_Laser_Chip_147bpm_Gmin', s05_laser_chip),
    ('06_Hard_Screech_147bpm_Bmin', s06_hard_screech),
    ('07_Festival_Stab_147bpm_Dmin', s07_festival_stab),
    ('08_Dark_Pulse_147bpm_FSharpmin', s08_dark_pulse),
    ('09_Vox_Chop_147bpm_Bbmin', s09_vox_chop),
    ('10_Euphoria_147bpm_Ebmin', s10_euphoria),
]


def main():
    out_dir = sys.argv[1] if len(sys.argv) > 1 else 'samples'
    only = sys.argv[2:] if len(sys.argv) > 2 else None
    os.makedirs(out_dir, exist_ok=True)
    for name, fn in SAMPLES:
        if only and not any(o in name for o in only):
            continue
        mix = fn()
        assert mix.shape == (2, N)
        path = os.path.join(out_dir, name + '.f32.wav')
        wavfile.write(path, SR, mix.T.astype(np.float32))
        print(f'{name}: peak {20*np.log10(peak(mix)):.2f} dBFS, rms {20*np.log10(rms(mix)):.2f} dBFS, '
              f'{mix.shape[1]/SR:.2f}s')


if __name__ == '__main__':
    main()
