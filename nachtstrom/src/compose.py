"""NACHTSTROM v12 – ein durchgehender Track + viraler spanischer Vocal-Hook (Ohrwurm-Melodie).

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
    (112, 2, (0, 4)),         # 8tel
    (113, 2, (0, 2)),
]
PICKUPS = [47 * 4 + 3]        # einzelne volle Kick vor dem Drop (wie Referenz)


def root_offset(bar):
    """v11: kein Tonartwechsel mehr – der ganze Track bleibt auf Cis (nicht progressiv)."""
    return 0


FILL_TYPES = ["toms", "kickskip", "hatroll", "revcym"]
NO_FILL = set(range(40, 48)) | set(range(96, 114)) | {63, 78, 79, 121, 129, 145} | set(range(170, 178))


def fill_type(bar):
    """Am Ende jeder 8-Takt-Phrase ein anderer Fill (System, kein Zufall)."""
    if bar % 8 != 7 or bar in NO_FILL or bar < 8:
        return None
    return FILL_TYPES[(bar // 8) % 4]


def kick_beats(bar):
    if bar >= BARS or bar in SILENT:
        return []
    beats = KICK_EXCEPT.get(bar, [0, 1, 2, 3])
    if fill_type(bar) == "kickskip":
        beats = [b for b in beats if b != 3]
    return beats


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
                out.append((beat, 0.4 + 0.45 * prog, prog))
    return out


# ====================================================================== OFFBEAT-BASS
def bass_pattern(bar):
    return "off"         # v11: durchgehend Offbeat-Sub, ein Track statt drei


def bass_notes():
    notes = []
    for bar in range(BARS):
        if in_(bar, 40, 48) or in_(bar, 96, 114) or bar >= 174:
            continue
        pat = bass_pattern(bar)
        r = ROOT + root_offset(bar)
        for b in kick_beats(bar):
            base = bar * 4 + b
            p = r + 1 if (bar % 8 == 7 and b == 3) else r
            if pat == "roll":
                for off, v in ((0.25, 0.65), (0.5, 1.0), (0.75, 0.8)):
                    notes.append(Note(base + off, 0.2, p, v))
            elif pat == "sync":
                notes.append(Note(base + 0.5, 0.22, p, 1.0))
                notes.append(Note(base + 0.75, 0.2, p + (12 if b % 2 else 0), 0.75))
            else:
                if pat == "jump" and bar % 2 == 1 and b == 2:
                    p = r + 12
                notes.append(Note(base + 0.5, 0.45, p, 1.0))
    return notes


# ====================================================================== HATS / CLAP / PERC
def hat_kind(bar):
    """Offbeat-Hat waechst wie in der Referenz: kurz (Intro) -> mittel (Groove/Main) -> offen (Peak)."""
    if bar < 16:
        return "o1"
    if in_(bar, 114, 146):
        return "o3"
    return "o2"


def hat_events():
    ev = []
    for bar in range(BARS):
        quiet = in_(bar, 46, 48) or in_(bar, 104, 111)
        if not quiet:
            lvl = 0.6 if bar < 8 else (0.75 if bar < 16 else 0.9)
            if in_(bar, 40, 46):
                lvl = 0.55
            for beat in range(4):
                if in_(bar, 113, 114) and beat >= 2:
                    continue
                ev.append((bar * 4 + beat + 0.5, hat_kind(bar), lvl))
        if in_(bar, 16, 40) or in_(bar, 48, 96) or in_(bar, 114, 162):
            v = 0.35 if bar < 48 else 0.5
            for beat in range(4):
                ev.append((bar * 4 + beat + 0.25, "e", v * (1.0 if beat % 2 == 0 else 0.8)))
        if in_(bar, 72, 78) or in_(bar, 122, 129):        # Variation: 16tel oeffnen sich fuer ein paar Takte
            for beat in range(4):
                ev.append((bar * 4 + beat + 0.75, "e", 0.32))
        if fill_type(bar) == "hatroll":                    # Fill: 32tel-Roll auf Beat 4
            for k in range(8):
                ev.append((bar * 4 + 3 + k / 8, "e", 0.25 + 0.06 * k))
        if in_(bar, 114, 130):                            # Ride nur im Peak
            for beat in range(4):
                ev.append((bar * 4 + beat + 0.5, "t", 0.45))
        if in_(bar, 111, 114):
            nb = 4 if bar < 113 else 2
            for k in range(nb * 2):
                ev.append((bar * 4 + k / 2, "e", 0.3 + 0.4 * ((bar - 111) * 4 + k / 2) / 10))
    return ev


def clap_events():
    ev = []
    for bar in range(BARS):
        if not (in_(bar, 16, 40) or in_(bar, 48, 96) or in_(bar, 114, 170)):
            continue
        for b in (1, 3):
            if b in kick_beats(bar) or (b == 3 and fill_type(bar) == "kickskip"):
                ev.append((bar * 4 + b, 1.0))
        if fill_type(bar) == "kickskip":
            ev.append((bar * 4 + 3.75, 0.55))
    return ev


TOMS_T1 = ((6, "tl", 0.8), (7, "tm", 0.6), (14, "tl", 0.75))
TOMS_T2 = ((3, "tm", 0.7), (6, "tl", 0.85), (10, "tm", 0.6), (11, "tl", 0.7), (14, "tm", 0.8))
TOMS_HALF = ((0, "tl", 0.9), (3, "tm", 0.6), (6, "tl", 0.8), (10, "tm", 0.7), (12, "tl", 0.75))


def perc_events():
    ev = []
    for bar in range(BARS):
        if bar in (63, 78, 79, 121, 129, 145):
            continue
        pats = []
        if in_(bar, 16, 40) or in_(bar, 48, 162):
            pats.append(TOMS_T1)
        if in_(bar, 40, 46):
            pats.append(TOMS_HALF)                    # Break 1: Toms in Halbtempo
        if in_(bar, 48, 166):
            pats.append(((3, "rim", 0.8), (11, "rim", 0.65)))
        if in_(bar, 114, 146):                        # Peak: gleiche Familie, nur dichter
            pats.append(((2, "cga", 0.7), (9, "cga", 0.55), (12, "cga", 0.6)))
        for pat in pats:
            for st, kind, v in pat:
                ev.append((sx(bar, st), kind, v))
    for bar in range(BARS):
        if fill_type(bar) == "toms":
            for k, kind in enumerate(("tm", "tm", "tl", "tl")):
                ev.append((bar * 4 + 3 + k / 4, kind, 0.65 + 0.08 * k))
    for bar, div in ((46, 2), (47, 4)):           # Tom-Roll als Aufbau in Break 1
        n = 4 * div if bar == 46 else 3 * div
        for k in range(n):
            prog = ((bar - 46) * 4 + k / div) / 7.0
            ev.append((bar * 4 + k / div, "tl" if k % 2 == 0 else "tm", 0.45 + 0.5 * prog))
    return ev


# ====================================================================== WALL (chromatische Stereo-Wand)
WALL_A = [49, 49, 49, 50]                  # minimal: 3x Grundton, 1x b2
WALL_B = [49, 49, 55, 49]                  # Main 2 / Peak B: Tritonus als Spannung
WALL_C = [49, 49, 49, 61]                  # Main 1B / Peak: Oktav-Sprung auf Beat 4


def wall_active(bar):
    return in_(bar, 32, 40) or in_(bar, 48, 162)


RIFF_A = [(0, 0, 1), (3, 0, 0), (6, 12, 1), (8, 0, 0), (11, 3, 0), (14, 0, 1)]            # Drive / Main 1 / Main 3
RIFF_B = [(0, 0, 1), (2, 0, 0), (4, 7, 1), (7, 0, 0), (10, 10, 1), (12, 0, 0), (14, 7, 0)]  # Main 2 (auf H)
RIFF_C = [(0, 0, 1), (3, 12, 0), (6, 0, 1), (9, 15, 0), (12, 0, 1), (14, 13, 0)]           # Peak
RIFF_CALL = [(12, 7, 1), (13, 5, 0), (14, 3, 0), (15, 1, 1)]                              # Antwort im 4. Takt


def riff_pattern(bar):
    pat = RIFF_A
    if bar % 4 == 3:
        pat = [n for n in pat if n[0] < 12] + RIFF_CALL
    if bar % 16 < 4 and not in_(bar, 32, 40):      # erste 4 Takte jeder Phrase: nur Akzente (Luft)
        pat = [n for n in pat if n[2]]
    return pat


def wall_notes():
    notes = []
    base = 49  # C#3
    for bar in range(BARS):
        if not wall_active(bar):
            continue
        if in_(bar, 104, 110):                 # Breakdown: lange Toene im grossen Raum
            if bar % 2 == 0:
                notes.append(Note(bar * 4, 4.0, 49, 0.9, True))
                notes.append(Note(bar * 4 + 4, 4.0, 50 if bar % 4 == 0 else 47, 0.9, True))
            continue
        off = root_offset(bar)
        for st, semi, acc in riff_pattern(bar):
            notes.append(Note(sx(bar, st), 0.5 if acc else 0.25, base + off + semi, 1.0 if acc else 0.75, bool(acc)))
    return notes


# Dub-Stabs (Quint + Oktave, kein Akkordwechsel) mit langem Echo – Highlights
def dub_events():
    ev = [24 * 4 + 0.5, 106 * 4, 108 * 4 + 2, 162 * 4 + 0.5]
    ev += [bar * 4 + 0.5 for bar in range(130, 146, 2)]
    return ev


def dub_notes():
    return [Note(b, 0.35, p + root_offset(int(b // 4)), 0.9, True) for b in dub_events() for p in (49, 56, 61)]


# ====================================================================== STAB (Calls)
STAB_A = [(0, 49, 1), (3, 49, 0), (6, 61, 1), (8, 49, 0), (10, 50, 0), (13, 56, 1), (14, 49, 0)]
STAB_B = [(0, 49, 1), (2, 61, 0), (3, 49, 0), (6, 52, 1), (9, 49, 0), (11, 56, 1), (12, 49, 0), (14, 50, 0)]


STAB_PEAK = [(0, 49, 1), (3, 49, 0), (6, 56, 1), (10, 49, 0), (13, 52, 1)]


def stab_notes():
    return []      # v11: kein Extra-Hook im Peak (sonst "wie ein zweiter Track")


# ====================================================================== ATMOS (Drone mit Pitch-Riser)
ATMOS_WINDOWS = [(40, 48, 0.8), (96, 114, 1.0)]


def atmos_semitones(beat):
    """Drone steigt in den Aufbauten: Break 1 +5, Breakdown +12 Halbtoene."""
    bar = beat / 4.0
    st = np.zeros_like(beat)
    st = np.where((bar >= 44) & (bar < 48), 5.0 * np.clip((bar - 44) / 4, 0, 1) ** 1.6, st)
    st = np.where((bar >= 110) & (bar < 114), 7.0 * np.clip((bar - 110) / 4, 0, 1) ** 1.8, st)
    return st


# ====================================================================== FX-System
ACCENTS = ["zap", "whoosh", "throw", "revcrash"]


def fx_events():
    """Kuratierte Highlights statt FX-Dauerfeuer."""
    ev = []
    for bar in (15, 31, 47, 63, 129, 145):
        ev.append(("revcrash", bar * 4 + 3))
    ev += [("revcrash", 113 * 4 + 2)]
    ev += [("crash", 16 * 4), ("crash", 48 * 4), ("crash", 80 * 4), ("crash", 114 * 4), ("crash", 146 * 4)]
    ev += [("subdrop", 48 * 4), ("subdrop", 114 * 4)]
    ev += [("ping", 64 * 4), ("ping", 130 * 4)]
    ev += [("down", 40 * 4 + 2), ("down", 96 * 4)]
    ev += [("riser", 110 * 4, 113 * 4 + 3.5)]
    ev += [("boom", 104 * 4), ("boom", 107 * 4)]
    for bar in range(BARS):
        if fill_type(bar) == "revcym":
            ev.append(("revcrash", bar * 4 + 3))
    return ev


# ---------------------------------------------------------------- VIRALER HOOK
# Hypnotischer Sprechgesang statt Pop-Melodie: enger Tonraum (Cis-D-E, phrygisches D),
# Silben im 3-3-2-Groove, Takt 4 frei fuer den Atem. (16tel im 4-Takt-Block, Laenge, MIDI, Silbe)
HOOK = [
    (0, 2, 61, "de"), (3, 2, 61, "ja"), (6, 1, 61, "te"), (8, 2, 62, "ca"), (10, 4, 61, "er"),
    (16, 2, 61, "de"), (19, 2, 61, "ja"), (22, 1, 61, "te"), (24, 2, 62, "ca"), (26, 4, 64, "er"),
    (32, 3, 64, "mas"), (35, 2, 62, "pro"), (38, 3, 61, "fun"), (41, 5, 59, "do"),
]
# ---------------------------------------------------------------- VIOLINE (viraler Hook, v16)
# Singbare 4-Takt-Melodie in Cis-phrygisch (wie das Riff: Cis D E Fis Gis A H).
# Bogen: hoch auf Cis, kleine Terz E, dann die phrygische Kadenz D -> Cis.
#   Cis-H-Cis-E | D-Cis-H | Gis-A-H-Cis | D-Cis.  (16tel im 4-Takt-Block, Laenge, MIDI)
VIOLIN_HOOK = [
    (0, 6, 85), (6, 2, 83), (8, 4, 85), (12, 4, 88),
    (16, 8, 86), (24, 4, 85), (28, 4, 83),
    (32, 6, 80), (38, 2, 81), (40, 4, 83), (44, 4, 85),
    (48, 6, 86), (54, 10, 85),
]
# ---------------------------------------------------------------- STREICHER-SHORTS (v17)
# Dramatisch wie im Orchester: Cis-Moll -> A -> D (Neapolitaner) -> E; die Oberstimme der
# 1. Violinen steigt E6 -> E6 -> Fis6 -> Gis6 (Spannung), Crescendo ueber 4 Takte.
STRINGS_CHORDS = [
    {"v1": (88, 85, 80), "v2": 73, "va": 68, "vc": 49},   # Cis-Moll: E6 Cis6 Gis5 | Cis5 | Gis4 | Cis3
    {"v1": (88, 85, 81), "v2": 76, "va": 69, "vc": 45},   # A-Dur:    E6 Cis6 A5   | E5   | A4   | A2
    {"v1": (90, 86, 81), "v2": 74, "va": 69, "vc": 50},   # D-Dur:    Fis6 D6 A5   | D5   | A4   | D3
    {"v1": (92, 88, 83), "v2": 76, "va": 71, "vc": 52},   # E-Dur:    Gis6 E6 H5   | E5   | H4   | E3
]
STRINGS_PLACES = [
    (36, 0.55, "teaser"),
    (48, 1.0, "full"), (52, 1.0, "full"), (56, 1.0, "full"), (60, 1.0, "full"),   # Drop 1: Streicher steigen ein
    (105, 0.9, "soft"),
    (114, 1.0, "full"), (118, 1.0, "full"), (122, 1.0, "full"), (126, 1.0, "full"),
    (150, 0.9, "full"),
    (166, 0.6, "teaser"),
]
# Auftakt "ta-" auf der letzten Achtel vor jedem grossen Drop (im Beat-Cut), dann der Tutti-Schlag
STRINGS_PICKUPS = [47 * 4 + 3.5, 113 * 4 + 3.5]
# (Start-Takt, Pegel, Stil): teaser = gefiltert & weit weg, full = Geigen-Pult + Bratsche,
# solo = eine Geige eine Oktave tiefer im Breakdown (der Gaensehaut-Moment)
VIOLIN_PLACES = [
    (36, 0.55, "teaser"),
    (56, 1.0, "full"), (60, 1.0, "full"),
    (105, 0.95, "solo"),
    (114, 1.0, "full"), (118, 1.0, "full"), (122, 1.0, "full"), (126, 1.0, "full"),
    (150, 0.9, "full"),
    (166, 0.6, "teaser"),
]
# (Start-Takt, Pegel, Stil) – Teaser, voller Hook, a cappella im Breakdown, Peak-Schleife
HOOK_PLACES = [
    (36, 0.55, "teaser"),
    (56, 1.0, "full"), (60, 1.0, "full"),
    (105, 0.95, "acapella"),
    (114, 1.0, "full"), (118, 1.0, "full"), (122, 1.0, "full"), (126, 1.0, "full"),
    (150, 0.85, "full"),
    (166, 0.6, "teaser"),
]
# Atem: Einatmen vor jedem Hook-Einsatz (endet auf der Eins), grosses Einatmen im Beat-Cut vor dem Drop,
# Ausatmen zu Beginn des Breakdowns. (Art, Beat an dem der Atem ENDET bzw. BEGINNT, Pegel)
_B = {("in", bar * 4): 0.8 for bar, g, st in HOOK_PLACES if st != "teaser"}
_B[("in", 114 * 4)] = 0.45                      # Einatmen im Beat-Cut vor dem Drop (hoerbar, aber leiser als der Drop)
_B[("out", 96 * 4 + 0.5)] = 0.8                 # Ausatmen: Breakdown beginnt
_B[("out", 41 * 4)] = 0.6                       # Ausatmen nach dem Tape-Stopp in Break 1
BREATHS = sorted((k, b, v) for (k, b), v in _B.items())


def hook_riff_notes(bar):
    """Im Peak spielt das Riff die Hook-Melodie mit (eine Oktave tiefer) – die Melodie brennt sich ein."""
    blk = bar - ((bar - 114) % 4)
    out = []
    for st, ln, m, syl in HOOK:
        b = blk * 4 + st * 0.25
        if bar * 4 <= b < bar * 4 + 4:
            out.append(Note(b, ln * 0.25 * 0.9, m - 12, 1.0, st in (0, 16, 32)))
    return out


# Vocal-Shots (ElevenLabs, eigene Woerter) – (Shot, Beat, Pegel, Stil)
VOCAL_EVENTS = [   # gesprochen, gehaucht (Samples/Vocals/spoken, siehe spoken.py)
    ("SPK_CORRIENTE", 28 * 4 + 1.0, 0.8, "whisper"),     # Vorbote vor dem Drive
    ("SPK_PROFUNDO", 44 * 4 + 2.0, 0.9, "deep"),         # Break 1, zwischen den Kick-Teasern
    ("SPK_NOPARES", 79 * 4 + 0.9, 1.0, "close"),         # im 2-Takt-Stopp, ganz nah am Ohr
    ("SPK_SIGUE", 129 * 4 + 1.9, 0.9, "close"),          # im Stopp bei Takt 130
    ("CHOP", 137 * 4 + 2.5, 0.7, "chop"),                # "Ven"-Chop als Call im Peak B
    ("CHOP", 141 * 4 + 2.5, 0.7, "chop"),
    ("SPK_CORRIENTE", 166 * 4 + 0.0, 0.75, "whisper"),   # Abschied im Outro
]
# Gesprochener Hook an jedem HOOK_PLACE: "Ven... dejate caer." auf der Eins, zwei Takte spaeter "Mas profundo."
SPOKEN_HOOK = [("SPK_DEJATE", 0.0), ("SPK_PROFUNDO", 8.0)]


# Wand-Solo mit Resonanz-Sweep in den Stopps (Referenz: Wand liegt frei)
WALL_SWEEPS = [(78 * 4 + 2, 80 * 4), (129 * 4 + 2, 130 * 4)]


# ====================================================================== EDITS (auf alle Musik-Stems)
EDITS = [
    ("lpdive", 15 * 4 + 1, 16 * 4, 18000.0, 350.0),      # Filter-Dive in den Groove (Clap kommt)
    ("tapestop", 40 * 4 + 1.75, 1.25),                    # in Break 1
    ("stutter", 55 * 4 + 3.0, 0.5, 0.125), ("stutter", 55 * 4 + 3.5, 0.5, 0.0625),
    ("stutter", 125 * 4 + 3.0, 0.5, 0.125), ("stutter", 125 * 4 + 3.5, 0.5, 0.0625),
    ("hpsweep", 95 * 4, 96 * 4, 20.0, 1200.0),            # Hochpass-Fahrt in den Breakdown
    ("lpcut", 113 * 4 + 2, 113 * 4 + 3.5, 2500.0),
    ("cut", 113 * 4 + 3.5, 114 * 4),                      # Beat-Cut vor dem grossen Drop
    ("lpcut", 129 * 4 + 2, 130 * 4, 2000.0),
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
    c = np.where((bar >= 104) & (bar < 110), 650.0, c)
    c = np.where((bar >= 110) & (bar < 114), exp_ramp(bar, 110, 114, 650, 3200), c)
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
    return [63 * 4 + 3, 95 * 4 + 2, 121 * 4 + 2, 161 * 4 + 2]   # Dub-Echo-Throws der Wand


def color_lp(beat):
    """Dezente Klangfarben-Dramaturgie: Intro dunkel -> offen; Peak etwas heller; Main 3/Outro schliessen."""
    bar = beat / 4.0
    c = np.full_like(beat, 16000.0)
    c = np.where(bar < 8, 4500.0, c)
    c = np.where((bar >= 8) & (bar < 16), exp_ramp(bar, 8, 16, 4500, 16000), c)
    c = np.where((bar >= 114) & (bar < 146), 19000.0, c)
    c = np.where((bar >= 146) & (bar < 162), exp_ramp(bar, 146, 162, 15000, 7000), c)
    c = np.where(bar >= 162, exp_ramp(bar, 162, 178, 7000, 4000), c)
    return c


def bass_color(bar):
    """v15: reiner Sub (kein Saw, kein Mitten-Dreck) – tief, gefuehlt statt gehoert, nicht EDM.
    Nur eine sanfte Saettigung, damit der Sub auch auf kleinen Boxen noch ahnbar bleibt."""
    return 0.0, 1.4, 150.0
