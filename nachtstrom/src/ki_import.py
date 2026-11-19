"""Importiert einen KI-Track (ElevenLabs Music) ins Ableton-Projekt.

- dekodiert nach 44,1 kHz Stereo FLAC  -> Samples/KI/KI_TRACK.flac
- misst Tempo (Comb-Analyse der Kick-Onsets) und ersten Downbeat
- misst Lautheit (LUFS) und vergleicht die Klangbalance mit der Referenz
- schreibt Samples/KI/ki_meta.json (wird von build_als.py fuer die Warp-Marker genutzt)

python3 ki_import.py <ki_track.mp3|wav>
"""
import io
import json
import os
import subprocess
import sys

import numpy as np
import soundfile as sf
from scipy.signal import butter, sosfiltfilt

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SR = 44100


def decode(path):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-f", "wav", "-ac", "2", "-ar", str(SR), "-"],
                         capture_output=True, check=True).stdout
    x, _ = sf.read(io.BytesIO(raw))
    return x


def onset_env(m, lo, hi, hop=64):
    b = np.abs(sosfiltfilt(butter(4, [lo, hi], "band", fs=SR, output="sos"), m))
    e = np.array([b[i:i + hop].max() for i in range(0, len(b) - hop, hop)])
    return np.maximum(np.diff(e, prepend=e[0]), 0), SR / hop


def tempo_and_phase(m):
    d, fr = onset_env(m, 30, 150)
    best = (0, 0, 0)
    for bpm in np.arange(120.0, 165.0, 0.01):
        per = 60.0 / bpm * fr
        ph = (np.arange(len(d)) % per) / per
        h = np.bincount((ph * 200).astype(int), weights=d, minlength=200)
        score = h.max() / (h.mean() + 1e-9)
        if score > best[0]:
            best = (score, bpm, h.argmax() / 200 * per / fr)
    return best[1], best[2], best[0]


def lufs(x):
    import pyloudnorm as pyln
    return pyln.Meter(SR).integrated_loudness(x)


def main(path):
    os.makedirs(f"{ROOT}/Samples/KI", exist_ok=True)
    x = decode(path)
    m = x.mean(1)
    bpm, phase, score = tempo_and_phase(m)
    # Downbeat-Phase aus dem Kick-Attack-Band (150-400 Hz) – an Referenz geprueft (Fehler < 5 ms)
    d, fr = onset_env(m, 150, 400)
    per_f = 60.0 / bpm * fr
    h = np.bincount(((np.arange(len(d)) % per_f) / per_f * 400).astype(int), weights=d, minlength=400)
    phase = h.argmax() / 400 * per_f / fr
    # erster Downbeat: erste Kick-Phase nach Beginn des Signals
    start = np.argmax(np.abs(m) > 10 ** (-40 / 20)) / SR
    per = 60.0 / bpm
    t0 = phase + np.ceil((start - phase) / per - 0.25) * per
    t0 = max(0.0, t0)
    L = lufs(x)
    sf.write(f"{ROOT}/Samples/KI/KI_TRACK.flac", x, SR, subtype="PCM_24")
    meta = {"bpm": round(float(bpm), 3), "t0": round(float(t0), 4), "duration": round(len(m) / SR, 3),
            "lufs": round(float(L), 2), "tempo_confidence": round(float(score), 2), "source": os.path.basename(path)}
    with open(f"{ROOT}/Samples/KI/ki_meta.json", "w") as f:
        json.dump(meta, f, indent=2)
    print("KI-Track:", meta)
    # Klangbalance gegen Referenz (Bandpegel relativ zum Gesamtpegel)
    ref = f"{ROOT}/Samples/Referenz/REFERENZ.mp3"
    if os.path.exists(ref):
        r = decode(ref).mean(1)
        bands = {"Sub 20-60": (20, 60), "Low 60-150": (60, 150), "LowMid 150-500": (150, 500),
                 "Mid 0.5-2k": (500, 2000), "HiMid 2-6k": (2000, 6000), "High 6-16k": (6000, 16000)}
        print("Band              KI   Referenz  (dB relativ zum Gesamt-RMS)")
        for k, (lo, hi) in bands.items():
            def rel(sig):
                f = sosfiltfilt(butter(4, [lo, hi], "band", fs=SR, output="sos"), sig)
                return 20 * np.log10(np.std(f) / np.std(sig))
            print(f"{k:15s} {rel(m):6.1f}   {rel(r):6.1f}")


if __name__ == "__main__":
    main(sys.argv[1])
