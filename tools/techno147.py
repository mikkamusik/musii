#!/usr/bin/env python3
"""
techno147 - 10 Underground-Techno-Loops a 15 Sekunden, 147 BPM.

Dunkel, roh, hypnotisch: Rumble-Kicks, Acid, Dub-Chords, Industrial-Noise,
Polymeter-Sequenzen, metallische FM-Percussion. Keine Supersaws,
keine Euphorie-Melodien, keine Snare-Rolls/Riser.

Aufbau: Takt 1 = Groove mit gefiltertem Hauptelement (oeffnet sich),
danach durchgehender Groove, ab Takt 6 zusaetzliche Ebene (Ride/Perc).

Aufruf:  python3 tools/techno147.py [ausgabe_ordner] [namensfilter...]
"""
import os
import sys

import numpy as np
from scipy.io import wavfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from synth147 import (SR, N, b2s, mtof, nm, peak, rms, norm, sat, stereo, place, filt,  # noqa: E402
                      osc, tvf, poly, mono, kick_os, clap_os, snare_os, hat_os, sidechain,
                      reverb, pingpong)

rng = np.random.default_rng(4711)
END = 37          # Groove laeuft bis zum Ende (15 s = 36,75 Beats)
INTRO = 4         # Takt 1: Hauptelement oeffnet sich per Filter
LAYER = 20        # ab Takt 6 kommt eine Ebene dazu


# ------------------------------------------------------------ Bausteine
def hard_kick(f0=230, f1=46, decay=0.26, drive=6.0):
    return kick_os(f0=f0, f1=f1, pdecay=0.028, decay=decay * 0.7, drive=drive, click=0.9, length=0.3)


def rumble(kick, kb, decay=1.1, lp=130, drive=3.0, depth=0.95):
    """Klassischer Warehouse-Rumble: Kick -> Hall -> Tiefpass -> Verzerrung -> geduckt."""
    buf = np.zeros((2, N))
    for b in kb:
        place(buf, kick, b, 1.0)
    wet = reverb(buf, decay, lp=500, hp=30, predelay=0.005).mean(axis=0)
    wet = filt(wet, 'lowpass', lp, 4)
    wet = filt(sat(wet, drive), 'lowpass', lp * 1.3, 4)
    wet *= sidechain(kb, 1.0, BEATS(0.6))
    return stereo(wet)


def BEATS(b):
    return b * 60.0 / 147


def crush(x, bits=6, down=3):
    y = np.round(x * 2 ** bits) / 2 ** bits
    idx = (np.arange(y.shape[-1]) // down) * down
    return y[..., idx]


def fm_hit(f, ratio=1.41, index=6.0, decay=0.14, idecay=0.04, length=0.6):
    L = int(length * SR)
    t = np.arange(L) / SR
    mod = np.sin(2 * np.pi * f * ratio * t) * index * np.exp(-t / idecay)
    return np.sin(2 * np.pi * f * t + mod) * np.exp(-t / decay)


def tom(f, decay=0.18, bend=0.7, length=0.5):
    L = int(length * SR)
    t = np.arange(L) / SR
    ff = f * (1 + bend * np.exp(-t / 0.015))
    return np.sin(2 * np.pi * np.cumsum(ff) / SR) * np.exp(-t / decay)


def rim():
    L = int(0.12 * SR)
    t = np.arange(L) / SR
    y = (np.sin(2 * np.pi * 1700 * t) + 0.6 * np.sin(2 * np.pi * 820 * t)) * np.exp(-t / 0.018)
    y += filt(rng.standard_normal(L), 'bandpass', [2000, 8000]) * np.exp(-t / 0.004)
    return norm(y)


def shaker():
    L = int(0.12 * SR)
    t = np.arange(L) / SR
    env = np.clip(t / 0.008, 0, 1) * np.exp(-t / 0.035)
    return norm(filt(rng.standard_normal(L), 'bandpass', [5500, 13000], 4) * env)


def ride():
    return norm(filt(hat_os(0.45, 0.9), 'bandpass', [4500, 14000]))


def every(start, end, step, offset=0.0):
    return list(np.arange(start + offset, end, step))


def groove_hats(mix, start=0, end=END, closed=0.12, opened=0.2, ohat_decay=0.14, hum=0.25):
    closed, opened = closed * 1.7, opened * 1.5
    ch = hat_os(0.022)
    oh = hat_os(ohat_decay, 0.5)
    for i, b in enumerate(np.arange(start, end, 0.25)):
        v = 1 - hum * rng.random()
        if i % 4 == 2:
            if opened:
                place(mix, oh, b, opened * v, pan=0.1)
        elif closed:
            place(mix, ch, b, closed * (0.9 if i % 2 else 0.5) * v, pan=0.2 if i % 2 else -0.2)


def open_intro(x, beats=INTRO, f0=180, f1=14000, mode='lp'):
    """Hauptelement oeffnet sich im ersten Takt (statt Riser)."""
    x = x.copy()
    L = b2s(beats)
    cut = f0 * (f1 / f0) ** (np.linspace(0, 1, L) ** 1.5)
    x[:, :L] = tvf(x[:, :L], cut, 1.2, mode)
    return x


def master_t(stems, drive=1.6, ceiling=0.966):
    mix = sum(stems)
    mix = filt(mix, 'highpass', 30)
    mix = mix / np.percentile(np.abs(mix), 99.95)
    mix = np.tanh(drive * mix * 0.55) / np.tanh(drive * 0.55)
    mix = mix / peak(mix) * ceiling
    fi, fo = int(0.002 * SR), int(0.06 * SR)
    mix[:, :fi] *= np.linspace(0, 1, fi)
    mix[:, -fo:] *= np.linspace(1, 0, fo)
    return mix


def kick_bus(kick, start=0, end=END, gain=1.0):
    d = np.zeros((2, N))
    kb = every(start, end, 1.0)
    for b in kb:
        place(d, kick, b, gain)
    return d, kb


# =========================================================== 10 LOOPS

def t01_warehouse_rumble():
    """F: Hard-Techno-Kick + Rumble, verzerrter One-Note-Stab im 3/16-Raster."""
    kick = hard_kick()
    drums, kb = kick_bus(kick)
    rum = rumble(kick, kb, 1.2, 120, 3.5)
    groove_hats(drums, closed=0.13, opened=0.22)
    for b in every(1, END, 2):
        place(drums, clap_os(tone=1100), b, 0.35)
    for b in every(LAYER, END, 0.5, 0.5):
        place(drums, ride(), b, 0.08, pan=0.35)
    st = []
    for i, b in enumerate(np.arange(0, END, 0.75)):
        st.append((b, 0.14, nm('F3') + (1 if i % 8 == 7 else 0), 1.0 if i % 4 == 0 else 0.75))
    stab = poly(st, 'sawsq', 2, 0.08, 0.4, a=0.001, d=0.07, s=0.0, r=0.05, fc=500, fenv=2.4, fdecay=0.04, Q=4.0)
    stab = sat(stab, 3.5)
    stab = open_intro(norm(stab, 0.4)) * sidechain(kb, 0.6, 0.15)
    sends = pingpong(stab, 0.75, 0.55, lp=2500) * 0.35 + reverb(drums * 0.3, 1.6, hp=600) * 0.25
    return master_t([norm(drums, 1.0), norm(rum, 0.28), stab, sends])


def t02_concrete_acid():
    """G-Phrygisch: tiefe, verzerrte 303 mit Slides, Filter kriecht langsam auf."""
    kick = hard_kick(f0=200, decay=0.3, drive=4.5)
    drums, kb = kick_bus(kick)
    rum = rumble(kick, kb, 1.0, 110, 3.0)
    groove_hats(drums, closed=0.1, opened=0.18)
    for b in every(1, END, 2):
        place(drums, clap_os(tone=1000), b, 0.3)
    for b in every(LAYER, END, 0.25):
        place(drums, shaker(), b, 0.06 + 0.04 * ((b * 4) % 2), pan=-0.3)
    pat = [('G2', 0, 1), ('G2', 0, 0), None, ('G3', 1, 1), ('G2', 0, 0), ('Ab2', 0, 1), None, ('G2', 0, 0),
           ('Bb2', 0, 1), None, ('G2', 0, 0), ('F2', 1, 0), ('G2', 0, 1), None, ('Db3', 0, 1), ('G2', 1, 0)]
    notes = []
    for b in np.arange(0, END, 4):
        for i, p in enumerate(pat):
            if p:
                notes.append((b + i * 0.25, 0.3 if p[1] else 0.2, nm(p[0]), 0.8 + 0.2 * p[2], bool(p[1]), 0.7 * p[2]))
    tt = np.arange(N) / N
    lfo = np.sin(2 * np.pi * np.arange(N) / b2s(6))
    cut = 140 * (7.0 ** tt) * 2 ** (0.5 * lfo)
    acid = mono(notes, 'saw', fc=cut, fenv=2.8, fdecay=0.1, Q=12.0, glide=0.03, a=0.002, d=0.12, s=0.5, r=0.03,
                drive=4.5)
    acid = filt(acid, 'highpass', 45)
    acid = norm(acid, 0.55) * sidechain(kb, 0.4, 0.14)
    sends = pingpong(acid, 0.75, 0.35, lp=3000) * 0.18 + reverb(acid, 1.2) * 0.12
    return master_t([norm(drums, 1.0), norm(rum, 0.28), acid, sends])


def t03_dub_chamber():
    """C-Moll: Dub-Techno-Chord in endlosen Delays, tiefe Kick, Shaker-Teppich."""
    kick = kick_os(f0=130, f1=44, decay=0.3, drive=2.5, click=0.3, length=0.37)
    drums, kb = kick_bus(kick)
    rum = rumble(kick, kb, 1.6, 100, 2.0, 0.9)
    for i, b in enumerate(np.arange(0, END, 0.25)):
        place(drums, shaker(), b, 0.1 if i % 2 else 0.06, pan=0.3)
    for b in every(0, END, 1.0, 0.5):
        place(drums, hat_os(0.08, 0.4), b, 0.13)
    for b in every(LAYER, END, 4):
        for o in (0.75, 2.25, 3.5):
            place(drums, rim(), b + o, 0.18, pan=-0.4)
    chord = [nm('C3'), nm('Eb3'), nm('G3'), nm('Bb3'), nm('D4')]
    cn = []
    for bi, b in enumerate(np.arange(0, END, 4)):
        for o in ((0.75, 2.5) if bi % 2 == 0 else (0.75, 1.75, 3.25)):
            cn += [(b + o, 0.3, m, 0.9) for m in chord]
    ch = poly(cn, 'saw', 3, 0.1, 0.7, a=0.003, d=0.2, s=0.2, r=0.2, fc=600, fenv=1.0, fdecay=0.1, Q=1.6)
    lfo = 0.5 + 0.5 * np.sin(2 * np.pi * np.arange(N) / b2s(8) - np.pi / 2)
    ch = tvf(ch, 350 * 2 ** (2.6 * lfo), 1.4)
    ch = open_intro(norm(ch, 0.4), f0=150, f1=6000)
    dub = pingpong(ch, 0.75, 0.72, taps=14, lp=1800, hp=250) * 0.7 + reverb(ch, 3.5, lp=3000) * 0.55
    subn = [(b + 0.5, 0.4, nm('C2'), 1.0) for b in np.arange(0, END, 1)]
    sub = mono(subn, 'sine', fc=1500, fenv=0, a=0.003, d=0.2, s=0.6, r=0.05)
    sub = norm(sat(sub, 1.5), 0.35) * sidechain(kb, 0.8, 0.2)
    return master_t([norm(drums, 1.0), norm(rum, 0.28), ch * 0.8, dub, sub])


def t04_industrial_grind():
    """D: Verzerrt, bitgecrusht, metallisch. Maschinen-Noise und Clang-Percussion."""
    kick = crush(hard_kick(f0=260, decay=0.24, drive=9.0), 8, 2)
    drums, kb = kick_bus(kick)
    rum = rumble(kick_os(f0=200, decay=0.3), kb, 0.9, 140, 5.0)
    clang = norm(fm_hit(310, ratio=1.41, index=8, decay=0.12) + 0.6 * fm_hit(733, ratio=2.76, index=5, decay=0.08))
    pat = [0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1]
    for b in np.arange(0, END, 4):
        for i, p in enumerate(pat):
            if p:
                place(drums, crush(clang, 5, 4), b + i * 0.25, 0.3, pan=0.5 if i % 2 else -0.5)
    noise = rng.standard_normal(int(0.2 * SR))
    burst = filt(noise, 'bandpass', [800, 5000]) * np.exp(-np.arange(len(noise)) / SR / 0.05)
    for b in every(0, END, 1.0, 0.5):
        place(drums, crush(norm(burst), 4, 6), b, 0.28)
    for b in every(1, END, 2):
        place(drums, sat(snare_os(tone=160, snap=2500), 4), b, 0.4)
    for b in every(LAYER, END, 0.25):
        place(drums, hat_os(0.015), b, 0.1, pan=0.3)
    gpat = [1, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0]
    bn = [(b + i * 0.25, 0.18, nm('D2') + (1 if i == 14 else 0), 1.0)
          for b in np.arange(0, END, 4) for i, g in enumerate(gpat) if g and i % 4]
    bass = mono(bn, 'saw', unison=2, detune=0.15, fc=300, fenv=2.0, fdecay=0.04, Q=3, a=0.001, d=0.08, s=0.3, r=0.02,
                drive=6.0)
    bass = open_intro(norm(crush(bass, 7, 3), 0.5)) * sidechain(kb, 0.8, 0.16)
    sends = reverb(drums * 0.4, 1.0, hp=800) * 0.3
    return master_t([norm(drums, 1.0), norm(rum, 0.28), bass, sends], drive=2.0)


def t05_hypnotic_loop():
    """A-Phrygisch: 5er- gegen 3er-Sequenz gegen 4/4 - hypnotisch, minimal."""
    kick = kick_os(f0=170, f1=46, decay=0.24, drive=3.5, length=0.34)
    drums, kb = kick_bus(kick)
    rum = rumble(kick, kb, 1.1, 120, 2.5)
    groove_hats(drums, closed=0.09, opened=0.17)
    for b in np.arange(0, END, 4):
        for o in (0.75, 1.5, 3.25):
            place(drums, rim(), b + o, 0.2, pan=0.4)
    for b in every(LAYER - 4, END, 8, 3):
        place(drums, clap_os(tone=1200), b, 0.3)
    s5 = ['A3', 'C4', 'A3', 'Bb3', 'E4']
    s3 = ['A4', 'E5', 'G4']
    n5 = [(b, 0.15, nm(s5[i % 5]), 0.9) for i, b in enumerate(np.arange(0, END, 0.25))]
    n3 = [(b, 0.25, nm(s3[i % 3]), 0.8) for i, b in enumerate(np.arange(LAYER - 8, END, 0.75))]
    lfo = 0.5 + 0.5 * np.sin(2 * np.pi * np.arange(N) / b2s(7))
    a = poly(n5, 'square', 1, a=0.001, d=0.08, s=0.0, r=0.05, fc=500, fenv=2.6, fdecay=0.05, Q=2.5, pw=0.3)
    a = tvf(a, 600 * 2 ** (2.5 * lfo), 0.9)
    a = open_intro(norm(a, 0.35)) * sidechain(kb, 0.5, 0.15)
    bseq = poly(n3, 'sine', 1, a=0.001, d=0.15, s=0.0, r=0.2) if n3 else np.zeros((2, N))
    bseq = norm(bseq + 0.3 * poly(n3, 'saw', 1, a=0.001, d=0.06, s=0, r=0.05, fc=2500), 0.18)
    bn = [(b + 0.5, 0.2, nm('A1'), 1.0) for b in np.arange(0, END, 1)]
    bass = mono(bn, 'saw', fc=200, fenv=1.6, fdecay=0.05, Q=1.5, a=0.002, d=0.08, s=0.3, r=0.02, sub=0.8)
    bass = norm(bass, 0.4) * sidechain(kb, 0.8, 0.18)
    sends = pingpong(a, 0.75, 0.45) * 0.3 + pingpong(bseq, 0.5, 0.5) * 0.4 + reverb(a + bseq, 2.2) * 0.25
    return master_t([norm(drums, 1.0), norm(rum, 0.28), a, bseq, bass, sends])


def t06_mentasm_pressure():
    """E: Dunkler 90s-Rave-Stab (Pulse-Stack mit Pitch-Dive), roh und druckvoll."""
    kick = hard_kick(f0=220, decay=0.28, drive=5.0)
    drums, kb = kick_bus(kick)
    rum = rumble(kick, kb, 1.0, 120, 3.0)
    groove_hats(drums, closed=0.12, opened=0.2, ohat_decay=0.1)
    for b in every(1, END, 2):
        place(drums, clap_os(tone=1300), b, 0.35)
    for b in every(LAYER, END, 0.5, 0.5):
        place(drums, ride(), b, 0.07)
    riff = [(0, 0.6, 'E3'), (0.75, 0.4, 'E3'), (1.5, 0.9, 'G3'), (2.75, 0.4, 'E3'), (3.5, 0.4, 'F3'),
            (4, 0.6, 'E3'), (4.75, 0.4, 'E3'), (5.5, 0.9, 'D3'), (6.75, 1.0, 'E3')]
    st = []
    for b in np.arange(0, END, 8):
        for o, d, n in riff:
            for iv in (0, 7, 12):
                st.append((b + o, d, nm(n) + iv, 0.8))
    stab = poly(st, 'square', 5, 0.35, 0.8, a=0.002, d=0.3, s=0.7, r=0.08, fc=1800, pitch_env=-4,
                pitch_decay=0.12, pw=0.3)
    stab = sat(stab, 3.0)
    stab = open_intro(norm(stab, 0.38), f0=250) * sidechain(kb, 0.55, 0.16)
    sends = reverb(stab, 1.8, lp=4000) * 0.3 + pingpong(stab, 0.75, 0.35, lp=2500) * 0.15
    return master_t([norm(drums, 1.0), norm(rum, 0.28), stab, sends])


def t07_peak_drive():
    """F#-Moll: Berlin-Peaktime. Rollender Bass, FM-Bleep-Sequenz, Tom-Groove."""
    kick = hard_kick(f0=200, decay=0.27, drive=4.0)
    drums, kb = kick_bus(kick)
    groove_hats(drums, closed=0.12, opened=0.2)
    for b in every(1, END, 2):
        place(drums, clap_os(tone=1250), b, 0.3)
    for b in np.arange(0, END, 4):
        for o, f in ((1.75, 130), (2.5, 105), (3.75, 90)):
            place(drums, tom(f, 0.2), b + o, 0.35, pan=0.3)
    for b in every(LAYER, END, 0.5, 0.5):
        place(drums, ride(), b, 0.07, pan=-0.3)
    bn = []
    for b in np.arange(0, END, 1):
        for s_ in (1, 2, 3):
            bn.append((b + s_ * 0.25, 0.18, nm('F#2') + (1 if (b % 8 == 7 and s_ == 3) else 0), 0.75 + 0.2 * (s_ == 2)))
    bass = mono(bn, 'saw', fc=220, fenv=2.2, fdecay=0.04, Q=2.0, a=0.001, d=0.07, s=0.25, r=0.02, sub=0.9, drive=2.5)
    bass = norm(bass, 0.5) * sidechain(kb, 0.9, 0.2)
    seqp = ['F#4', None, 'A4', 'F#4', None, 'G4', None, 'C#5', 'F#4', None, None, 'A4', None, 'F#4', 'G4', None]
    bl = np.zeros((2, N))
    for b in np.arange(0, END, 4):
        for i, n in enumerate(seqp):
            if n:
                place(bl, fm_hit(float(mtof(nm(n))), ratio=2.0, index=3.0, decay=0.09, idecay=0.03), b + i * 0.25,
                      0.8, pan=0.3 * np.sin(i))
    bl = open_intro(norm(bl, 0.3)) * sidechain(kb, 0.4, 0.14)
    sends = pingpong(bl, 0.75, 0.5) * 0.35 + reverb(bl, 1.8) * 0.3 + reverb(drums * 0.3, 1.2, hp=700) * 0.2
    return master_t([norm(drums, 1.0), bass, bl, sends])


def t08_tunnel_vision():
    """B: Dunkler Drone, modulare FM-Perc-Sequenz, Noise-Sweeps - Tunnel-Atmosphaere."""
    kick = kick_os(f0=180, f1=45, decay=0.25, drive=4.0, length=0.35)
    drums, kb = kick_bus(kick)
    rum = rumble(kick, kb, 1.4, 110, 3.0)
    for b in every(0, END, 1.0, 0.5):
        place(drums, hat_os(0.1, 0.4), b, 0.18)
    for i, b in enumerate(np.arange(0, END, 0.25)):
        if i % 4 != 2:
            place(drums, hat_os(0.015), b + (0.03 if i % 2 else 0), 0.08, pan=0.25)
    prng = np.random.default_rng(8)
    steps = [(i, prng.choice([200, 300, 450, 600, 900]), prng.random()) for i in range(16) if prng.random() < 0.55]
    perc = np.zeros((2, N))
    for b in np.arange(0, END, 4):
        for i, f, r in steps:
            place(perc, fm_hit(f, ratio=1.0 + r * 2.5, index=2 + 5 * r, decay=0.05 + 0.1 * r, idecay=0.02),
                  b + i * 0.25, 0.7, pan=r * 1.4 - 0.7)
    perc = open_intro(norm(perc, 0.32)) * sidechain(kb, 0.4, 0.14)
    dn = [(0, END, m, 0.8) for m in (nm('B1'), nm('F#2'), nm('B2'))]
    drone = poly(dn, 'saw', 3, 0.12, 0.9, a=1.0, d=10, s=1, r=0.1, fc=5000)
    lfo = 0.5 + 0.5 * np.sin(2 * np.pi * np.arange(N) / b2s(12))
    drone = tvf(drone, 150 * 2 ** (2.2 * lfo), 3.0)
    drone = norm(drone, 0.3) * sidechain(kb, 0.75, 0.25)
    nz = rng.standard_normal((2, N))
    sweep = tvf(nz, 800 * 2 ** (3 * (0.5 + 0.5 * np.sin(2 * np.pi * np.arange(N) / b2s(16)))), 4.0, 'bp', 64)
    sweep = norm(sweep, 0.08) * sidechain(kb, 0.6, 0.2)
    sends = pingpong(perc, 0.75, 0.55) * 0.35 + reverb(perc, 2.8) * 0.35
    return master_t([norm(drums, 1.0), norm(rum, 0.28), perc, drone, sweep, sends])


def t09_bunker_bells():
    """C#: Inharmonische, dunkle Bunker-Glocken (Tritonus), Rumble, trockene Hats."""
    kick = hard_kick(f0=210, decay=0.29, drive=4.5)
    drums, kb = kick_bus(kick)
    rum = rumble(kick, kb, 1.3, 115, 3.0)
    groove_hats(drums, closed=0.11, opened=0.18)
    for b in every(1, END, 2):
        place(drums, clap_os(tone=1150), b, 0.28)
    for b in every(LAYER, END, 0.25):
        place(drums, shaker(), b, 0.05, pan=-0.35)
    riff = [(0, 'C#4'), (0.75, 'C#4'), (1.5, 'D4'), (2.5, 'G4'), (3.25, 'C#4')]
    riff2 = [(0, 'C#4'), (0.75, 'C#4'), (1.5, 'D4'), (2.5, 'G#3'), (3.25, 'F#3')]
    bells = np.zeros((2, N))
    for bi, b in enumerate(np.arange(0, END, 4)):
        for o, n in (riff if bi % 2 == 0 else riff2):
            f = float(mtof(nm(n)))
            h = fm_hit(f, ratio=1.41, index=4.0, decay=0.45, idecay=0.12, length=1.2)
            h += 0.4 * fm_hit(f * 2.76, ratio=1.0, index=1.0, decay=0.15, length=1.2)
            place(bells, h, b + o, 0.8)
    bells = open_intro(norm(bells, 0.35), f0=300)
    sub = mono([(b + 0.5, 0.35, nm('C#2'), 1.0) for b in np.arange(0, END, 1)], 'sine', fc=1000, fenv=0, a=0.003,
               d=0.2, s=0.5, r=0.04)
    sub = norm(sat(sub, 1.8), 0.32) * sidechain(kb, 0.8, 0.2)
    sends = reverb(bells, 3.0, lp=5000) * 0.45 + pingpong(bells, 0.75, 0.45, lp=3500) * 0.3
    return master_t([norm(drums, 1.0), norm(rum, 0.28), bells * sidechain(kb, 0.35, 0.12), sub, sends])


def t10_hard_groove():
    """G: Hard Groove - Conga/Tom-Loop, Shaker, gefilterter Moll-Chord-Loop, Bass-Stabs."""
    kick = hard_kick(f0=200, decay=0.27, drive=4.0)
    drums, kb = kick_bus(kick)
    rum = rumble(kick, kb, 0.9, 120, 2.5, 0.9)
    groove_hats(drums, closed=0.1, opened=0.22)
    for i, b in enumerate(np.arange(0, END, 0.25)):
        place(drums, shaker(), b, 0.09 if i % 2 else 0.05, pan=0.35)
    cpat = [(0.5, 330), (0.75, 250), (1.25, 330), (2.0, 200), (2.5, 330), (3.0, 250), (3.25, 250), (3.75, 200)]
    for b in np.arange(0, END, 4):
        for o, f in cpat:
            place(drums, tom(f, 0.09, 0.4), b + o, 0.32, pan=-0.4 if f > 300 else 0.3)
    for b in every(1, END, 2):
        place(drums, clap_os(tone=1250), b, 0.4)
        place(drums, snare_os(tone=200), b, 0.15)
    for b in every(LAYER, END, 0.5, 0.5):
        place(drums, ride(), b, 0.08)
    chord = [nm('G3'), nm('Bb3'), nm('D4'), nm('F4')]
    cn = [(b + o, 0.2, m, 0.9) for b in np.arange(0, END, 2) for o in (0.5, 1.25) for m in chord]
    ch = poly(cn, 'saw', 2, 0.08, 0.6, a=0.002, d=0.1, s=0.0, r=0.1, fc=700, fenv=1.6, fdecay=0.06, Q=2.0)
    lfo = 0.5 + 0.5 * np.sin(2 * np.pi * np.arange(N) / b2s(8))
    ch = open_intro(norm(tvf(ch, 500 * 2 ** (2.2 * lfo), 1.3), 0.32)) * sidechain(kb, 0.55, 0.15)
    bn = [(b + o, 0.2, nm('G1') + (3 if (b % 4 == 3 and o == 0.75) else 0), 1.0)
          for b in np.arange(0, END, 1) for o in (0.5, 0.75)]
    bass = mono(bn, 'square', fc=260, fenv=1.6, fdecay=0.05, Q=1.6, a=0.001, d=0.08, s=0.3, r=0.02, sub=0.9,
                drive=2.0)
    bass = norm(bass, 0.42) * sidechain(kb, 0.85, 0.18)
    sends = pingpong(ch, 0.75, 0.45) * 0.3 + reverb(ch, 1.8) * 0.25 + reverb(drums * 0.3, 1.0, hp=900) * 0.2
    return master_t([norm(drums, 1.0), norm(rum, 0.28), ch, bass, sends])


LOOPS = [
    ('01_Warehouse_Rumble_147bpm_F', t01_warehouse_rumble),
    ('02_Concrete_Acid_147bpm_G', t02_concrete_acid),
    ('03_Dub_Chamber_147bpm_Cmin', t03_dub_chamber),
    ('04_Industrial_Grind_147bpm_D', t04_industrial_grind),
    ('05_Hypnotic_Loop_147bpm_A', t05_hypnotic_loop),
    ('06_Mentasm_Pressure_147bpm_E', t06_mentasm_pressure),
    ('07_Peak_Drive_147bpm_FSharpmin', t07_peak_drive),
    ('08_Tunnel_Vision_147bpm_B', t08_tunnel_vision),
    ('09_Bunker_Bells_147bpm_CSharp', t09_bunker_bells),
    ('10_Hard_Groove_147bpm_Gmin', t10_hard_groove),
]


def main():
    out_dir = sys.argv[1] if len(sys.argv) > 1 else 'samples'
    only = sys.argv[2:]
    os.makedirs(out_dir, exist_ok=True)
    for name, fn in LOOPS:
        if only and not any(o in name for o in only):
            continue
        mix = fn()
        assert mix.shape == (2, N) and np.isfinite(mix).all()
        wavfile.write(os.path.join(out_dir, name + '.f32.wav'), SR, mix.T.astype(np.float32))
        lo = filt(mix, 'lowpass', 150)
        print(f'{name}: rms {20*np.log10(rms(mix)):.1f} dBFS, corr {np.corrcoef(mix)[0,1]:.2f}, '
              f'low-corr {np.corrcoef(lo)[0,1]:.2f}')


if __name__ == '__main__':
    main()
