"""Dramatisches Streichorchester mit Shorts (Spiccato/Marcato) – synthetisiert, ohne Samples.

Jede Gruppe besteht aus mehreren Spielern: leicht verstimmt (+-8 Cent), minimal versetzt
(0-14 ms), unterschiedlich laut, im Orchester-Setup im Stereofeld (1. Violinen links ...
Celli rechts). Ein Short = bandbegrenzter Saegezahn (gestrichene Saite) mit Bogen-Biss
(Rauschimpuls), kurzem Tonhoehen-Einschwingen und schnellem Abklingen; danach Korpus-
Resonanzen der jeweiligen Instrumentengroesse.
"""
import numpy as np

from dsp import SR, saw, pulse, bp, hp, lp

# Korpus-Resonanzen einer Violine (Hz, Gain, Resonanz); fuer Bratsche/Cello skaliert
BODY = [(280.0, 0.9, 0.8), (460.0, 0.75, 0.8), (1000.0, 0.5, 0.72), (2500.0, 0.95, 0.6), (3300.0, 0.5, 0.7)]

SECTIONS = {
    #        Spieler, Pan-Bereich,     Korpus, Hochpass, Tiefpass, Pegel
    "vln1": (6, (-0.7, -0.25), 1.0, 190.0, 8500.0, 1.0),
    "vln2": (6, (-0.35, 0.05), 1.0, 170.0, 8000.0, 0.72),
    "vla": (4, (0.05, 0.4), 0.78, 120.0, 6500.0, 0.7),
    "vc": (4, (0.3, 0.7), 0.5, 65.0, 5000.0, 0.9),
}


def mtof(m):
    return 440.0 * 2.0 ** ((m - 69.0) / 12.0)


def short_note(f0, dur, vel, rng, bite=1.0):
    n = int((dur + 0.3) * SR)
    t = np.arange(n) / SR
    f = f0 * 2.0 ** ((0.14 * np.exp(-t / 0.014)) / 12.0)          # Bogen-Einschwingen von oben
    osc = saw(f, rng.uniform()) + 0.12 * pulse(f, 0.3, rng.uniform())
    hold = dur * 0.55
    tau = max(dur * 0.8, 0.03)
    env = np.where(t < hold, np.exp(-t / tau), np.exp(-hold / tau) * np.exp(-(t - hold) / 0.03))
    env *= np.minimum(t / 0.004, 1.0) * vel
    burst = bp(rng.standard_normal(n) * np.exp(-t / 0.006), 2600.0, 0.35) * 0.9 * bite * vel
    return osc * env + burst


def section_bus(events, name, length, rng):
    """events: [(t_sec, midi, dur_sec, vel)] -> Stereo-Bus der Gruppe (mit Korpus)."""
    players, (p0, p1), bscale, hpf, lpf, gain = SECTIONS[name]
    bus = np.zeros((2, length))
    pans = np.linspace(p0, p1, players)
    for k in range(players):
        det = rng.normal(0, 0.05)                                 # Halbtoene (+-~8 Cent)
        late = rng.uniform(0.0, 0.014)
        g_l, g_r = np.sqrt(0.5 * (1 - pans[k])), np.sqrt(0.5 * (1 + pans[k]))
        for t0, m, dur, vel in events:
            x = short_note(mtof(m + det + rng.normal(0, 0.02)), dur * rng.uniform(0.9, 1.1),
                           vel * rng.uniform(0.85, 1.0), rng, bite=rng.uniform(0.7, 1.2))
            a = int((t0 + late + rng.uniform(0, 0.006)) * SR)
            if a >= length:
                continue
            b = min(length, a + len(x))
            bus[0, a:b] += g_l * x[: b - a]
            bus[1, a:b] += g_r * x[: b - a]
    out = []
    for c in bus:
        body = 0.45 * c
        for fc, g, r in BODY:
            body = body + g * bp(c, fc * bscale, r)
        out.append(lp(hp(body, hpf), lpf))
    return np.array(out) * gain / players


def phrase(chords, spb, style="full", seed=0, crescendo=True):
    """4-Takt-Phrase. chords: pro Takt dict mit 'v1' (hi, mid, lo), 'v2', 'va', 'vc' (MIDI)."""
    rng = np.random.default_rng(seed)
    s16 = spb / 4.0
    bars = len(chords)
    length = int((bars * 16 * s16 + 2.0) * SR)
    acc = {0, 3, 6, 8, 11, 14}                                    # 3-3-2-Akzente
    ev = {"vln1": [], "vln2": [], "vla": [], "vc": []}
    for bi, ch in enumerate(chords):
        dyn = (0.78 + 0.22 * bi / max(bars - 1, 1)) if crescendo else 1.0
        if style == "soft":
            dyn *= 0.6
        hi, mid, lo = ch["v1"]
        fig = [hi, mid, lo, mid]
        for st in range(16):
            t0 = (bi * 16 + st) * s16
            v = (1.0 if st in acc else 0.6) * dyn
            ev["vln1"].append((t0, fig[st % 4], 0.085, v))
            if st % 2 == 0:
                v2 = (1.0 if st in (0, 6, 12) else 0.65) * dyn
                ev["vln2"].append((t0, ch["v2"], 0.12, v2))
                ev["vla"].append((t0, ch["va"], 0.12, v2 * 0.95))
            if st in (0, 6, 12):                                  # Celli: Marcato DUM . . DUM . . DUM .
                ev["vc"].append((t0, ch["vc"], 0.26, 1.0 * dyn))
    # Tutti-Schlag auf der ersten Eins der Phrase
    c0 = chords[0]
    for name, m in (("vln1", c0["v1"][0]), ("vln2", c0["v2"]), ("vla", c0["va"]), ("vc", c0["vc"])):
        ev[name].append((0.0, m, 0.38, 1.25 if style != "soft" else 0.8))
    names = ["vln1"] if style == "teaser" else ["vln1", "vln2", "vla", "vc"]
    out = np.zeros((2, length))
    for name in names:
        out += section_bus(ev[name], name, length, rng)
    return out / (np.max(np.abs(out)) + 1e-9)
