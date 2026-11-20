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


# 2-Takt-Motiv (tanzbar, Ruf & Antwort) in 16teln: (Schritt, Laenge s, Akzent)
#   Takt A: DAMM . . DA . . DA . . . . . . . . .   (Tresillo, Luft danach)
#   Takt B: . . da . . . da . . . da . . . DA .    (Offbeats, Auftakt in den naechsten Takt)
MOTIF_A = [(0, 0.30, 1.0), (3, 0.16, 0.8), (6, 0.16, 0.85)]
MOTIF_B = [(2, 0.14, 0.6), (6, 0.14, 0.62), (10, 0.14, 0.66), (14, 0.18, 0.9)]


def phrase(chords, spb, style="full", seed=0, crescendo=True):
    """4-Takt-Phrase, tanzbar: Akkord-Stabs (Vl1-Oberstimme, Vl2, Va) im Tresillo-Motiv,
    Celli ein DUM auf jeder Eins, Tutti-Schlag auf der ersten Eins.
    chords: pro Takt dict mit 'v1' (hi, mid, lo), 'v2', 'va', 'vc' (MIDI)."""
    rng = np.random.default_rng(seed)
    s16 = spb / 4.0
    bars = len(chords)
    length = int((bars * 16 * s16 + 2.0) * SR)
    ev = {"vln1": [], "vln2": [], "vla": [], "vc": []}
    for bi, ch in enumerate(chords):
        dyn = (0.85 + 0.15 * bi / max(bars - 1, 1)) if crescendo else 1.0
        if style == "soft":
            dyn *= 0.55
        hi, mid, lo = ch["v1"]
        if style == "soft":                                    # Breakdown: nur ein langer Akkord pro Takt
            motif = [(0, 0.45, 1.0)]
        else:
            motif = MOTIF_A if bi % 2 == 0 else MOTIF_B
        for st, dur, accv in motif:
            t0 = (bi * 16 + st) * s16
            v = accv * dyn
            ev["vln1"].append((t0, hi, dur, v))
            ev["vln1"].append((t0, mid, dur, v * 0.8))
            ev["vln2"].append((t0, ch["v2"], dur, v * 0.9))
            ev["vla"].append((t0, ch["va"], dur, v * 0.85))
        ev["vc"].append((bi * 16 * s16, ch["vc"], 0.42, 1.0 * dyn))     # DUM auf der Eins
    # Tutti-Schlag auf der ersten Eins der Phrase (der Drop)
    c0 = chords[0]
    for name, m in (("vln1", c0["v1"][0]), ("vln2", c0["v2"]), ("vla", c0["va"]), ("vc", c0["vc"])):
        ev[name].append((0.0, m, 0.5, 1.3 if style != "soft" else 0.8))
    names = ["vln1"] if style == "teaser" else ["vln1", "vln2", "vla", "vc"]
    out = np.zeros((2, length))
    for name in names:
        out += section_bus(ev[name], name, length, rng)
    return out / (np.max(np.abs(out)) + 1e-9)


def pickup(chord, spb, seed=0):
    """Auftakt im Beat-Cut: ein kurzes 'ta-' auf der letzten Achtel vor dem Drop."""
    rng = np.random.default_rng(seed)
    length = int(1.0 * SR)
    out = np.zeros((2, length))
    for name, m in (("vln1", chord["v1"][1]), ("vln2", chord["v2"]), ("vla", chord["va"])):
        out += section_bus([(0.0, m, 0.12, 0.9)], name, length, rng)
    return out / (np.max(np.abs(out)) + 1e-9)
