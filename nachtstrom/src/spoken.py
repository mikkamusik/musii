"""Macht aus den TTS-Phrasen eine sexy, gehauchte Nahbesprechungs-Stimme.

Kette pro Phrase:
  1. 22,05 -> 44,1 kHz, einen Halbton tiefer (dunkler, ruhiger)
  2. Hauch: LPC-Fluesterstimme (gleiche Artikulation, Rauschen statt Stimmbaender)
     wird unter die Stimme gemischt -> atmig statt vorgelesen
  3. "Luft" ueber 9 kHz: Rauschen, das der Huellkurve der Zischlaute folgt
  4. Nahbesprechung: Bass-Waerme 180 Hz, weniger Mulm um 500 Hz, De-Esser
  5. Kompressor (holt Atem und Lippengeraeusche nach vorn) + leichte Roehre

python3 spoken.py <tts-ordner> <ausgabe-ordner>
"""
import os
import sys

import librosa
import numpy as np
import soundfile as sf
from scipy.signal import lfilter, resample_poly

from dsp import SR, compressor, hp, lp, svf, smooth

# wie stark gehaucht: Anteil Fluesterstimme (0 = normal, 1 = nur Fluestern)
BREATHY = {"DEJATE": 0.1, "PROFUNDO": 0.08, "CORRIENTE": 0.22, "SIGUE": 0.1, "NOPARES": 0.08}   # v15: kaum Rauschen


def whisperize(x, order=28, frame=0.028, hop=0.007, seed=7):
    """LPC-Fluestern: Spektralhuelle pro Frame, angeregt mit Rauschen."""
    n = len(x)
    L, H = int(frame * SR), int(hop * SR)
    win = np.hanning(L)
    out = np.zeros(n + L)
    norm = np.zeros(n + L)
    rng = np.random.default_rng(seed)
    for i in range(0, n - L, H):
        seg = x[i:i + L] * win
        if np.max(np.abs(seg)) < 1e-4:
            continue
        a = librosa.lpc(seg, order=order)
        if not np.all(np.isfinite(a)):
            continue
        g = np.sqrt(np.mean(lfilter(a, [1.0], seg) ** 2))
        y = lfilter([1.0], a, rng.standard_normal(L) * g)
        out[i:i + L] += y * win
        norm[i:i + L] += win ** 2
    return out[:n] / np.maximum(norm[:n], 1e-3)


def shelf(x, fc, gain_db, high=True):
    g = 10 ** (gain_db / 20) - 1
    return x + g * (hp(x, fc) if high else lp(x, fc))


def peak(x, fc, gain_db, res=0.4):
    g = 10 ** (gain_db / 20) - 1
    return x + g * svf(x, np.full(len(x), float(fc)), res, 1)


def deess(x, fc=4500, rel_db=-14.0, depth=1.0):
    """Relativer De-Esser: Zischlaute nie lauter als (Gesamtpegel + rel_db) -> weich statt scharf."""
    s = hp(x, fc)
    n = int(0.004 * SR)
    sib = smooth(np.abs(s), n)
    full = smooth(np.abs(x), n)
    over = 20 * np.log10((sib + 1e-9) / (full + 1e-9)) - rel_db
    red = np.clip(over, 0, 20) * depth
    return x - s + s * 10 ** (-smooth(red, n) / 20)


def soft_s(x, fc=4000, below_db=24.0):
    """Zischlaute deckeln: nie lauter als (lautester Vokal - below_db) -> weiches, gehauchtes S.
    Breitbandig geregelt: Im S steckt fast nur Hoehe, ein Hochpass-Split liesse den unteren Teil durch."""
    s = hp(hp(x, fc), fc)                     # steil, nur zur Erkennung
    n = int(0.005 * SR)
    sib = smooth(np.abs(s), n)
    ref = np.max(smooth(np.abs(lp(x, 3000)), n)) * 10 ** (-below_db / 20)
    gain = smooth(np.minimum(1.0, ref / (sib + 1e-9)), n)
    return x * gain


def gate(x, open_db=-34.0, close_db=-46.0):
    """Sanftes Gate/Expander: unter close_db (relativ zur Spitze) zu, ab open_db ganz offen."""
    env = smooth(np.abs(x), int(0.012 * SR))
    lvl = 20 * np.log10(env / (np.max(env) + 1e-12) + 1e-12)
    g = np.clip((lvl - close_db) / (open_db - close_db), 0.0, 1.0)
    return x * smooth(g, int(0.02 * SR))


def sexy(x22, breathy):
    x = resample_poly(x22, 2, 1)
    x = librosa.effects.pitch_shift(x, sr=SR, n_steps=-1.0, bins_per_octave=12)
    x = hp(x, 70)
    w = whisperize(x)
    w = w / (np.std(w) + 1e-9) * np.std(x)
    y = (1 - breathy) * x + breathy * 1.15 * w
    # Luft: Rauschen ueber 9 kHz folgt der Zischlaut-Huellkurve (TTS endet bei 11 kHz)
    env = smooth(np.abs(w), int(0.01 * SR))          # folgt dem ganzen Hauch, nicht nur den Zischlauten
    air = hp(np.random.default_rng(3).standard_normal(len(y)), 8000) * env
    y = y + 0.0 * air                         # v15: kein Luft-Rauschen mehr
    y = shelf(y, 180, 2.5, high=False)       # Naehe / Waerme
    y = peak(y, 500, -3.0)                    # weniger Mulm
    y = peak(y, 2800, 1.5)                    # Praesenz
    y = shelf(y, 5000, 3.0, high=True)        # Glanz & Luft
    y = deess(y)
    y = y / (np.max(np.abs(y)) + 1e-9) * 0.5
    y = compressor(np.stack([y, y]), y, -22.0, 2.5, 5.0, 120.0, 4.0)[0]   # sanfter: zieht kein Grundrauschen hoch
    y = soft_s(y)                             # nach dem Kompressor: der hebt Zischlaute sonst wieder an
    y = gate(y)                               # zwischen den Silben: Ruhe statt Rauschen
    y = np.tanh(1.3 * y) / np.tanh(1.3)
    fade = int(0.01 * SR)
    y[:fade] *= np.linspace(0, 1, fade)
    y[-fade:] *= np.linspace(1, 0, fade)
    return y / (np.max(np.abs(y)) + 1e-9) * 0.9


def trim(x, thresh_db=-50):
    e = smooth(np.abs(x), int(0.005 * SR))
    idx = np.nonzero(e > np.max(e) * 10 ** (thresh_db / 20))[0]
    if len(idx) == 0:
        return x
    a, b = max(0, idx[0] - int(0.01 * SR)), min(len(x), idx[-1] + int(0.06 * SR))
    return x[a:b]


def main(tts_dir, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    for key, br in BREATHY.items():
        x, sr = sf.read(os.path.join(tts_dir, f"TTS_{key}.wav"))
        assert sr == 22050, sr
        y = trim(sexy(x, br))
        sf.write(os.path.join(out_dir, f"SPK_{key}.flac"), y, SR, subtype="PCM_24")
        print(f"SPK_{key}: {len(y) / SR:.2f}s")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
