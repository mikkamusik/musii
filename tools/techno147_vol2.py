#!/usr/bin/env python3
"""
techno147_vol2 - 5 weitere Underground-Techno-Loops (15 s, 147 BPM).

Stile: Schranz, EBM, Ritual/Tribal, Rolling Minimal, Distorted Reese.
Nutzt die Bausteine aus techno147.py / synth147.py.

Aufruf:  python3 tools/techno147_vol2.py [ausgabe_ordner] [namensfilter...]
"""
import os
import sys

import numpy as np
from scipy.io import wavfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from synth147 import (SR, N, b2s, mtof, nm, rms, norm, sat, stereo, place, filt,  # noqa: E402
                      tvf, poly, mono, kick_os, clap_os, snare_os, hat_os, sidechain, reverb, pingpong, vox)
from techno147 import (END, LAYER, hard_kick, rumble, crush, fm_hit, tom, rim, shaker, ride,  # noqa: E402
                       every, groove_hats, open_intro, master_t, kick_bus)

rng = np.random.default_rng(2611)


def t11_schranz_machine():
    """Schranz: brutale Kick, verzerrter Tom-Loop im 16tel-Raster, metallisches Gerassel."""
    kick = hard_kick(f0=260, f1=48, decay=0.24, drive=8.0)
    drums, kb = kick_bus(kick)
    rum = rumble(kick, kb, 0.8, 130, 4.0)
    groove_hats(drums, closed=0.12, opened=0.2, ohat_decay=0.09)
    loop = np.zeros((2, N))
    pat = [0, 1, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 1]
    pitch = [0, 180, 150, 0, 210, 150, 0, 180, 0, 150, 240, 0, 180, 0, 150, 120]
    for b in np.arange(0, END, 4):
        for i, p in enumerate(pat):
            if p:
                t = tom(pitch[i], 0.07, 1.2, 0.25) + 0.3 * rng.standard_normal(int(0.25 * SR)) * np.exp(
                    -np.arange(int(0.25 * SR)) / SR / 0.02)
                place(loop, t, b + i * 0.25, 0.9, pan=0.35 if i % 2 else -0.35)
    loop = filt(sat(loop, 7.0), 'bandpass', [180, 6000])
    loop = open_intro(norm(loop, 0.45), f0=250) * sidechain(kb, 0.5, 0.12)
    for b in every(LAYER, END, 0.25):
        place(drums, crush(hat_os(0.02), 5, 3), b, 0.12, pan=0.4)
    for b in every(1, END, 2):
        place(drums, clap_os(tone=1500), b, 0.3)
    sends = reverb(loop, 1.0, hp=500) * 0.2
    return master_t([norm(drums, 1.0), norm(rum, 0.28), loop, sends], drive=1.9)


def t12_ebm_body():
    """EBM-Techno: treibende 16tel-Sequenzerbass-Linie, Metall-Snare, kalt und koerperlich."""
    kick = hard_kick(f0=210, decay=0.26, drive=5.0)
    drums, kb = kick_bus(kick)
    groove_hats(drums, closed=0.1, opened=0.16)
    sn = sat(snare_os(tone=170, snap=2800), 3.0) + 0.5 * norm(fm_hit(420, 1.41, 6, 0.08)[:int(0.35 * SR)])
    for b in every(1, END, 2):
        place(drums, norm(sn), b, 0.5)
    for b in every(LAYER, END, 0.5, 0.5):
        place(drums, ride(), b, 0.07)
    seq = ['E2', 'E2', 'E3', 'E2', 'G2', 'E2', 'D3', 'E2', 'E2', 'B2', 'E2', 'E3', 'G2', 'E2', 'F2', 'E2']
    bn = []
    for bi, b in enumerate(np.arange(0, END, 4)):
        tr = -2 if bi % 4 == 3 else 0
        for i, n in enumerate(seq):
            bn.append((b + i * 0.25, 0.19, nm(n) + tr, 1.0 if i % 4 == 0 else 0.8))
    bass = mono(bn, 'sawsq', unison=2, detune=0.07, spread=0.5, fc=500, fenv=2.2, fdecay=0.05, Q=2.2, a=0.001,
                d=0.08, s=0.35, r=0.02, drive=3.0, sub=0.6)
    bass = open_intro(norm(bass, 0.5)) * sidechain(kb, 0.55, 0.12)
    sends = pingpong(bass, 0.75, 0.25, lp=2500) * 0.12 + reverb(drums * 0.3, 1.2, hp=700) * 0.2
    return master_t([norm(drums, 1.0), bass, sends])


def t13_ritual():
    """Ritual/Tribal: Tom-Polyrhythmik, tiefer Drone, gepitchte Formant-'Chants'."""
    kick = kick_os(f0=170, f1=44, decay=0.25, drive=4.0, length=0.35)
    drums, kb = kick_bus(kick)
    rum = rumble(kick, kb, 1.5, 110, 3.0)
    for b in every(0, END, 1.0, 0.5):
        place(drums, hat_os(0.09, 0.4), b, 0.2)
    for i, b in enumerate(np.arange(0, END, 0.75)):
        place(drums, tom(95 if i % 3 else 140, 0.22, 0.5), b, 0.45, pan=-0.3)
    for b in np.arange(0, END, 4):
        for o in (0.5, 1.25, 2.75, 3.5):
            place(drums, tom(220, 0.08, 0.3), b + o, 0.28, pan=0.4)
    for b in every(LAYER, END, 0.25):
        place(drums, shaker(), b, 0.07, pan=0.3)
    chant = [(0, 0.5, 'D3'), (0.75, 0.5, 'D3'), (1.5, 1.0, 'F3'), (3, 0.5, 'Eb3'),
             (4, 0.5, 'D3'), (4.75, 0.5, 'D3'), (5.5, 1.0, 'C3'), (7, 0.75, 'D3')]
    cn = []
    for b in np.arange(0, END, 8):
        cn += [(b + o, d, nm(n), 0.9) for o, d, n in chant]
    ch = vox(cn, ['o', 'u', 'a', 'o', 'o', 'u', 'a', 'u'])
    ch = open_intro(norm(ch, 0.35), f0=200, f1=8000)
    dr = poly([(0, END, nm('D1'), 1.0), (0, END, nm('A1'), 0.6), (0, END, nm('D2'), 0.5)], 'saw', 3, 0.1, 0.9,
              a=1.5, d=10, s=1, r=0.1, fc=5000)
    dr = tvf(dr, 120 * 2 ** (1.8 * (0.5 + 0.5 * np.sin(2 * np.pi * np.arange(N) / b2s(10)))), 2.5)
    dr = norm(dr, 0.25) * sidechain(kb, 0.8, 0.25)
    sends = reverb(ch, 2.8, lp=4000) * 0.5 + pingpong(ch, 0.75, 0.4, lp=2500) * 0.25 + reverb(drums * 0.3, 1.5, hp=500) * 0.25
    return master_t([norm(drums, 1.0), norm(rum, 0.28), ch, dr, sends])


def t14_night_shift():
    """Rolling Minimal: geswingte Hats, resonanter Rolling-Bass, Formant-'Hey'-Blips."""
    kick = kick_os(f0=175, f1=46, decay=0.24, drive=3.5, length=0.34)
    drums, kb = kick_bus(kick)
    ch = hat_os(0.02)
    for i, b in enumerate(np.arange(0, END, 0.25)):
        sw = 0.045 if i % 2 else 0.0
        if i % 4 == 2:
            place(drums, hat_os(0.11, 0.4), b, 0.3)
        else:
            place(drums, ch, b + sw, (0.22 if i % 2 else 0.12) * (1 - 0.3 * rng.random()), pan=0.25)
    for b in np.arange(0, END, 4):
        for o in (0.75, 2.5, 3.75):
            place(drums, rim(), b + o, 0.22, pan=-0.35)
    for b in every(LAYER - 4, END, 2, 1):
        place(drums, clap_os(tone=1250), b, 0.32)
    rp = [1, 0, 1, 1]
    bn = []
    for bi, b in enumerate(np.arange(0, END, 1)):
        for s_, on in enumerate(rp):
            if on and s_:
                bn.append((b + s_ * 0.25, 0.17, nm('A1') + (3 if (bi % 8 == 7 and s_ == 3) else 0), 0.9))
    lfo = 0.5 + 0.5 * np.sin(2 * np.pi * np.arange(N) / b2s(4))
    bass = mono(bn, 'saw', fc=170 * 2 ** (1.4 * lfo), fenv=2.0, fdecay=0.04, Q=5.0, a=0.001, d=0.07, s=0.3, r=0.02,
                sub=0.9, drive=2.0)
    bass = norm(bass, 0.5) * sidechain(kb, 0.9, 0.2)
    hey = [(b + o, 0.12, nm('A3') + (7 if o == 2.75 else 0), 0.9) for b in np.arange(LAYER - 12, END, 4)
           for o in (1.75, 2.75)]
    hv = norm(vox(hey, ['e', 'a']), 0.25)
    sends = pingpong(hv, 0.75, 0.55, lp=3000) * 0.45 + reverb(hv, 2.0) * 0.35 + reverb(drums * 0.25, 1.2, hp=800) * 0.2
    return master_t([norm(drums, 1.0), bass, hv, sends])


def t15_iron_lung():
    """Distorted Reese: atmender, verzerrter Reese-Puls, Spannung steigt ueber 15 s."""
    kick = hard_kick(f0=230, decay=0.25, drive=6.0)
    drums, kb = kick_bus(kick)
    groove_hats(drums, closed=0.11, opened=0.2, ohat_decay=0.12)
    for b in every(1, END, 2):
        place(drums, clap_os(tone=1100), b, 0.32)
    for b in every(LAYER, END, 0.5, 0.5):
        place(drums, ride(), b, 0.07, pan=0.3)
    notes = []
    for bi, b in enumerate(np.arange(0, END, 4)):
        r = nm('B1') + (1 if bi % 4 == 3 else 0)
        for o in (0.5, 1.5, 2.5, 3.25, 3.5):
            notes.append((b + o, 0.35 if o != 3.25 else 0.18, r + (12 if o == 3.5 else 0), 1.0))
    tt = np.arange(N) / N
    lfo = 0.5 + 0.5 * np.sin(2 * np.pi * np.arange(N) / (b2s(1) * 1.5))
    reese = mono(notes, 'saw', unison=4, detune=0.25, spread=0.8, fc=(120 + 900 * tt) * 2 ** (1.5 * lfo), fenv=1.2,
                 fdecay=0.08, Q=3.0, a=0.002, d=0.2, s=0.7, r=0.04, drive=5.0, sub=0.7)
    reese = filt(reese, 'lowpass', 5000)
    reese = open_intro(norm(reese, 0.5)) * sidechain(kb, 0.8, 0.16)
    tens = poly([(0, END, nm('F#4'), 0.6), (0, END, nm('C5'), 0.5)], 'saw', 3, 0.15, 0.9, a=8, d=10, s=1, r=0.1,
                fc=1500)
    tens = norm(tens, 0.12) * (tt ** 1.5)[None, :] * sidechain(kb, 0.7, 0.2)
    sends = reverb(reese, 1.2, hp=400) * 0.15 + reverb(tens, 3.0) * 0.5
    return master_t([norm(drums, 1.0), reese, tens, sends], drive=1.8)


LOOPS = [
    ('11_Schranz_Machine_147bpm_F', t11_schranz_machine),
    ('12_EBM_Body_147bpm_Emin', t12_ebm_body),
    ('13_Ritual_147bpm_D', t13_ritual),
    ('14_Night_Shift_147bpm_Amin', t14_night_shift),
    ('15_Iron_Lung_147bpm_B', t15_iron_lung),
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
        print(f'{name}: rms {20*np.log10(rms(mix)):.1f} dBFS, low-corr {np.corrcoef(lo)[0,1]:.2f}')


if __name__ == '__main__':
    main()
