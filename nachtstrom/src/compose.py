"""NACHTSTROM – Komposition & Arrangement.
145 BPM, f-Moll, 192 Takte. Alle Zeiten in Beats (Viertel).

Struktur & Spannungsbogen:
  INTRO      1-16   Kick + Rumble + Hats, DJ-freundlich
  GROOVE    17-32   Rolling Bass, Toms, Shaker, Hook-Teaser (zu)
  BUILD     33-48   Clap, Hook oeffnet sich, Snare-Roll, Luftloch
  DROP 1    49-80   voller Groove, ab 65 Acid
  BREAK     81-96   Kick raus, Hook im Raum, Spannungsakkorde,
                    Roll + Riser, 1 Beat Stille
  PEAK     97-128   alles, Hook-Variation B, Ride, FM-Stabs
  TENSION 129-136   Acid-Solo, Filter-Sweep, Clap-Roll
  DROP 3  137-160   Finale, Acid offen, Hook oktaviert
  OUTRO   161-192   Abbau fuer den DJ-Mix
"""
from dataclasses import dataclass, field
import numpy as np

BPM = 145.0
BARS = 192
BEATS = BARS * 4
SPB = 60.0 / BPM  # Sekunden pro Beat

SECTIONS = [
    ("INTRO", 0), ("GROOVE", 16), ("BUILD", 32), ("DROP 1", 48),
    ("ACID", 64), ("BREAK", 80), ("RISE", 88), ("PEAK", 96),
    ("PEAK B", 112), ("TENSION", 128), ("DROP 3", 136), ("OUTRO", 160),
    ("DJ TOOL", 176),
]


@dataclass
class Note:
    start: float      # Beat
    dur: float        # Beats
    pitch: int        # MIDI
    vel: float = 1.0  # 0..1
    accent: bool = False
    slide: bool = False


def in_(bar, a, b):
    return a <= bar < b


def sx(bar, step):
    """Takt + 16tel -> Beat."""
    return bar * 4 + step * 0.25


# ------------------------------------------------------------------ Kick
def kick_hits():
    hits = []
    for bar in range(BARS):
        for beat in range(4):
            t = bar * 4 + beat
            if in_(bar, 80, 92):           # Break: keine Kick
                continue
            if in_(bar, 128, 134):          # Tension: keine Kick
                continue
            if bar == 47 or bar == 95 or bar == 135:
                # Luftloch vor dem Drop: nur Beat 1, danach Stille
                if beat == 0:
                    hits.append((t, 0.9))
                continue
            if bar in (134,) and beat in (0, 2):
                hits.append((t, 0.8))
                continue
            if bar == 134:
                continue
            if in_(bar, 92, 95):            # Kick-Comeback mit HP-Filter
                hits.append((t, 0.9))
                if bar == 94:
                    hits.append((t + 0.5, 0.7))
                continue
            hits.append((t, 1.0))
            # Phrasen-Fill: Doppelkick am Ende jeder 8-Takt-Phrase
            if bar % 8 == 7 and beat == 3 and in_(bar, 16, 176):
                hits.append((t + 0.75, 0.75))
    return hits


# ------------------------------------------------------------------ Rolling Bass
BASS_ROOT = 29  # F1


def bass_notes():
    notes = []
    # Grundzelle pro Beat: 16tel 2,3,4 (nicht auf der Kick)
    vel_cell = [0.0, 0.75, 1.0, 0.82]
    for bar in range(BARS):
        if not (in_(bar, 16, 80) or in_(bar, 92, 128) or in_(bar, 136, 184)):
            continue
        if bar in (47, 95):
            continue
        for beat in range(4):
            for st in (1, 2, 3):
                p = BASS_ROOT
                # Bewegung: Takt 4 jeder 4er-Gruppe faellt auf Eb/C
                if bar % 4 == 3 and beat == 3:
                    p = BASS_ROOT - 2 if st < 3 else BASS_ROOT + 7  # Eb0 -> C1
                if bar % 8 == 7 and beat >= 2:
                    p = BASS_ROOT + (12 if st == 2 else 0)
                if st == 2 and beat == 1 and bar % 2 == 1:
                    p = BASS_ROOT + 12  # Oktav-Pop fuer Bounce
                notes.append(Note(sx(bar, beat * 4 + st), 0.2, p, vel_cell[st]))
    return notes


# ------------------------------------------------------------------ Hook (Lead)
# 2-Takt Call/Response in f-Moll, 3-3-2 Rhythmus
HOOK_A = [  # (16tel, Dauer in 16teln, Pitch)
    (0, 2, 53), (3, 1, 60), (6, 2, 53), (9, 1, 56), (12, 2, 55), (14, 1, 51),
    (16, 2, 53), (19, 1, 60), (22, 2, 63), (25, 1, 60), (28, 1, 56), (30, 2, 55),
]
HOOK_B = HOOK_A[:6] + [  # Response steigt auf – Peak-Variation
    (16, 2, 53), (19, 1, 60), (22, 2, 65), (25, 1, 63), (27, 1, 60),
    (29, 1, 56), (31, 1, 55),
]


def hook_notes():
    notes = []
    for bar in range(0, BARS, 2):
        if in_(bar, 24, 80):
            pat = HOOK_A
        elif in_(bar, 80, 96):
            pat = HOOK_A
        elif in_(bar, 96, 112):
            pat = HOOK_A
        elif in_(bar, 112, 128):
            pat = HOOK_B
        elif in_(bar, 136, 160):
            pat = HOOK_B if (bar // 2) % 2 else HOOK_A
        else:
            continue
        for st, d, p in pat:
            b = bar + st // 16
            if b in (47, 95):            # Luftloch-Takte nur halb
                if st % 16 >= 8:
                    continue
            if in_(bar, 80, 88) and st % 16 >= 12:
                continue                  # Break: Raum lassen
            acc = st % 16 in (0, 6, 12)
            notes.append(Note(sx(bar, st), d * 0.25 * 0.9, p,
                              1.0 if acc else 0.8, accent=acc))
            if in_(bar, 136, 160) and acc:
                notes.append(Note(sx(bar, st), d * 0.25 * 0.9, p + 12, 0.55))
    return notes


# ------------------------------------------------------------------ Acid
# (Pitch-Offset zu F2, Accent, Slide) – None = Pause
ACID = [
    (0, 1, 0), (0, 0, 0), (12, 0, 1), (0, 0, 0),
    (3, 0, 0), (0, 1, 0), (7, 0, 1), (0, 0, 0),
    (0, 0, 0), None, (10, 1, 1), (0, 0, 0),
    (12, 0, 0), (2, 0, 0), (3, 1, 0), (7, 0, 1),
]
ACID_VAR = [  # zweite Haelfte jeder 4-Takt-Gruppe
    (0, 1, 0), (12, 0, 1), (0, 0, 0), (0, 0, 0),
    (3, 0, 1), (5, 1, 0), (0, 0, 0), (15, 0, 1),
    (12, 0, 0), None, (10, 1, 1), (7, 0, 0),
    (0, 0, 0), (12, 1, 1), (3, 0, 0), (-2, 0, 1),
]


def acid_notes():
    notes = []
    root = 41  # F2
    for bar in range(BARS):
        if not (in_(bar, 64, 80) or in_(bar, 96, 168)):
            continue
        if bar == 95:
            continue
        pat = ACID_VAR if bar % 4 == 3 else ACID
        for st, ev in enumerate(pat):
            if ev is None:
                continue
            off, acc, sl = ev
            if bar == 135 and st >= 4:
                continue
            notes.append(Note(sx(bar, st), 0.25 * (1.0 if sl else 0.55),
                              root + off, 1.0 if acc else 0.7,
                              accent=bool(acc), slide=bool(sl)))
    return notes


# ------------------------------------------------------------------ FM-Stabs
# Spannungsakkorde: Fm – Db – Eb – C (Dominante = Zug zum Drop)
CHORDS = [[53, 56, 60], [49, 53, 56], [51, 55, 58], [48, 52, 55]]


def stab_notes():
    notes = []
    for bar in range(BARS):
        ch = CHORDS[(bar // 2) % 4] if not in_(bar, 80, 96) else CHORDS[(bar - 80) // 4 % 4]
        if in_(bar, 80, 95):  # Break: 1 Akkord pro Takt, lang
            for p in ch:
                notes.append(Note(bar * 4, 1.5, p, 0.85))
        elif in_(bar, 104, 128) or in_(bar, 136, 160):
            # Offbeat-Stab auf der "und" von 3 alle 2 Takte + Antwort
            if bar % 2 == 0:
                for p in ch:
                    notes.append(Note(sx(bar, 10), 0.2, p + 12, 0.8))
            else:
                for p in ch:
                    notes.append(Note(sx(bar, 3), 0.15, p + 12, 0.6))
    return notes


# ------------------------------------------------------------------ Drums/Perc
def hat_events():
    """(beat, type, vel) type: c=closed o=open s=shaker"""
    ev = []
    cv = [0.55, 0.32, 1.0, 0.4]
    for bar in range(BARS):
        drop = in_(bar, 48, 80) or in_(bar, 96, 128) or in_(bar, 136, 168)
        for st in range(16):
            b = sx(bar, st)
            q = st % 4
            # Closed Hats
            if (in_(bar, 0, 80) or in_(bar, 92, 128) or in_(bar, 132, 192)) and bar not in (47, 95, 135):
                if in_(bar, 0, 8) and q != 2:
                    pass
                elif in_(bar, 8, 16) and q in (0,):
                    pass
                else:
                    v = cv[q] * (0.9 + 0.1 * np.sin(st * 1.7 + bar))
                    ev.append((b, "c", v))
            # Open Hat auf Offbeat
            if q == 2 and (drop or in_(bar, 32, 46) or in_(bar, 176, 188)) and bar not in (47, 95, 135):
                ev.append((b, "o", 0.85))
            # Shaker 16tel
            if (in_(bar, 16, 80) or in_(bar, 80, 96) or in_(bar, 96, 176)) and bar not in (47, 95, 135):
                ev.append((b, "s", [0.35, 0.6, 0.45, 0.75][q]))
    return ev


def ride_events():
    ev = []
    for bar in range(BARS):
        if in_(bar, 96, 136) or in_(bar, 140, 168):
            for st in range(0, 16, 2):
                if bar in (135,):
                    continue
                ev.append((sx(bar, st), 1.0 if st % 4 == 2 else 0.55))
    return ev


def clap_events():
    ev = []
    for bar in range(BARS):
        on = in_(bar, 32, 80) or in_(bar, 92, 128) or in_(bar, 136, 172)
        if bar in (47, 95):
            continue
        if on:
            ev.append((bar * 4 + 1, 1.0))
            ev.append((bar * 4 + 3, 1.0))
            if bar % 4 == 3:
                ev.append((sx(bar, 15), 0.45))  # Ghost
        # Clap-Roll in Tension
        if in_(bar, 132, 135):
            div = 2 if bar < 133 else (4 if bar < 134 else 8)
            n = 4 * div
            for k in range(n):
                ev.append((bar * 4 + k * 4.0 / n, 0.4 + 0.6 * (k / n)))
    return ev


PERC_A = [("rim", 3), ("rim", 6), ("tm", 7), ("rim", 10), ("tl", 11), ("rim", 13), ("th", 14)]
PERC_B = [("rim", 3), ("rim", 6), ("tl", 9), ("rim", 10), ("tl", 12), ("th", 14), ("th", 15)]


def perc_events():
    ev = []
    for bar in range(BARS):
        if not (in_(bar, 16, 168)):
            continue
        if bar in (47, 95, 135):
            continue
        pat = PERC_A if bar % 2 == 0 else PERC_B
        for kind, st in pat:
            if in_(bar, 16, 24) and kind != "rim":
                continue
            v = 0.9 if kind != "rim" else 0.6
            ev.append((sx(bar, st), kind, v))
        # Tom-Fill am Ende jeder 8er-Phrase
        if bar % 8 == 7:
            for k, st in enumerate([12, 13, 14, 15]):
                ev.append((sx(bar, st), ["th", "tm", "tm", "tl"][k], 0.8))
    return ev


def roll_events():
    """Snare-Roll vor den Drops: (beat, vel)."""
    ev = []
    # Build-Ende: Takte 45-47
    for bar, div in ((44, 2), (45, 4), (46, 4)):
        for k in range(4 * div):
            b = bar * 4 + k / div
            ev.append((b, 0.3 + 0.5 * ((b - 176) / 12)))
    # Break-Riser: Takte 88-95 beschleunigt
    for bar in range(88, 95):
        div = 1 if bar < 90 else (2 if bar < 92 else (4 if bar < 94 else 8))
        for k in range(4 * div):
            b = bar * 4 + k / div
            ev.append((b, 0.25 + 0.75 * ((b - 352) / 28)))
    return ev


# ------------------------------------------------------------------ Automation
def ramp(x, x0, x1, y0, y1, curve=1.0):
    t = np.clip((x - x0) / (x1 - x0), 0, 1) ** curve
    return y0 + (y1 - y0) * t


def exp_ramp(x, x0, x1, y0, y1):
    t = np.clip((x - x0) / (x1 - x0), 0, 1)
    return y0 * (y1 / y0) ** t


def hook_cutoff(beat):
    """Filter-Spannungsbogen des Hooks (Hz)."""
    bar = beat / 4.0
    c = np.full_like(beat, 300.0)
    lfo = 1.0 + 0.28 * np.sin(2 * np.pi * beat / 32.0)
    c = np.where(bar < 32, exp_ramp(bar, 24, 32, 220, 700), c)
    c = np.where((bar >= 32) & (bar < 48), exp_ramp(bar, 32, 47.5, 500, 4200), c)
    c = np.where((bar >= 48) & (bar < 80), 2300 * lfo, c)
    c = np.where((bar >= 80) & (bar < 88), exp_ramp(bar, 80, 84, 1800, 650), c)
    c = np.where((bar >= 88) & (bar < 96), exp_ramp(bar, 88, 95.75, 650, 7000), c)
    c = np.where((bar >= 96) & (bar < 128), 3300 * lfo, c)
    c = np.where((bar >= 136) & (bar < 160), 4200 * lfo, c)
    return c


def hook_gain(beat):
    bar = beat / 4.0
    g = np.zeros_like(beat)
    g = np.where((bar >= 24) & (bar < 32), ramp(bar, 24, 32, 0.25, 0.6), g)
    g = np.where((bar >= 32) & (bar < 80), 0.95, g)
    g = np.where((bar >= 80) & (bar < 96), 0.85, g)
    g = np.where((bar >= 96) & (bar < 128), 1.0, g)
    g = np.where((bar >= 136) & (bar < 160), 1.0, g)
    return g


def acid_cutoff(beat):
    bar = beat / 4.0
    c = np.full_like(beat, 400.0)
    sweep16 = 0.5 - 0.5 * np.cos(2 * np.pi * (bar - 96) / 16.0)
    c = np.where((bar >= 64) & (bar < 80), exp_ramp(bar, 64, 80, 260, 1600), c)
    c = np.where((bar >= 96) & (bar < 128), 500 * (5.0 ** sweep16), c)
    c = np.where((bar >= 128) & (bar < 136), exp_ramp(bar, 128, 135.5, 350, 5200), c)
    c = np.where((bar >= 136) & (bar < 160), 900 * (4.5 ** (0.5 - 0.5 * np.cos(2 * np.pi * (bar - 136) / 8.0))), c)
    c = np.where((bar >= 160) & (bar < 168), exp_ramp(bar, 160, 168, 1600, 220), c)
    return c


def acid_res(beat):
    bar = beat / 4.0
    r = np.full_like(beat, 0.78)
    r = np.where((bar >= 128) & (bar < 136), ramp(bar, 128, 136, 0.8, 0.93), r)
    return r


def bass_cutoff(beat):
    bar = beat / 4.0
    c = np.full_like(beat, 1100.0)
    c = np.where(bar < 32, exp_ramp(bar, 16, 32, 180, 900), c)
    c = np.where((bar >= 32) & (bar < 48), 950.0, c)
    c = np.where((bar >= 92) & (bar < 96), exp_ramp(bar, 92, 96, 200, 1100), c)
    c = np.where((bar >= 168) & (bar < 184), exp_ramp(bar, 168, 184, 1100, 140), c)
    return c


def kick_hp(beat):
    """Hochpass auf der Kick fuer das Comeback vor dem Peak."""
    bar = beat / 4.0
    h = np.full_like(beat, 10.0)
    h = np.where((bar >= 92) & (bar < 96), exp_ramp(bar, 92, 95, 600, 120), h)
    return h


def rumble_gain(beat):
    bar = beat / 4.0
    g = np.ones_like(beat)
    g = np.where(bar < 8, ramp(bar, 0, 8, 0.55, 1.0), g)
    g = np.where((bar >= 80) & (bar < 96), 0.0, g)
    g = np.where((bar >= 128) & (bar < 136), 0.0, g)
    g = np.where((bar >= 32) & (bar < 48), ramp(bar, 32, 47, 1.0, 0.6), g)
    return g
