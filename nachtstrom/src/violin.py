"""Violine als Synthese (kostenlos, ohne Samples): gestrichene Saite + Geigenkorpus.

- Saite: bandbegrenzter Saegezahn (Helmholtz-Bewegung der gestrichenen Saite) mit
  minimalem Perioden-Jitter
- Spiel: Slides zwischen den Toenen (Portamento in Halbtoenen), kleiner "Scoop" in jeden
  Ton, verzoegertes Vibrato (5,6 Hz, langsam einsetzend), Bogenwechsel mit kurzem Absacken,
  Bogen-Biss im Anschlag, leichtes An- und Abschwellen
- Bogengeraeusch: gefiltertes Rauschen, folgt der Lautstaerke
- Korpus: Resonanzen bei ~280 Hz (Luft), ~460 Hz, ~1 kHz, "Bridge Hill" 2,4-3,4 kHz
"""
import numpy as np

from dsp import SR, saw, pulse, bp, hp, lp, smooth

BODY = [(280.0, 0.9, 0.82), (460.0, 0.75, 0.82), (1000.0, 0.5, 0.75), (2500.0, 0.95, 0.62), (3300.0, 0.55, 0.72)]


def _onepole(x, tau):
    a = np.exp(-1.0 / (tau * SR))
    from scipy.signal import lfilter
    y, _ = lfilter([1 - a], [1, -a], x, zi=[x[0] * a])
    return y


def line(notes, spb, seed=0, octave=0, vib_depth=0.22, detune=0.0, bite=1.0, tail=1.4):
    """notes: [(start16, len16, midi)] relativ zum Phrasenbeginn -> Mono-Signal."""
    rng = np.random.default_rng(seed)
    s16 = spb / 4.0
    end = max(st + ln for st, ln, _ in notes)
    n = int((end * s16 + tail) * SR)
    pitch = np.zeros(n)
    bounds = []
    for st, ln, m in notes:
        a, b = int(st * s16 * SR), int((st + ln) * s16 * SR)
        pitch[a:b] = m + 12 * octave + detune
        bounds.append((a, b))
    pitch[bounds[-1][1]:] = pitch[bounds[-1][1] - 1]
    pitch[:bounds[0][0]] = pitch[bounds[0][0]]
    p = _onepole(pitch, 0.032)                                   # Slides zwischen den Toenen
    scoop = np.zeros(n)
    vdep = np.zeros(n)
    amp = np.zeros(n)
    for i, (a, b) in enumerate(bounds):
        L = b - a
        tt = np.arange(L) / SR
        scoop[a:b] += -0.28 * np.exp(-tt / 0.045)                # leicht von unten in den Ton
        vdep[a:b] = vib_depth * np.clip((tt - 0.14) / 0.3, 0.0, 1.0)
        att = np.minimum(tt / 0.045, 1.0)
        biteenv = 1.0 + 0.18 * bite * np.exp(-((tt - 0.03) / 0.02) ** 2)
        swell = 0.86 + 0.14 * np.minimum(tt / max(L / SR, 0.2), 1.0)
        env = att * biteenv * swell
        nxt = bounds[i + 1][0] if i + 1 < len(bounds) else None
        if nxt is not None and nxt <= b + int(0.005 * SR):        # Bogenwechsel: kurzes Absacken
            d = int(0.03 * SR)
            env[-d:] *= np.linspace(1.0, 0.62, d)
        amp[a:b] = np.maximum(amp[a:b], env)
    a_last, b_last = bounds[-1]
    rel = np.arange(n - b_last) / SR
    amp[b_last:] = amp[b_last - 1] * np.exp(-rel / 0.11)
    amp = smooth(amp, int(0.004 * SR))
    rate = 5.6 + 0.35 * smooth(rng.standard_normal(n), int(0.4 * SR)) * 6
    vib = vdep * np.sin(np.cumsum(2 * np.pi * rate / SR) + rng.uniform(0, 6.28))
    jitter = 0.012 * smooth(rng.standard_normal(n), int(0.01 * SR)) * 4
    f = 440.0 * 2.0 ** ((p + scoop + vib + jitter - 69.0) / 12.0)
    osc = saw(f, rng.uniform()) + 0.16 * pulse(f, 0.32, rng.uniform())
    noise = rng.standard_normal(n)
    bow = bp(noise, 3200.0, 0.3) * 0.05 + hp(noise, 6500.0) * 0.012
    sig = osc * amp + bow * amp ** 1.5
    # Bogen-Biss: kurzer Geraeusch-Impuls im Anschlag
    for a, b in bounds:
        k = min(int(0.025 * SR), b - a)
        burst = bp(rng.standard_normal(k), 2200.0, 0.4) * np.exp(-np.arange(k) / (0.008 * SR)) * 0.22 * bite
        sig[a:a + k] += burst
    body = 0.45 * sig
    for fc, g, r in BODY:
        body = body + g * bp(sig, fc, r)
    body = lp(hp(body, 185.0), 7200.0)
    return body / (np.max(np.abs(body)) + 1e-9)


def ensemble(notes, spb, seed=0, octave=0, solo=False):
    """Solo: eine Geige (Mono). Sonst: Haupt-Geige + zwei leicht verstimmte Pulte L/R
    + leise Oktave tiefer (Bratsche) -> breiter, kraeftiger Hook."""
    main = line(notes, spb, seed=seed, octave=octave)
    if solo:
        return np.array([main, main])
    l2 = line(notes, spb, seed=seed + 11, octave=octave, detune=+0.07, bite=0.6)
    r2 = line(notes, spb, seed=seed + 23, octave=octave, detune=-0.06, bite=0.6)
    lo = line(notes, spb, seed=seed + 37, octave=octave - 1, vib_depth=0.16, bite=0.7)
    d = int(0.012 * SR)
    l2 = np.concatenate([np.zeros(d), l2[:-d]])
    out_l = main + 0.45 * l2 + 0.32 * lo
    out_r = main + 0.45 * r2 + 0.32 * lo
    return np.array([out_l, out_r]) / (1.0 + 0.45 + 0.32)
