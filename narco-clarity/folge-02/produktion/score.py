#!/usr/bin/env python3
"""timeline.json -> music.wav  (dark ambient bed: sub drone, slow pads,
sparse soft piano notes placed in the narration pauses, long reverb).
No drums, no drops, no risers. The bed is ducked under the voice later."""
import json, sys, numpy as np, wave

SR = 48000
W = sys.argv[1]
tl = json.load(open(f'{W}/build/timeline.json'))
TOTAL = tl['total']
N = int(TOTAL * SR)
t = np.arange(N) / SR
rng = np.random.default_rng(11)


def hz(note):
    names = {'C': -9, 'C#': -8, 'Db': -8, 'D': -7, 'D#': -6, 'Eb': -6, 'E': -5, 'F': -4,
             'F#': -3, 'Gb': -3, 'G': -2, 'G#': -1, 'Ab': -1, 'A': 0, 'A#': 1, 'Bb': 1, 'B': 2}
    n, o = note[:-1], int(note[-1])
    return 440.0 * 2 ** ((names[n] + (o - 4) * 12) / 12)


def smooth_env(a, b, fade):
    """1 between a and b with raised-cosine fades of length fade."""
    e = np.clip((t - (a - fade)) / fade, 0, 1) * np.clip(((b + fade) - t) / fade, 0, 1)
    return 0.5 - 0.5 * np.cos(np.pi * e)


# ---------------------------------------------------------------- harmony
L = {l['i']: l for l in tl['lines']}
cut = lambda i: L[i]['start'] - 0.4
SECTIONS = [  # (start, end, pad notes, sub root)
    (0.0, cut(3), ['D3', 'A3', 'E4', 'F4'], 'D1'),
    (cut(3), cut(4), ['Bb2', 'F3', 'A3', 'D4'], 'Bb1'),
    (cut(4), cut(7), ['G2', 'D3', 'F3', 'Bb3'], 'G1'),
    (cut(7), cut(9), ['D3', 'A3', 'F4', 'E4'], 'D1'),
    (cut(9), cut(11), ['Bb2', 'F3', 'D4', 'A3'], 'Bb1'),
    (cut(11), cut(13), ['F2', 'C3', 'A3', 'E4'], 'F1'),
    (cut(13), TOTAL + 2, ['D3', 'A3', 'E4', 'A4'], 'D1'),
]

pad = np.zeros((N, 2), np.float32)
sub = np.zeros(N, np.float32)
for (a, b, notes, root) in SECTIONS:
    env = smooth_env(a, b, 2.2).astype(np.float32)
    for k, nm in enumerate(notes):
        f0 = hz(nm)
        for ch in range(2):
            v = np.zeros(N, np.float32)
            for d in (-7, 0, 7):                       # three detuned voices (cents)
                f = f0 * 2 ** ((d + (3 if ch else -3)) / 1200)
                ph = rng.uniform(0, 2 * np.pi)
                for h in range(1, 9):                   # soft saw, heavily low-passed
                    fh = f * h
                    if fh > 2400:
                        break
                    g = (1.0 / h) * np.exp(-(fh / 650.0) ** 2)
                    v += g * np.sin(2 * np.pi * fh * t + ph * h)
            lfo = 0.75 + 0.25 * np.sin(2 * np.pi * (0.045 + 0.01 * k) * t + k)
            pad[:, ch] += v * env * lfo * (0.9 if k else 1.0)
    fr = hz(root)
    sub += env * (np.sin(2 * np.pi * fr * t) + 0.35 * np.sin(2 * np.pi * 2 * fr * t + 0.3)
                  + 0.12 * np.sin(2 * np.pi * 3 * fr * t + 0.7))

sub *= (0.8 + 0.2 * np.sin(2 * np.pi * 0.07 * t))[:]

# ---------------------------------------------------------------- piano
def piano(f, vel, dur=7.0):
    n = int(dur * SR)
    tt = np.arange(n) / SR
    out = np.zeros(n, np.float32)
    B = 0.00032
    for p in range(1, 18):
        fp = f * p * np.sqrt(1 + B * p * p)
        if fp > 7000:
            break
        amp = vel * p ** -1.15 * np.exp(-(p - 1) * (0.32 - 0.12 * vel)) * np.exp(-fp / 2600)
        tau1 = 0.45 / (1 + 0.35 * p)
        tau2 = 5.5 * (261.6 / f) ** 0.45 / (1 + 0.18 * p)
        env = 0.55 * np.exp(-tt / tau1) + 0.45 * np.exp(-tt / tau2)
        for det in (-0.6, 0.6):                         # two strings, slow beating
            out += 0.5 * amp * env * np.sin(2 * np.pi * fp * 2 ** (det / 1200) * tt + rng.uniform(0, 6.28))
    att = np.clip(tt / 0.004, 0, 1)
    ham = rng.standard_normal(n) * np.exp(-tt / 0.012) * 0.02 * vel
    ham = np.convolve(ham, np.ones(12) / 12, mode='same')
    rel = np.clip((dur - tt) / 1.2, 0, 1)
    return (out * att + ham) * rel


def gap_after(i, frac=0.12):
    return L[i]['end'] + frac


NOTES = [  # (time, [notes], velocity)
    (0.06, ['D4'], 0.42),
    (gap_after(1), ['A3', 'E4'], 0.38),
    (gap_after(3), ['Bb3', 'F4'], 0.36),
    (gap_after(6), ['D4'], 0.34),
    (gap_after(8), ['A2', 'D3', 'A3'], 0.40),
    (gap_after(10), ['C4', 'G4'], 0.32),
    (gap_after(12), ['A3', 'E4'], 0.32),
    (L[14]['end'] + 0.25, ['D3', 'A3', 'E4', 'F4'], 0.30),
]
pn = np.zeros((N + 10 * SR, 2), np.float32)
for (tm, notes, vel) in NOTES:
    for j, nm in enumerate(notes):
        s = piano(hz(nm), vel * (1 - 0.08 * j))
        i0 = int((tm + 0.035 * j) * SR)                  # slight roll on chords
        pan = 0.5 + 0.18 * np.tanh((hz(nm) - 300) / 200)
        pn[i0:i0 + len(s), 0] += s * (1.15 - pan)
        pn[i0:i0 + len(s), 1] += s * (0.15 + pan)
pn = pn[:N]

# ---------------------------------------------------------------- reverb
def reverb(x, rt60=3.8, pre=0.03, lp=0.35):
    n = int(rt60 * 1.3 * SR)
    tt = np.arange(n) / SR
    irs = []
    for ch in range(2):
        noise = rng.standard_normal(n)
        noise = np.convolve(noise, np.ones(int(1 / lp)) / int(1 / lp), mode='same')
        ir = noise * np.exp(-6.91 * tt / rt60)
        ir = np.concatenate([np.zeros(int(pre * SR)), ir])
        irs.append(ir / np.sqrt(np.sum(ir ** 2)))
    m = len(x) + len(irs[0])
    nfft = 1 << (m - 1).bit_length()
    y = np.zeros((len(x), 2), np.float32)
    for ch in range(2):
        X = np.fft.rfft(x[:, ch], nfft)
        y[:, ch] = np.fft.irfft(X * np.fft.rfft(irs[ch], nfft), nfft)[:len(x)]
    return y


pad *= 0.020
sub_st = np.stack([sub, sub], 1) * 0.055
piano_dry = pn * 0.30
wet = reverb(pad * 0.6 + piano_dry)
mix = pad * 0.55 + piano_dry * 0.55 + wet * 0.85 + sub_st

# master envelope: fade in, gentle dip into the end card, long fade out
mix *= np.clip(t / 1.2, 0, 1)[:, None] ** 2
mix *= np.clip((TOTAL - t) / 2.6, 0, 1)[:, None] ** 1.5
mix = np.tanh(mix * 1.1) / 1.1
mix /= np.max(np.abs(mix)) + 1e-9
mix *= 0.6

pcm = (np.clip(mix, -1, 1) * 32767).astype('<i2')
with wave.open(f'{W}/build/music.wav', 'w') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes(pcm.tobytes())
print(f'music {TOTAL:.2f}s, sections at', [round(s[0], 2) for s in SECTIONS])
