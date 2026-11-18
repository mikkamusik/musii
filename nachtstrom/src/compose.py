"""NACHTSTROM v3 – gebaut nach dem vermessenen Bauplan der Referenz.

Referenz-Analyse (siehe ../REFERENZ_ANALYSE.md):
  147 BPM, Kick-Tail ~54 Hz, Offbeat-Bass konstant eine Quarte darueber,
  Hats auf jedem Offbeat, Clap 2 & 4, Bass+Kick mono, Mitten sehr breit,
  8/16-Takt-Phrasen, FX-Akzent alle 4 Takte, kurze Kick-Stopps als Uebergang,
  Breaks: 8 Takte (41-48), 2 Takte (79-80), Breakdown 97-114.

Eigener Inhalt: Cis-Phrygisch, eigene Patterns, eigene Sounds.
Kein Zufall: jede Aenderung sitzt auf einer Phrasen-Grenze (System!).
Takte im Code 0-basiert (Takt 1 = bar 0).
"""
from dataclasses import dataclass
import numpy as np

BPM = 147.0
BARS = 178
BEATS = BARS * 4
SPB = 60.0 / BPM

SECTIONS = [
    ("INTRO", 0), ("LAYER", 8), ("GROOVE", 16), ("DRIVE", 32), ("BREAK", 40),
    ("MAIN 1", 48), ("MAIN 1B", 64), ("STOP", 78), ("MAIN 2", 80),
    ("BREAKDOWN", 96), ("PEAK", 114), ("PEAK B", 130), ("MAIN 3", 146),
    ("OUTRO", 162),
]

ROOT = 37           # C#2 = 69,3 Hz (Offbeat-Bass)
KICK_HZ = 51.9      # G#1 – Quarte unter dem Bass (wie das Verhaeltnis in der Referenz)


@dataclass
class Note:
    start: float
    dur: float
    pitch: int
    vel: float = 1.0
    accent: bool = False


def in_(bar, a, b):
    return a <= bar < b


def sx(bar, step):
    return bar * 4 + step * 0.25


# ------------------------------------------------------------------ Kick-Plan (beat-genau)
# Standard: 4 Kicks pro Takt. Ausnahmen = Uebergaenge wie in der Referenz.
KICK_EXCEPT = {
    40: [0, 1],                       # Break 1 beginnt nach Beat 2
    41: [], 42: [], 43: [3], 44: [0, 1], 45: [], 46: [], 47: [3],
    63: [0, 1, 2],                    # Stopp auf Beat 4
    78: [0, 1], 79: [2, 3],           # 2-Takt-Stopp
    96: [0, 2], 97: [3], 98: [0, 1], 99: [], 100: [1], 101: [3],
    102: [0, 1, 2, 3], 103: [0, 2],   # Kick-Stottern am Anfang des Breakdowns
    121: [0, 1, 3],                   # Beat 3 raus
    129: [0, 1], 145: [0, 1],         # 2-Beat-Stopps
}
BREAKDOWN_SILENT = range(104, 114)
BOOMS = [(104, 0), (105, 0), (107, 0), (109, 3), (112, 0)]  # tiefe Hits im Breakdown


def kick_beats(bar):
    if bar >= BARS:
        return []
    if bar in KICK_EXCEPT:
        return KICK_EXCEPT[bar]
    if bar in BREAKDOWN_SILENT:
        return []
    return [0, 1, 2, 3]


def kick_hits():
    out = []
    for bar in range(BARS):
        for b in kick_beats(bar):
            v = 1.0
            if bar in (96, 97, 98, 99, 100, 101, 102, 103) or bar in (43, 44, 47, 79):
                v = 0.85
            out.append((bar * 4 + b, v))
    return out


# ------------------------------------------------------------------ Offbeat-Bass (dirty, mono)
def bass_notes():
    notes = []
    for bar in range(BARS):
        for b in kick_beats(bar):
            if in_(bar, 40, 48) or in_(bar, 96, 114):
                continue
            p = ROOT
            if bar % 8 == 7 and b == 3:
                p = ROOT + 1            # D2 – phrygische Spannung am Phrasenende
            notes.append(Note(bar * 4 + b + 0.5, 0.45, p, 1.0))
    return notes


# ------------------------------------------------------------------ Hats / Clap / Perc (feste Patterns)
def hat_events():
    ev = []
    for bar in range(BARS):
        if in_(bar, 46, 48) or in_(bar, 103, 114) or bar >= 178:
            continue
        # Offbeat-Hat: Pegel waechst in Stufen (Phrasen)
        lvl = 0.55 if bar < 16 else (0.75 if bar < 24 else 0.85)
        if in_(bar, 32, 40):
            lvl = 0.7
        if in_(bar, 40, 46):
            lvl = 0.6
        if bar >= 162:
            lvl = 0.7
        for beat in range(4):
            ev.append((bar * 4 + beat + 0.5, "o", lvl))
        # 16tel-Closed-Hats ab Takt 17
        if in_(bar, 16, 40) or in_(bar, 48, 96) or in_(bar, 114, 170):
            for st in range(16):
                if st % 4 == 2:
                    continue
                v = [0.45, 0.22, 0.0, 0.32][st % 4]
                ev.append((sx(bar, st) + (0.012 if st % 2 else 0), "c", v))
        # Top-Layer (Ride-artig) in den hellen Teilen
        if in_(bar, 64, 78) or in_(bar, 114, 146):
            for st in (2, 6, 10, 14):
                ev.append((sx(bar, st), "t", 0.8))
    return ev


def clap_events():
    ev = []
    for bar in range(BARS):
        on = in_(bar, 16, 40) or in_(bar, 48, 96) or in_(bar, 114, 170)
        if not on:
            continue
        for b in (1, 3):
            if b in kick_beats(bar):
                ev.append((bar * 4 + b, 1.0))
    return ev


PERC = {  # 16tel-Positionen je Phrasen-Typ (fest, kein Zufall)
    "rim": [3, 6, 11, 14],
    "tom": [7, 15],
    "cga": [2, 9, 12],
}


def perc_events():
    ev = []
    vel = [0.9, 0.7, 0.8, 0.65]
    for bar in range(BARS):
        rim_on = in_(bar, 8, 40) or in_(bar, 48, 96) or in_(bar, 114, 170)
        tom_on = in_(bar, 48, 96) or in_(bar, 114, 162)
        cga_on = in_(bar, 114, 162) or in_(bar, 80, 96)
        if bar in (63, 78, 79, 121, 129, 145):
            continue
        if rim_on:
            for i, st in enumerate(PERC["rim"]):
                ev.append((sx(bar, st), "rim", vel[i]))
        if tom_on:
            for st in PERC["tom"]:
                ev.append((sx(bar, st), "tom", 0.85))
        if cga_on:
            for i, st in enumerate(PERC["cga"]):
                ev.append((sx(bar, st), "cga", [0.8, 0.6, 0.7][i]))
    return ev


# ------------------------------------------------------------------ Haupt-Stab (systematische Varianten)
# Cis-Phrygisch: C#3=49, D3=50, E3=52, G#3=56, B3=59, C#4=61
STAB_A = [(0, 49, 1), (3, 49, 0), (6, 61, 1), (8, 49, 0), (10, 50, 0), (13, 56, 1), (14, 49, 0)]
STAB_B = [(0, 49, 1), (2, 61, 0), (3, 49, 0), (6, 52, 1), (9, 49, 0), (11, 56, 1), (12, 49, 0), (14, 50, 0)]
STAB_CALL = [(12, 59, 1), (13, 56, 0), (14, 52, 0), (15, 50, 1)]  # Antwort im 8. Takt der Phrase


def stab_plan(bar):
    """Welche Variante wann – fest an die Phrasen gebunden."""
    if in_(bar, 32, 40):
        return "A", 0.55       # Teaser
    if in_(bar, 40, 48):
        return "LONG", 0.8     # Break: lange Toene im Raum
    if in_(bar, 48, 64) or in_(bar, 146, 162):
        return "A", 1.0
    if in_(bar, 64, 78) or in_(bar, 114, 130):
        return "B", 1.0
    if in_(bar, 80, 96) or in_(bar, 130, 146):
        return "C", 1.0        # 3/16-Polymeter
    if in_(bar, 104, 114):
        return "HALF", 0.8     # Breakdown: halbe Dichte, riesiger Raum
    if in_(bar, 162, 170):
        return "A", 0.6
    return None, 0


def stab_notes():
    notes = []
    for bar in range(BARS):
        kind, v = stab_plan(bar)
        if kind is None or bar in (63, 78, 79, 121, 129, 145):
            continue
        if kind == "LONG":
            if bar % 2 == 0:
                notes.append(Note(bar * 4, 3.0, 49 if bar % 4 == 0 else 50, v, True))
            continue
        if kind == "C":
            for st in range(16):
                g = bar * 16 + st
                if g % 3 == 0:
                    p = [49, 56, 61, 49, 52][(g // 3) % 5]
                    notes.append(Note(sx(bar, st), 0.2, p, v * (1.0 if (g // 3) % 5 == 0 else 0.75), (g // 3) % 5 == 0))
            continue
        pat = STAB_A if kind in ("A", "HALF") else STAB_B
        if kind == "HALF":
            pat = pat[::2]
        if bar % 8 == 7 and kind in ("A", "B"):
            pat = [s for s in pat if s[0] < 12] + STAB_CALL
        for st, p, acc in pat:
            notes.append(Note(sx(bar, st), 0.3 if acc else 0.18, p, v * (1.0 if acc else 0.7), bool(acc)))
    return notes


# ------------------------------------------------------------------ Atmosphaere (nur Breaks / Main 2)
ATMOS_WINDOWS = [(40, 48, 1.0), (78, 80, 0.8), (80, 96, 0.35), (96, 114, 1.0)]


# ------------------------------------------------------------------ FX-System
def fx_events():
    """('sweep', beat) alle 4 Takte; ('swell', beat) vor jeder 8-Takt-Phrase;
    ('wash', beat) bei jedem Kick-Stopp."""
    ev = []
    for bar in range(BARS):
        if in_(bar, 104, 114) or bar >= 176:
            continue
        if bar % 4 == 3:
            ev.append(("sweep", bar * 4 + 3))
        if bar % 8 == 7:
            ev.append(("swell", bar * 4 + 3))
    for bar, beat in ((40, 2), (63, 3), (78, 2), (121, 2), (129, 2), (145, 2)):
        ev.append(("wash", bar * 4 + beat))
    return ev


# ------------------------------------------------------------------ Automation (Phrasen-Rampen statt Zufalls-LFOs)
def ramp(x, x0, x1, y0, y1):
    t = np.clip((x - x0) / (x1 - x0), 0, 1)
    return y0 + (y1 - y0) * t


def exp_ramp(x, x0, x1, y0, y1):
    t = np.clip((x - x0) / (x1 - x0), 0, 1)
    return y0 * (y1 / y0) ** t


def stab_cutoff(beat):
    bar = beat / 4.0
    c = np.full_like(beat, 1200.0)
    c = np.where(bar < 40, exp_ramp(bar, 32, 40, 350, 900), c)
    c = np.where((bar >= 40) & (bar < 48), exp_ramp(bar, 40, 48, 500, 1600), c)
    # in jeder 16-Takt-Phrase oeffnet der Filter langsam (System statt Zufall)
    phr = (bar % 16) / 16.0
    c = np.where((bar >= 48) & (bar < 96), 900 * 2.0 ** (1.3 * phr), c)
    c = np.where((bar >= 104) & (bar < 114), exp_ramp(bar, 104, 114, 300, 2500), c)
    c = np.where((bar >= 114) & (bar < 146), 1300 * 2.0 ** (1.4 * phr), c)
    c = np.where((bar >= 146) & (bar < 170), exp_ramp(bar, 146, 170, 1800, 300), c)
    return c


def hats_tone(beat):
    """Helligkeit der Hats (Hochpass) – Stufen wie die Hoehen-Kurve der Referenz."""
    bar = beat / 4.0
    h = np.full_like(beat, 5500.0)
    h = np.where(bar < 16, 7500.0, h)
    h = np.where((bar >= 16) & (bar < 32), exp_ramp(bar, 16, 32, 6500, 4500), h)
    h = np.where((bar >= 64) & (bar < 78), 4000.0, h)
    h = np.where((bar >= 114) & (bar < 146), 3800.0, h)
    h = np.where(bar >= 162, exp_ramp(bar, 162, 178, 5000, 8000), h)
    return h
