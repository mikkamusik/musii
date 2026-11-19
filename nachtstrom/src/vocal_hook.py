"""Baut aus dem gesungenen ElevenLabs-Take den viralen Vocal-Hook.

Erwartete Reihenfolge im Take (durch lange Pausen getrennt):
  1. [singing] "Déjate caer… déjate caer…"
  2. [singing] "más profundo…"
  3. [whispers] "corriente nocturna"
  4. [softly] "sigue"

Ablauf: Phrasen finden -> Silben an Energie-Tälern schneiden -> jede Silbe per
Tonhöhenmessung (pYIN) auf ihren Melodieton aus compose.HOOK stimmen ->
Länge ans 16tel-Raster anpassen -> 4-Takt-Hook zusammensetzen.

python3 vocal_hook.py <take.mp3> <ausgabe-ordner>
"""
import io
import subprocess
import sys

import librosa
import numpy as np
import soundfile as sf
from scipy.signal import butter, sosfiltfilt

import compose as C

SR = 44100
S16 = 60.0 / C.BPM / 4


def load(path):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-f", "wav", "-ac", "1", "-ar", str(SR), "-"],
                         capture_output=True, check=True).stdout
    x, _ = sf.read(io.BytesIO(raw))
    return x


def envelope(x, hop=0.01):
    h = int(hop * SR)
    band = sosfiltfilt(butter(4, [250, 3500], "band", fs=SR, output="sos"), x)
    e = np.array([np.sqrt(np.mean(band[i:i + h] ** 2)) for i in range(0, len(band) - h, h)])
    return 20 * np.log10(e + 1e-9), h


def phrases(x, min_gap):
    edb, h = envelope(x)
    act = edb > edb.max() - 35
    gap = int(min_gap / 0.01)
    segs, i = [], 0
    while i < len(act):
        if act[i]:
            j = i
            while j < len(act) and (act[j] or act[j:j + gap].any()):
                j += 1
            if (j - i) * 0.01 > 0.08:
                segs.append((i * h, min(len(x), j * h)))
            i = j
        else:
            i += 1
    return segs


def syllables(seg, k):
    """k Silben: Grenzen an den k-1 tiefsten Energie-Tälern (Mindestabstand 70 ms)."""
    edb, h = envelope(seg)
    sm = np.convolve(edb, np.ones(3) / 3, mode="same")
    mins = [i for i in range(3, len(sm) - 3) if sm[i] <= sm[i - 1] and sm[i] <= sm[i + 1]]
    mins.sort(key=lambda i: sm[i])
    chosen = []
    for i in mins:
        if all(abs(i - c) >= 7 for c in chosen) and 4 <= i <= len(sm) - 4:
            chosen.append(i)
        if len(chosen) == k - 1:
            break
    if len(chosen) < k - 1:                       # Fallback: gleichmäßig teilen
        chosen = [int(len(sm) * (n + 1) / k) for n in range(k - 1)]
    cuts = [0] + sorted(c * h for c in chosen) + [len(seg)]
    return [seg[a:b] for a, b in zip(cuts[:-1], cuts[1:])]


def tune(y, target_midi):
    f0, vf, _ = librosa.pyin(y, fmin=80, fmax=1000, sr=SR, frame_length=2048, hop_length=256)
    f = f0[vf] if vf is not None else np.array([])
    cur = librosa.hz_to_midi(np.nanmedian(f)) if len(f) else target_midi
    n = target_midi - cur
    n = float(n - 12 * np.round(n / 12))          # Oktav-Faltung: nur die Tonklasse zählt, minimaler Shift
    return librosa.effects.pitch_shift(y, sr=SR, n_steps=n), cur


def fit(y, seconds):
    L = int(seconds * SR)
    if len(y) > L:
        y = y[:L].copy()
    elif len(y) < 0.7 * L:
        y = librosa.effects.time_stretch(y, rate=max(0.5, len(y) / (0.85 * L)))[:L]
    f = min(len(y) // 3, int(0.012 * SR))
    if f > 0:
        y[:f] *= np.linspace(0, 1, f)
        y[-f:] *= np.linspace(1, 0, f)
    return y


def build(take, out_dir):
    x = load(take)
    groups = phrases(x, 0.6)                       # lange Pausen trennen die 4 Teile
    print("Teile im Take:", [(round(a / SR, 2), round(b / SR, 2)) for a, b in groups])
    if len(groups) < 4:
        raise SystemExit(f"Erwartet 4 Teile, gefunden {len(groups)} – Take prüfen.")
    g1, g2, g3, g4 = [x[a:b] for a, b in groups[:4]]
    sub = phrases(g1, 0.15)
    first = g1[sub[0][0]:sub[0][1]] if len(sub) >= 2 else g1
    syl_dejate = syllables(first, 5)              # de-ja-te-ca-er
    syl_mas = syllables(g2, 4)                    # mas-pro-fun-do
    pool = {"de": syl_dejate[0], "ja": syl_dejate[1], "te": syl_dejate[2], "ca": syl_dejate[3],
            "er": syl_dejate[4], "mas": syl_mas[0], "pro": syl_mas[1], "fun": syl_mas[2], "do": syl_mas[3]}
    hook = np.zeros(int(16 * 4 * S16 * SR) + SR)
    for st, ln, midi, syl in C.HOOK:
        y, cur = tune(pool[syl], midi)
        y = fit(y, ln * S16 * 1.05)
        s = int(st * S16 * SR)
        hook[s:s + len(y)] += y
        print(f"  {syl:4s} gemessen {cur:5.1f} -> Ziel {midi} ({librosa.midi_to_note(midi)})")
    hook = hook / (np.max(np.abs(hook)) + 1e-9) * 10 ** (-1 / 20)
    sf.write(f"{out_dir}/HOOK_ES.flac", hook, SR, subtype="PCM_24")
    for name, seg in (("VOX_ES_1_CORRIENTE", g3), ("VOX_ES_2_MAS_PROFUNDO", g2),
                      ("VOX_ES_3_DEJATE_CAER", first), ("VOX_ES_4_SIGUE", g4)):
        seg = seg / (np.max(np.abs(seg)) + 1e-9) * 10 ** (-1 / 20)
        sf.write(f"{out_dir}/{name}.flac", seg, SR, subtype="PCM_24")
    print("Hook + Shots geschrieben nach", out_dir)


if __name__ == "__main__":
    build(sys.argv[1], sys.argv[2])
