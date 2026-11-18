"""DSP-Kernel (numba) – alles von Grund auf, keine Samples, keine Presets."""
import numpy as np
from numba import njit

SR = 44100


# ---------------------------------------------------------------- Oszillatoren
@njit(cache=True)
def _blep(t, dt):
    if t < dt:
        t /= dt
        return t + t - t * t - 1.0
    elif t > 1.0 - dt:
        t = (t - 1.0) / dt
        return t * t + t + t + 1.0
    return 0.0


@njit(cache=True)
def saw(freq, phase0=0.0):
    """Bandbegrenzter Saw (polyBLEP), Frequenz pro Sample."""
    n = freq.shape[0]
    out = np.empty(n)
    ph = phase0
    for i in range(n):
        dt = freq[i] / SR
        out[i] = 2.0 * ph - 1.0 - _blep(ph, dt)
        ph += dt
        if ph >= 1.0:
            ph -= 1.0
    return out


@njit(cache=True)
def pulse(freq, width, phase0=0.0):
    n = freq.shape[0]
    out = np.empty(n)
    ph = phase0
    for i in range(n):
        dt = freq[i] / SR
        v = 1.0 if ph < width else -1.0
        v += _blep(ph, dt)
        p2 = ph + 1.0 - width
        if p2 >= 1.0:
            p2 -= 1.0
        v -= _blep(p2, dt)
        out[i] = v
        ph += dt
        if ph >= 1.0:
            ph -= 1.0
    return out


@njit(cache=True)
def sine_fm(freq, phase0=0.0):
    n = freq.shape[0]
    out = np.empty(n)
    ph = phase0
    for i in range(n):
        out[i] = np.sin(2.0 * np.pi * ph)
        ph += freq[i] / SR
        ph -= np.floor(ph)
    return out


# ---------------------------------------------------------------- Filter
@njit(cache=True)
def svf(x, cutoff, res, mode):
    """TPT State-Variable-Filter (Zavalishin). mode 0=LP 1=BP 2=HP.
    cutoff: Array pro Sample, res 0..~0.98"""
    n = x.shape[0]
    out = np.empty(n)
    ic1 = 0.0
    ic2 = 0.0
    k = 2.0 - 2.0 * res
    for i in range(n):
        fc = cutoff[i]
        if fc < 15.0:
            fc = 15.0
        if fc > SR * 0.45:
            fc = SR * 0.45
        g = np.tan(np.pi * fc / SR)
        a1 = 1.0 / (1.0 + g * (g + k))
        a2 = g * a1
        a3 = g * a2
        v3 = x[i] - ic2
        v1 = a1 * ic1 + a2 * v3
        v2 = ic2 + a2 * ic1 + a3 * v3
        ic1 = 2.0 * v1 - ic1
        ic2 = 2.0 * v2 - ic2
        if mode == 0:
            out[i] = v2
        elif mode == 1:
            out[i] = v1
        else:
            out[i] = x[i] - k * v1 - v2
    return out


@njit(cache=True)
def ladder(x, cutoff, res, drive):
    """4-Pol Transistor-Ladder (Huovilainen-light) – fuer die Acid-Line."""
    n = x.shape[0]
    out = np.empty(n)
    s1 = 0.0
    s2 = 0.0
    s3 = 0.0
    s4 = 0.0
    for i in range(n):
        fc = cutoff[i]
        if fc < 20.0:
            fc = 20.0
        if fc > 16000.0:
            fc = 16000.0
        g = 1.0 - np.exp(-2.0 * np.pi * fc / SR)
        r = res[i] * 4.0
        inp = np.tanh(drive * x[i] - r * s4)
        s1 += g * (inp - s1)
        s2 += g * (np.tanh(s1) - s2)
        s3 += g * (np.tanh(s2) - s3)
        s4 += g * (np.tanh(s3) - s4)
        out[i] = s4
    return out


@njit(cache=True)
def onepole_lp(x, fc):
    n = x.shape[0]
    out = np.empty(n)
    a = np.exp(-2.0 * np.pi * fc / SR)
    z = 0.0
    for i in range(n):
        z = (1.0 - a) * x[i] + a * z
        out[i] = z
    return out


def onepole_hp(x, fc):
    return x - onepole_lp(x, fc)


def lp(x, fc, res=0.0):
    return svf(x, np.full(x.shape[0], float(fc)), res, 0)


def hp(x, fc, res=0.0):
    return svf(x, np.full(x.shape[0], float(fc)), res, 2)


def bp(x, fc, res=0.5):
    return svf(x, np.full(x.shape[0], float(fc)), res, 1)


# ---------------------------------------------------------------- Raum
@njit(cache=True)
def _comb(x, d, fb, damp):
    n = x.shape[0]
    buf = np.zeros(d)
    out = np.empty(n)
    idx = 0
    st = 0.0
    for i in range(n):
        y = buf[idx]
        st = y * (1.0 - damp) + st * damp
        buf[idx] = x[i] + st * fb
        out[i] = y
        idx += 1
        if idx >= d:
            idx = 0
    return out


@njit(cache=True)
def _allpass(x, d, g):
    n = x.shape[0]
    buf = np.zeros(d)
    out = np.empty(n)
    idx = 0
    for i in range(n):
        b = buf[idx]
        y = -x[i] + b
        buf[idx] = x[i] + b * g
        out[i] = y
        idx += 1
        if idx >= d:
            idx = 0
    return out


COMBS = np.array([1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617])
APS = np.array([556, 441, 341, 225])


def reverb(x, size=0.84, damp=0.35, spread=23, predelay_ms=12.0):
    """Freeverb-artiger Stereo-Hall. x mono -> (2, n) wet."""
    pd = int(SR * predelay_ms / 1000.0)
    xin = np.concatenate([np.zeros(pd), x])[: x.shape[0]] * 0.015
    outs = []
    for ch in range(2):
        acc = np.zeros(x.shape[0])
        for c in COMBS:
            acc += _comb(xin, int(c + ch * spread), size, damp)
        for a in APS:
            acc = _allpass(acc, int(a + ch * spread), 0.5)
        outs.append(acc)
    return np.array(outs)


@njit(cache=True)
def pingpong(l, r, d, fb, damp):
    """Ping-Pong-Delay, d in Samples. Rueckgabe nur Wet."""
    n = l.shape[0]
    bl = np.zeros(d)
    br = np.zeros(d)
    ol = np.empty(n)
    orr = np.empty(n)
    idx = 0
    zl = 0.0
    zr = 0.0
    for i in range(n):
        yl = bl[idx]
        yr = br[idx]
        zl = yl * (1.0 - damp) + zl * damp
        zr = yr * (1.0 - damp) + zr * damp
        bl[idx] = (l[i] + r[i]) * 0.5 + zr * fb
        br[idx] = zl * fb
        ol[i] = yl
        orr[i] = yr
        idx += 1
        if idx >= d:
            idx = 0
    return ol, orr


# ---------------------------------------------------------------- Dynamik
@njit(cache=True)
def compressor(x, sc, thresh_db, ratio, att_ms, rel_ms, makeup_db):
    """Feed-forward Kompressor. x (2,n), sc mono Detektor."""
    n = sc.shape[0]
    out = np.empty_like(x)
    aa = np.exp(-1.0 / (SR * att_ms / 1000.0))
    ar = np.exp(-1.0 / (SR * rel_ms / 1000.0))
    env = 0.0
    mk = 10.0 ** (makeup_db / 20.0)
    for i in range(n):
        v = abs(sc[i])
        if v > env:
            env = aa * env + (1.0 - aa) * v
        else:
            env = ar * env + (1.0 - ar) * v
        db = 20.0 * np.log10(env + 1e-9)
        gr = 0.0
        if db > thresh_db:
            gr = (db - thresh_db) * (1.0 - 1.0 / ratio)
        g = 10.0 ** (-gr / 20.0) * mk
        for c in range(x.shape[0]):
            out[c, i] = x[c, i] * g
    return out


@njit(cache=True)
def limiter(x, ceiling, look, rel_ms):
    """Lookahead-Peak-Limiter. x (2,n)."""
    n = x.shape[1]
    out = np.zeros_like(x)
    ar = np.exp(-1.0 / (SR * rel_ms / 1000.0))
    peak = np.empty(n)
    for i in range(n):
        m = 0.0
        for c in range(x.shape[0]):
            a = abs(x[c, i])
            if a > m:
                m = a
        peak[i] = m
    # gleitendes Maximum ueber Lookahead-Fenster
    need = np.empty(n)
    for i in range(n):
        m = peak[i]
        j1 = i + look
        if j1 > n:
            j1 = n
        for j in range(i, j1):
            if peak[j] > m:
                m = peak[j]
        g = 1.0
        if m > ceiling:
            g = ceiling / m
        need[i] = g
    g = 1.0
    aa = np.exp(-1.0 / (look / 5.0))
    for i in range(n):
        if need[i] < g:
            g = aa * g + (1.0 - aa) * need[i]
        else:
            g = ar * g + (1.0 - ar) * need[i]
        for c in range(x.shape[0]):
            out[c, i] = x[c, i] * g
    return out


def sat(x, drive=1.0):
    return np.tanh(x * drive) / np.tanh(drive)


def db(v):
    return 10.0 ** (v / 20.0)
