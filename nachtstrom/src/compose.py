"""NACHTSTROM v2 – raw / hypnotic / trippy. 145 BPM, F-Phrygisch, 192 Takte.

Keine EDM-Dramaturgie: keine Snare-Rolls, Riser, Impacts, Crashes,
keine Akkorde, kein Melodie-Hook, kein Acid, keine Stille vor dem Drop.
Spannung entsteht durch Bewegung: Polymetrik (7/16 und 3/16 gegen 4/4),
Mutationen alle 4-8 Takte, nicht taktsynchrone Filter-LFOs, Tape-Wobble.

  INTRO       1-16   Kick, Rumble, Rim-Dub-Echos; ab 9 die Sequenz (zu)
  GROOVE     17-32   Dirty Bass, Hats, euklidische Perc, Stimme blitzt auf
  DRIVE      33-48   Clap mit Raum, 3/16-Bleeps, Sequenz mutiert
  MAIN 1     49-64   alles laeuft, Sequenz atmet weit
  MAIN 1B    65-80   Sequenz wechselt auf 5/16, Rumble galoppiert, Voice-Chops
  TRIP       81-92   Kick + Bass raus, Sequenz im eiernden Tape-Delay, Chant
  RETURN     93-96   Kick kommt gefiltert zurueck
  MAIN 2    97-112   volle Hypnose, Ride
  MAIN 2B  113-128   Sequenz in 5/16 + Oktave, Shaker-Triolen (Polyrhythmus)
  TRIP 2   129-136   nur Sequenz, Bleeps, Stimme, Delay
  FINAL    137-160   Mutation alle 4 Takte
  OUTRO    161-176   Abbau
  DJ TOOL  177-192   Kick, Rumble, Hats, Perc
"""
import zlib
from dataclasses import dataclass
import numpy as np

BPM = 145.0
BARS = 192
BEATS = BARS * 4
SPB = 60.0 / BPM

SECTIONS = [
    ("INTRO", 0), ("GROOVE", 16), ("DRIVE", 32), ("MAIN 1", 48),
    ("MAIN 1B", 64), ("TRIP", 80), ("RETURN", 92), ("MAIN 2", 96),
    ("MAIN 2B", 112), ("TRIP 2", 128), ("FINAL", 136), ("OUTRO", 160),
    ("DJ TOOL", 176),
]

PHRYG = [0, 1, 3, 5, 7, 8, 10, 12, 13, 15]  # F Gb Ab Bb C Db Eb F ...


@dataclass
class Note:
    start: float
    dur: float
    pitch: int
    vel: float = 1.0
    accent: bool = False
    v0: float = 0.0  # Vokal Start (0=a 1=o 2=i 3=u 4=e)
    v1: float = 0.0  # Vokal Ende


SWING = 0.032  # Beats Verzoegerung auf jede zweite 16tel (~56 % Shuffle)


def sw(bar, step, amt=SWING):
    """16tel-Position mit Shuffle auf den geraden 16teln."""
    return bar * 4 + step * 0.25 + (amt if step % 2 == 1 else 0.0)


def in_(bar, a, b):
    return a <= bar < b


def sx(bar, step):
    return bar * 4 + step * 0.25


def rng_for(*key):
    return np.random.default_rng(zlib.crc32(repr(("nachtstrom",) + key).encode()))


def euclid(k, n, rot=0):
    pat = [((i * k) % n) < k for i in range(n)]
    return pat[-rot % n:] + pat[:-rot % n]


TRIP = lambda bar: in_(bar, 80, 92) or in_(bar, 128, 136)


# ------------------------------------------------------------------ Kick
def kick_hits():
    hits = []
    for bar in range(BARS):
        if TRIP(bar):
            continue
        for beat in range(4):
            v = 1.0
            if in_(bar, 92, 96):
                v = 0.95
            hits.append((bar * 4 + beat, v))
    return hits


# ------------------------------------------------------------------ Dirty Bass
BASS_CELLS = [  # Velocity pro 16tel innerhalb eines Beats (0 = Kick-Platz)
    [0.0, 0.7, 1.0, 0.8],
    [0.0, 1.0, 0.0, 0.85],
    [0.0, 0.0, 1.0, 0.9],
    [0.0, 0.75, 1.0, 0.0],
]


def bass_active(bar):
    return in_(bar, 16, 80) or in_(bar, 96, 128) or in_(bar, 136, 172)


def bass_notes():
    notes = []
    for bar in range(BARS):
        if not bass_active(bar):
            continue
        block = bar // 8
        cell = BASS_CELLS[[0, 0, 1, 0, 2, 0, 3, 1][block % 8]]
        r = rng_for("bass", bar)
        for beat in range(4):
            for st in (1, 2, 3):
                vel = cell[st]
                if vel == 0:
                    continue
                p = 29  # F1
                if bar % 4 == 3 and beat == 3 and st == 3:
                    p = 30  # Gb1 – phrygischer Dreh
                if bar % 8 == 7 and beat == 2 and st == 2:
                    p = 27  # Eb1 drunter
                if r.random() < 0.06:
                    p = 41  # gelegentlicher Oktav-Pop
                notes.append(Note(sw(bar, beat * 4 + st), 0.22, p, vel * (0.92 + 0.08 * r.random())))
    return notes


# ------------------------------------------------------------------ Hypno-Sequenz (Polymeter)
SEQ7 = [(0, 1), (12, 0), (1, 0), (0, 1), (7, 0), (3, 0), (10, 0)]
SEQ5 = [(0, 1), (13, 0), (0, 0), (7, 1), (12, 0)]


def seq_active(bar):
    return in_(bar, 8, 168)


def seq_pattern(bar):
    """Pattern mit Mutationen: neue Variante alle 8 (Final: 4) Takte."""
    base = SEQ5 if (in_(bar, 64, 80) or in_(bar, 112, 128)) else SEQ7
    pat = [list(s) for s in base]
    period = 4 if in_(bar, 136, 160) else 8
    gen = max(0, (bar - 16)) // period
    for g in range(gen):
        r = rng_for("seqmut", len(base), g)
        if r.random() < 0.7:
            i = int(r.integers(1, len(pat)))
            pat[i][0] = int(r.choice(PHRYG))
    if in_(bar, 112, 128):
        for s in pat[1::2]:
            s[0] += 12
    return pat


def seq_notes():
    notes = []
    k = 0  # globaler 16tel-Zaehler -> Polymeter laeuft ueber Taktgrenzen
    for bar in range(BARS):
        if not seq_active(bar):
            continue
        pat = seq_pattern(bar)
        for st in range(16):
            step = pat[k % len(pat)]
            k += 1
            off, acc = step
            r = rng_for("seqgate", bar, st)
            if not acc and r.random() < 0.14:
                continue
            notes.append(Note(sw(bar, st, SWING * 0.6), 0.34 if acc else 0.2, 41 + off,
                              1.0 if acc else 0.62 + 0.15 * r.random(), accent=bool(acc)))
    return notes


# ------------------------------------------------------------------ 3/16-Bleeps
BLEEP_P = [65, 65, 66, 65, 63]  # F4 F4 Gb4 F4 Eb4 – metallisch, keine Melodie


def bleep_notes():
    notes = []
    k = 0
    for bar in range(BARS):
        on = in_(bar, 36, 48) or in_(bar, 96, 128) or in_(bar, 128, 136) or in_(bar, 140, 160)
        for st in range(16):
            gi = bar * 16 + st
            if gi % 3 != 0:
                continue
            if on:
                vel = 0.5 if bar < 48 else 0.8
                notes.append(Note(sx(bar, st), 0.12, BLEEP_P[k % 5], vel))
                k += 1
    return notes


# ------------------------------------------------------------------ Formant-Stimme
def voice_notes():
    notes = []
    for bar in range(BARS):
        r = rng_for("voice", bar)
        if in_(bar, 24, 32) and bar % 4 == 2:
            notes.append(Note(sx(bar, 6), 1.5, 53, 0.6, v0=0, v1=1))
        if (in_(bar, 64, 80) or in_(bar, 112, 128) or in_(bar, 144, 160)) and bar % 2 == 1:
            for st, d in ((2, 0.5), (7, 0.25), (10, 0.75)):
                if r.random() < 0.85:
                    v = float(r.integers(0, 5))
                    notes.append(Note(sx(bar, st), d, 53 if r.random() < 0.8 else 54, 0.8,
                                      v0=v, v1=(v + 1.5) % 5))
        if TRIP(bar) and bar % 2 == 0:
            notes.append(Note(bar * 4, 3.0, 53 if bar % 8 < 6 else 54, 0.75,
                              v0=float(bar % 5), v1=float((bar + 2) % 5)))
    return notes


# ------------------------------------------------------------------ Drums/Perc
def hat_events():
    ev = []
    for bar in range(BARS):
        r = rng_for("hats", bar)
        trip = TRIP(bar)
        for st in range(16):
            b = sw(bar, st)
            q = st % 4
            if in_(bar, 0, 8):
                if q == 2:
                    ev.append((b, "c", 0.8))
            elif in_(bar, 8, 176) or in_(bar, 176, 192):
                if trip and q != 2 and r.random() < 0.5:
                    continue
                v = [0.5, 0.3, 1.0, 0.38][q] * (0.8 + 0.25 * r.random())
                if q in (1, 3) and r.random() < 0.12:
                    continue
                ev.append((b, "c", v))
            if q == 2 and in_(bar, 16, 188) and not trip:
                ev.append((b, "o", 0.8))
        # Shaker-Triolen: 12 pro Takt gegen die 16tel
        if in_(bar, 112, 128) or in_(bar, 144, 160):
            for t in range(12):
                ev.append((bar * 4 + t / 3.0, "s", [0.7, 0.35, 0.5][t % 3]))
    return ev


def ride_events():
    ev = []
    for bar in range(BARS):
        if in_(bar, 96, 128) or in_(bar, 136, 168):
            for st in (2, 6, 10, 14):
                ev.append((sx(bar, st), 1.0))
    return ev


def clap_events():
    ev = []
    for bar in range(BARS):
        if in_(bar, 32, 40):
            ev.append((bar * 4 + 3, 0.9))
        elif in_(bar, 40, 80) or in_(bar, 96, 128) or in_(bar, 136, 168):
            ev.append((bar * 4 + 1, 1.0))
            ev.append((bar * 4 + 3, 1.0))
    return ev


def perc_events():
    """Euklidische Perc, rotiert jede 8-Takt-Gruppe."""
    ev = []
    for bar in range(BARS):
        block = bar // 8
        r = rng_for("perc", bar)
        rim = euclid(5, 16, (block * 3) % 16)
        tom = euclid(3, 16, (block * 5 + 2) % 16)
        cga = euclid(7, 16, (block * 2 + 1) % 16)
        for st in range(16):
            b = sw(bar, st) + 0.004 * (r.random() - 0.5)
            if rim[st] and in_(bar, 0, 184):
                ev.append((b, "rim", 0.55 + 0.25 * r.random()))
            if tom[st] and in_(bar, 16, 176) and not TRIP(bar):
                ev.append((b, ["tl", "tm"][block % 2], 0.8))
            if cga[st] and in_(bar, 48, 168) and r.random() < 0.85:
                ev.append((b, "cg" if r.random() < 0.6 else "ch", 0.55 + 0.3 * r.random()))
    return ev


# ------------------------------------------------------------------ Automation
def ramp(x, x0, x1, y0, y1):
    t = np.clip((x - x0) / (x1 - x0), 0, 1)
    return y0 + (y1 - y0) * t


def exp_ramp(x, x0, x1, y0, y1):
    t = np.clip((x - x0) / (x1 - x0), 0, 1)
    return y0 * (y1 / y0) ** t


def lfo(beat, period, phase=0.0):
    return np.sin(2 * np.pi * beat / period + phase)


def seq_cutoff(beat):
    """Filterbewegung der Sequenz: zwei nicht taktsynchrone LFOs + Sections."""
    bar = beat / 4.0
    base = np.full_like(beat, 300.0)
    base = np.where(bar < 16, exp_ramp(bar, 8, 16, 220, 450), base)
    base = np.where((bar >= 16) & (bar < 32), exp_ramp(bar, 16, 32, 450, 900), base)
    base = np.where((bar >= 32) & (bar < 48), exp_ramp(bar, 32, 48, 900, 1400), base)
    base = np.where((bar >= 48) & (bar < 80), 1500.0, base)
    base = np.where((bar >= 80) & (bar < 96), exp_ramp(bar, 80, 96, 650, 1500), base)
    base = np.where((bar >= 96) & (bar < 128), 1900.0, base)
    base = np.where((bar >= 128) & (bar < 136), exp_ramp(bar, 128, 136, 500, 2400), base)
    base = np.where((bar >= 136) & (bar < 160), 2200.0, base)
    base = np.where(bar >= 160, exp_ramp(bar, 160, 168, 1500, 250), base)
    m = 2.0 ** (1.1 * lfo(beat, 13.0) + 0.5 * lfo(beat, 37.0, 1.0))
    return base * m * 0.6  # eher dunkel & dubby statt bissig


def seq_fold(beat):
    bar = beat / 4.0
    f = 0.9 + 0.4 * (0.5 + 0.5 * lfo(beat, 29.0, 2.0))
    f = f + np.where((bar >= 96) & (bar < 128), 0.25, 0.0) + np.where((bar >= 136) & (bar < 160), 0.4, 0.0)
    return f


def seq_wow(beat):
    """Tape-Wobble-Tiefe (ms) im Delay der Sequenz."""
    bar = beat / 4.0
    w = np.full_like(beat, 1.2)
    w = np.where(TRIP_MASK(bar), 7.0, w)
    return w


def TRIP_MASK(bar):
    return ((bar >= 80) & (bar < 92)) | ((bar >= 128) & (bar < 136))


def seq_delay_send(beat):
    bar = beat / 4.0
    return np.where(TRIP_MASK(bar), 0.65, 0.28)


def bass_cutoff(beat):
    bar = beat / 4.0
    c = 380 * 2.0 ** (0.35 * lfo(beat, 23.0))
    c = np.where(bar < 32, exp_ramp(bar, 16, 32, 160, 380), c)
    c = np.where(bar >= 164, exp_ramp(bar, 164, 172, 380, 110), c)
    return c


def kick_hp(beat):
    bar = beat / 4.0
    return np.where((bar >= 92) & (bar < 96), exp_ramp(bar, 92, 96, 700, 20), 10.0)


RUMBLE_CELLS = [
    [0.0, 0.6, 1.0, 0.8],
    [0.0, 1.0, 0.35, 1.0],
    [0.0, 0.45, 0.8, 1.0],
]


def rumble_shape(beat):
    bar = (beat / 4.0).astype(int)
    block = bar // 8
    sel = np.array([0, 0, 1, 0, 2, 1, 0, 2])[block % 8]
    ph = beat % 1.0
    idx = np.minimum((ph * 4).astype(int), 3)
    cells = np.array(RUMBLE_CELLS)
    lev = cells[sel, idx]
    # weiche Uebergaenge innerhalb der 16tel
    sub = (ph * 4) % 1.0
    env = np.clip(sub / 0.15, 0, 1) * (1 - 0.3 * sub)
    return lev * env


def rumble_gain(beat):
    bar = beat / 4.0
    g = np.ones_like(beat)
    g = np.where(bar < 8, ramp(bar, 0, 8, 0.6, 1.0), g)
    g = np.where(TRIP_MASK(bar) | ((bar >= 92) & (bar < 96)), 0.0, g)
    return g


def rumble_cutoff(beat):
    return 150 * 2.0 ** (0.4 * lfo(beat, 19.0, 0.5))
