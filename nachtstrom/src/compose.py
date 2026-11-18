"""NACHTSTROM v4 – Referenz-Bauplan + Spannungsboegen + FX-System.

Aus der Referenz (siehe ../REFERENZ_ANALYSE.md):
  147 BPM, lange Pitch-Sweep-Kick, Offbeat-Bass eine Quarte darueber,
  Offbeat-Hats, Clap 2 & 4, verzerrte chromatische Stereo-"Wand" in den Mitten,
  Stopps mit Filter-Loch, Kick-Stottern im Breakdown, Hoehen-Loch vor dem Drop.

Eigene Umsetzung: Cis-Phrygisch, eigene Patterns. Nichts Zufaelliges –
jede Aenderung sitzt auf einer 4/8/16-Takt-Grenze. Alle 4 Takte ein
anderer FX-Akzent (Zap / Reverse-Crash / Delay-Throw / Whoosh) -> keine
langweiligen Passagen. Zwei grosse Spannungsboegen: Break 1 und Breakdown.
Takte im Code 0-basiert (Takt 1 = bar 0).
"""
from dataclasses import dataclass
import numpy as np

BPM = 147.0
BARS = 178
BEATS = BARS * 4
SPB = 60.0 / BPM

SECTIONS = [
    ("INTRO", 0), ("INTRO B", 8), ("GROOVE", 16), ("GROOVE B", 24), ("DRIVE", 32),
    ("BREAK", 40), ("BUILD", 44), ("MAIN 1", 48), ("MAIN 1B", 64), ("STOP", 78),
    ("MAIN 2", 80), ("BREAKDOWN", 96), ("BUILD 2", 110), ("PEAK", 114),
    ("PEAK B", 130), ("MAIN 3", 146), ("OUTRO", 162),
]

ROOT = 37           # C#2 69,3 Hz – Offbeat-Bass
KICK_HZ = 51.9      # G#1 – Quarte darunter (Verhaeltnis wie Referenz)


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


# ====================================================================== KICK
KICK_EXCEPT = {
    40: [0, 1],
    41: [], 42: [], 43: [3], 44: [0, 1], 45: [], 46: [], 47: [],
    63: [0, 1, 2],
    78: [0, 1], 79: [2, 3],
    96: [0, 2], 97: [3], 98: [0, 1], 99: [], 100: [1], 101: [3], 102: [0, 1, 2, 3], 103: [0, 2],
    110: [], 111: [], 112: [], 113: [],
    121: [0, 1, 3],
    129: [0, 1], 145: [0, 1],
}
SILENT = set(range(104, 110))

# Kick-Rolls (Spannungsboegen): (Takt, Unterteilung pro Beat, Beats)
ROLLS = [
    (46, 2, (0, 4)),          # 8tel
    (47, 4, (0, 2)),          # 16tel
    (47, 8, (2, 3)),          # 32tel
    (110, 1, (0, 4)),         # Viertel
    (111, 2, (0, 4)),         # 8tel
    (112, 4, (0, 4)),         # 16tel
    (113, 8, (0, 2)),         # 32tel
]
PICKUPS = [47 * 4 + 3]        # einzelne volle Kick vor dem Drop (wie Referenz)


def kick_beats(bar):
    if bar >= BARS or bar in SILENT:
        return []
    return KICK_EXCEPT.get(bar, [0, 1, 2, 3])


def kick_hits():
    out = []
    for bar in range(BARS):
        for b in kick_beats(bar):
            out.append((bar * 4 + b, 0.85 if in_(bar, 96, 104) or bar in (43, 44, 79) else 1.0))
    return out


def roll_hits():
    """(beat, vel, fortschritt 0..1) – Velocity steigt ueber den ganzen Roll."""
    out = []
    groups = {}
    for bar, div, (b0, b1) in ROLLS:
        key = 0 if bar < 100 else 1
        groups.setdefault(key, []).append((bar, div, b0, b1))
    for key, rolls in groups.items():
        start = rolls[0][0] * 4 + rolls[0][2]
        end = rolls[-1][0] * 4 + rolls[-1][3]
        for bar, div, b0, b1 in rolls:
            n = int((b1 - b0) * div)
            for k in range(n):
                beat = bar * 4 + b0 + k / div
                prog = (beat - start) / (end - start)
                out.append((beat, 0.45 + 0.55 * prog, prog))
    return out


# ====================================================================== OFFBEAT-BASS
def bass_notes():
    notes = []
    for bar in range(BARS):
        if in_(bar, 40, 48) or in_(bar, 96, 114) or bar >= 174:
            continue
        for b in kick_beats(bar):
            p = ROOT + 1 if (bar % 8 == 7 and b == 3) else ROOT
            notes.append(Note(bar * 4 + b + 0.5, 0.45, p, 1.0))
    return notes


# ====================================================================== HATS / CLAP / PERC
def hat_events():
    ev = []
    for bar in range(BARS):
        quiet = in_(bar, 46, 48) or in_(bar, 104, 111)
        if not quiet:
            lvl = 0.5 if bar < 8 else (0.62 if bar < 16 else 0.85)
            if in_(bar, 40, 46):
                lvl = 0.55
            for beat in range(4):
                if in_(bar, 113, 114) and beat >= 2:
                    continue
                ev.append((bar * 4 + beat + 0.5, "o", lvl))
        sixteen = (in_(bar, 12, 40) or in_(bar, 48, 96) or in_(bar, 114, 170))
        if sixteen:
            for st in range(16):
                if st % 4 == 2:
                    continue
                v = [0.42, 0.2, 0.0, 0.3][st % 4] * (0.6 if bar < 16 else 1.0)
                ev.append((sx(bar, st) + (0.012 if st % 2 else 0), "c", v))
        if in_(bar, 64, 78) or in_(bar, 114, 146):
            for st in (2, 6, 10, 14):
                ev.append((sx(bar, st), "t", 0.8))
        # Hat-Roll im Aufbau 2 (111-113): 8tel -> 16tel
        if in_(bar, 111, 114):
            div = 2 if bar == 111 else 4
            nb = 4 if bar < 113 else 2
            for k in range(nb * div):
                ev.append((bar * 4 + k / div, "c", 0.3 + 0.5 * ((bar - 111) * 4 + k / div) / 10))
    return ev


def clap_events():
    ev = []
    for bar in range(BARS):
        if not (in_(bar, 16, 40) or in_(bar, 48, 96) or in_(bar, 114, 170)):
            continue
        for b in (1, 3):
            if b in kick_beats(bar):
                ev.append((bar * 4 + b, 1.0))
    return ev


def perc_events():
    ev = []
    for bar in range(BARS):
        if bar in (63, 78, 79, 121, 129, 145) or in_(bar, 40, 48) or in_(bar, 96, 114):
            continue
        if in_(bar, 4, 40) or in_(bar, 48, 96) or in_(bar, 114, 166):
            for i, st in enumerate((3, 6, 11, 14)):
                ev.append((sx(bar, st), "rim", [0.9, 0.7, 0.8, 0.65][i]))
        if in_(bar, 24, 40) or in_(bar, 48, 96) or in_(bar, 114, 162):
            for st in (7, 15):
                ev.append((sx(bar, st), "tom", 0.85))
        if in_(bar, 80, 96) or in_(bar, 114, 162):
            for i, st in enumerate((2, 9, 12)):
                ev.append((sx(bar, st), "cga", [0.8, 0.6, 0.7][i]))
        if bar % 8 == 7 and (in_(bar, 16, 40) or in_(bar, 48, 96) or in_(bar, 114, 162)):
            for k, st in enumerate((12, 13, 14, 15)):   # Tom-Fill zur naechsten Phrase
                ev.append((sx(bar, st), "tom" if k % 2 == 0 else "cga", 0.7 + 0.1 * k))
    return ev


# ====================================================================== WALL (chromatische Stereo-Wand)
WALL_A = [49, 50, 49, 52, 50, 47]          # 6-Beat-Zyklus gegen 4/4 -> verschiebt sich hypnotisch
WALL_B = [49, 50, 49, 55, 50, 47]          # Tritonus statt Terz (Main 2 / Peak B)


def wall_active(bar):
    return in_(bar, 24, 40) or in_(bar, 48, 96) or in_(bar, 114, 170) or in_(bar, 96, 104)


def wall_notes():
    notes = []
    for bar in range(BARS):
        if not wall_active(bar):
            continue
        seq = WALL_B if (in_(bar, 80, 96) or in_(bar, 130, 146)) else WALL_A
        for b in range(4):
            g = bar * 4 + b
            p = seq[g % 6]
            if in_(bar, 114, 130) and g % 6 == 3:
                p += 12
            notes.append(Note(g, 1.0, p, 1.0, g % 6 == 0))
    return notes


# ====================================================================== STAB (Calls)
STAB_A = [(0, 49, 1), (3, 49, 0), (6, 61, 1), (8, 49, 0), (10, 50, 0), (13, 56, 1), (14, 49, 0)]
STAB_B = [(0, 49, 1), (2, 61, 0), (3, 49, 0), (6, 52, 1), (9, 49, 0), (11, 56, 1), (12, 49, 0), (14, 50, 0)]


def stab_notes():
    notes = []
    for bar in range(BARS):
        if bar in (63, 78, 79, 121, 129, 145):
            continue
        if in_(bar, 40, 46) and bar % 2 == 0:                 # Break: lange Toene
            notes.append(Note(bar * 4, 3.0, 49 if bar % 4 == 0 else 50, 0.8, True))
            continue
        if in_(bar, 104, 110) and bar % 2 == 0:
            notes.append(Note(bar * 4, 3.5, 49 if bar % 4 == 0 else 47, 0.8, True))
            continue
        kind = None
        if in_(bar, 64, 78) or in_(bar, 114, 122):
            kind = STAB_B
        elif in_(bar, 32, 40) or in_(bar, 122, 130) or in_(bar, 146, 154):
            kind = STAB_A
        if kind is None:
            continue
        v = 0.55 if bar < 40 else 1.0
        for st, p, acc in kind:
            notes.append(Note(sx(bar, st), 0.3 if acc else 0.18, p, v * (1.0 if acc else 0.7), bool(acc)))
    return notes


# ====================================================================== ATMOS (Drone mit Pitch-Riser)
ATMOS_WINDOWS = [(40, 48, 1.0), (78, 80, 0.7), (96, 114, 1.0), (162, 178, 0.25)]


def atmos_semitones(beat):
    """Drone steigt in den Aufbauten: Break 1 +5, Breakdown +12 Halbtoene."""
    bar = beat / 4.0
    st = np.zeros_like(beat)
    st = np.where((bar >= 44) & (bar < 48), 5.0 * np.clip((bar - 44) / 4, 0, 1) ** 1.6, st)
    st = np.where((bar >= 110) & (bar < 114), 12.0 * np.clip((bar - 110) / 4, 0, 1) ** 1.8, st)
    return st


# ====================================================================== FX-System
ACCENTS = ["zap", "whoosh", "throw", "revcrash"]


def fx_events():
    ev = []
    special = set(range(40, 48)) | set(range(96, 114)) | {63, 78, 79, 121, 129, 145}
    for bar in range(BARS):
        if bar % 4 == 3 and bar not in special and bar < 174:
            kind = ACCENTS[(bar // 4) % 4]
            if bar % 16 == 15:
                kind = "revcrash"                 # vor jeder 16er-Phrase immer gross
            if kind == "throw" and not wall_active(bar):
                kind = "whoosh"                   # ohne Wand kein Delay-Throw -> Whoosh
            ev.append((kind, bar * 4 + (2.5 if kind == "zap" else 3)))
    for b in (16, 32, 64, 80, 130, 146):
        ev.append(("crash", b * 4))
    for b in (48, 114):
        ev.append(("impact", b * 4))
    ev += [("riser", 44 * 4, 47 * 4 + 3), ("riser", 110 * 4, 113 * 4 + 3.5)]
    ev += [("revcrash", 47 * 4 + 3), ("revcrash", 113 * 4 + 2), ("revcrash", 95 * 4 + 2)]
    ev += [("down", 40 * 4 + 2), ("down", 96 * 4), ("down", 162 * 4)]
    ev += [("wash", 63 * 4 + 3), ("wash", 78 * 4 + 1.5), ("wash", 121 * 4 + 2),
           ("wash", 129 * 4 + 1.5), ("wash", 145 * 4 + 1.5), ("wash", 40 * 4 + 1.75)]
    ev += [("boom", 104 * 4), ("boom", 105 * 4), ("boom", 107 * 4), ("boom", 109 * 4 + 3),
           ("boom", 41 * 4), ("boom", 42 * 4 + 2)]
    ev += [("zap", 44 * 4 + 1.5), ("zap", 45 * 4 + 3.5), ("throw", 99 * 4 + 2), ("throw", 101 * 4 + 3.5)]
    return ev


# ====================================================================== EDITS (auf alle Musik-Stems)
EDITS = [
    ("tapestop", 40 * 4 + 1.75, 1.25),
    ("tapestop", 78 * 4 + 1.5, 1.5),
    ("tapestop", 129 * 4 + 1.6, 1.4),
    ("stutter", 23 * 4 + 3.0, 0.5, 0.125), ("stutter", 23 * 4 + 3.5, 0.5, 0.0625),
    ("stutter", 59 * 4 + 3.0, 0.5, 0.125), ("stutter", 59 * 4 + 3.5, 0.5, 0.0625),
    ("stutter", 91 * 4 + 2.0, 1.0, 0.25), ("stutter", 91 * 4 + 3.0, 0.5, 0.125),
    ("stutter", 91 * 4 + 3.5, 0.5, 0.0625),
    ("stutter", 137 * 4 + 3.0, 1.0, 0.0625),
    ("hpsweep", 31 * 4, 32 * 4, 20.0, 900.0),
    ("hpsweep", 95 * 4, 96 * 4, 20.0, 1200.0),
    ("lpcut", 113 * 4 + 2, 114 * 4, 2500.0),
    ("lpcut", 129 * 4 + 1.6, 130 * 4, 2000.0),
    ("lpcut", 145 * 4 + 2, 146 * 4, 2000.0),
]


# ====================================================================== AUTOMATION
def ramp(x, x0, x1, y0, y1):
    t = np.clip((x - x0) / (x1 - x0), 0, 1)
    return y0 + (y1 - y0) * t


def exp_ramp(x, x0, x1, y0, y1):
    t = np.clip((x - x0) / (x1 - x0), 0, 1)
    return y0 * (y1 / y0) ** t


def wall_cutoff(beat):
    bar = beat / 4.0
    phr = (bar % 16) / 16.0
    c = np.full_like(beat, 1500.0)
    c = np.where(bar < 40, exp_ramp(bar, 24, 40, 250, 1400), c)
    c = np.where((bar >= 48) & (bar < 96), 1100 * 2.0 ** (1.2 * phr), c)
    c = np.where((bar >= 96) & (bar < 104), exp_ramp(bar, 96, 104, 1500, 300), c)
    c = np.where((bar >= 114) & (bar < 162), 1500 * 2.0 ** (1.3 * phr), c)
    c = np.where(bar >= 162, exp_ramp(bar, 162, 170, 1500, 250), c)
    return c


def stab_cutoff(beat):
    bar = beat / 4.0
    phr = (bar % 16) / 16.0
    c = np.full_like(beat, 1400.0)
    c = np.where(bar < 40, exp_ramp(bar, 32, 40, 350, 900), c)
    c = np.where((bar >= 40) & (bar < 48), exp_ramp(bar, 40, 48, 500, 2500), c)
    c = np.where((bar >= 64) & (bar < 96), 1000 * 2.0 ** (1.3 * phr), c)
    c = np.where((bar >= 104) & (bar < 114), exp_ramp(bar, 104, 114, 300, 3000), c)
    c = np.where((bar >= 114) & (bar < 162), 1300 * 2.0 ** (1.4 * phr), c)
    return c


def hats_tone(beat):
    bar = beat / 4.0
    h = np.full_like(beat, 5500.0)
    h = np.where(bar < 16, 5000.0, h)
    h = np.where((bar >= 16) & (bar < 32), exp_ramp(bar, 16, 32, 6500, 4500), h)
    h = np.where((bar >= 44) & (bar < 46), exp_ramp(bar, 44, 46, 5500, 9000), h)
    h = np.where((bar >= 64) & (bar < 78), 4000.0, h)
    h = np.where((bar >= 111) & (bar < 114), exp_ramp(bar, 111, 114, 9000, 3000), h)
    h = np.where((bar >= 114) & (bar < 146), 3800.0, h)
    h = np.where(bar >= 162, exp_ramp(bar, 162, 178, 5000, 8000), h)
    return h


def throw_beats():
    return [e[1] for e in fx_events() if e[0] == "throw"]
