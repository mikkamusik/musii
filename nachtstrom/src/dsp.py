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


# ---------------------------------------------------------------- v2: Trippy-FX
@njit(cache=True)
def tape_delay(l, r, base, depth, rate_hz, fb, damp, drive, cross):
    """Stereo-Tape-Delay mit eiernder Delay-Zeit (Wow) -> Pitch-Warble.
    base/depth in Samples, cross 1 = Ping-Pong. Rueckgabe: Wet."""
    n = l.shape[0]
    size = int(base + depth.max() + 8)
    bl = np.zeros(size)
    br = np.zeros(size)
    ol = np.empty(n)
    orr = np.empty(n)
    w = 0
    zl = 0.0
    zr = 0.0
    for i in range(n):
        mod = depth[i] * (0.5 + 0.5 * np.sin(2.0 * np.pi * rate_hz * i / SR))
        d = base + mod
        rp = w - d
        while rp < 0:
            rp += size
        i0 = int(rp)
        fr = rp - i0
        i1 = i0 + 1
        if i1 >= size:
            i1 = 0
        yl = bl[i0] * (1 - fr) + bl[i1] * fr
        yr = br[i0] * (1 - fr) + br[i1] * fr
        zl = yl * (1 - damp) + zl * damp
        zr = yr * (1 - damp) + zr * damp
        fl = np.tanh(drive * zl) / drive
        frr = np.tanh(drive * zr) / drive
        bl[w] = l[i] + fb * (cross * frr + (1 - cross) * fl)
        br[w] = r[i] + fb * (cross * fl + (1 - cross) * frr)
        ol[i] = yl
        orr[i] = yr
        w += 1
        if w >= size:
            w = 0
    return ol, orr


@njit(cache=True)
def phaser(x, rate_hz, fmin, fmax, fb, stages, phase0):
    """Klassischer 1.-Ordnung-Allpass-Phaser mit LFO."""
    n = x.shape[0]
    out = np.empty(n)
    st = np.zeros(stages)
    last = 0.0
    for i in range(n):
        lfo = 0.5 + 0.5 * np.sin(2 * np.pi * rate_hz * i / SR + phase0)
        fc = fmin * (fmax / fmin) ** lfo
        t = np.tan(np.pi * fc / SR)
        a = (t - 1) / (t + 1)
        y = x[i] + fb * last
        for s in range(stages):
            o = a * y + st[s]
            st[s] = y - a * o
            y = o
        last = y
        out[i] = 0.5 * (x[i] + y)
    return out


def fold(x, amt):
    """Wavefolder."""
    return np.sin(x * amt * np.pi / 2)


def smooth(x, n):
    """Schneller gleitender Mittelwert (cumsum) – fuer weiche Automations-Uebergaenge."""
    c = np.cumsum(np.concatenate([np.zeros(n), x, np.full(n, x[-1])]))
    y = (c[n:] - c[:-n]) / n
    off = n // 2
    return y[off:off + x.shape[0]]


@njit(cache=True)
def limiter_fast(x, ceiling, look, rel_ms):
    """Lookahead-Limiter in O(n) (monotone Deque fuer das gleitende Maximum)."""
    n = x.shape[1]
    peak = np.empty(n)
    for i in range(n):
        m = 0.0
        for c in range(x.shape[0]):
            a = abs(x[c, i])
            if a > m:
                m = a
        peak[i] = m
    # wmax[i] = max(peak[i : i+look])
    wmax = np.empty(n)
    dq = np.empty(n, dtype=np.int64)
    head = 0
    tail = 0
    j = 0
    for i in range(n):
        lim = i + look
        if lim > n:
            lim = n
        while j < lim:
            while tail > head and peak[dq[tail - 1]] <= peak[j]:
                tail -= 1
            dq[tail] = j
            tail += 1
            j += 1
        while dq[head] < i:
            head += 1
        wmax[i] = peak[dq[head]]
    out = np.empty_like(x)
    ar = np.exp(-1.0 / (SR * rel_ms / 1000.0))
    aa = np.exp(-1.0 / (look / 4.0))
    g = 1.0
    for i in range(n):
        need = 1.0
        if wmax[i] > ceiling:
            need = ceiling / wmax[i]
        if need < g:
            g = aa * g + (1.0 - aa) * need
        else:
            g = ar * g + (1.0 - ar) * need
        for c in range(x.shape[0]):
            out[c, i] = x[c, i] * g
    return out


# ---------------------------------------------------------------- v13: Studio-Hall (FDN)
@njit(cache=True)
def _fdn8(x, lens, gains, lp_a, mod_depth, mod_rate, ins, out_l, out_r):
    """8-Kanal Feedback-Delay-Network, Hadamard-Matrix, modulierte Leitungen
    (gegen metallisches Klingeln), Daempfung pro Leitung."""
    n = x.shape[0]
    size = 0
    for k in range(8):
        if lens[k] > size:
            size = lens[k]
    size = size + int(mod_depth) + 8
    buf = np.zeros((8, size))
    w = 0
    z = np.zeros(8)
    o = np.zeros(8)
    h = np.zeros(8)
    for i in range(n):
        for k in range(8):
            d = lens[k] + mod_depth * np.sin(2.0 * np.pi * mod_rate * (1.0 + 0.137 * k) * i / SR + 1.3 * k)
            rp = w - d
            while rp < 0:
                rp += size
            i0 = int(rp)
            fr = rp - i0
            i1 = i0 + 1
            if i1 >= size:
                i1 = 0
            y = buf[k, i0] * (1.0 - fr) + buf[k, i1] * fr
            z[k] = (1.0 - lp_a) * y + lp_a * z[k]
            o[k] = z[k] * gains[k]
        # schnelle Hadamard-Transformation (8)
        for k in range(8):
            h[k] = o[k]
        step = 1
        while step < 8:
            for a in range(0, 8, 2 * step):
                for b in range(a, a + step):
                    u = h[b]
                    v = h[b + step]
                    h[b] = u + v
                    h[b + step] = u - v
            step *= 2
        for k in range(8):
            buf[k, w] = x[i] * ins[k] + h[k] * 0.35355339059327373
        out_l[i] = o[0] - o[2] + o[4] - o[6]
        out_r[i] = o[1] - o[3] + o[5] - o[7]
        w += 1
        if w >= size:
            w = 0


def reverb_fdn(x, size=0.84, damp=0.35, spread=23, predelay_ms=12.0):
    """Ersetzt den alten Freeverb: glatter, dichter, nicht metallisch. Gleiche Signatur."""
    n = x.shape[0]
    pd = int(SR * predelay_ms / 1000.0)
    xin = np.concatenate([np.zeros(pd), x])[:n]
    t60 = float(np.clip(0.55 + 2.4 * max(0.0, (size - 0.68) / 0.27) ** 2.2, 0.35, 4.5))
    scale = 0.75 + 0.5 * size
    lens = (np.array([1031, 1259, 1433, 1601, 1789, 1951, 2153, 2357]) * scale).astype(np.int64)
    gains = 10.0 ** (-3.0 * lens / (t60 * SR))
    fc = 1500.0 + 9000.0 * (1.0 - damp) ** 1.5
    lp_a = float(np.exp(-2.0 * np.pi * fc / SR))
    ins = np.array([1, -1, 1, 1, -1, 1, -1, -1], dtype=np.float64) * 0.5
    out_l = np.zeros(n)
    out_r = np.zeros(n)
    _fdn8(xin, lens, gains, lp_a, 9.0, 0.35, ins, out_l, out_r)
    # fruehe Reflexionen (Raumgefuehl), abwechselnd L/R
    er_l = np.zeros(n)
    er_r = np.zeros(n)
    for j, (ms, g) in enumerate(((7.1, 0.5), (11.3, 0.42), (17.9, 0.36), (23.3, 0.3), (31.7, 0.25), (41.2, 0.2))):
        d = int(SR * ms / 1000.0)
        tgt = er_l if j % 2 == 0 else er_r
        tgt[d:] += xin[: n - d] * g
    return np.array([out_l + 0.35 * er_l, out_r + 0.35 * er_r]) * 0.44


# Alle Aufrufe von reverb() nutzen ab v13 das FDN (der alte Freeverb bleibt als reverb_freeverb erhalten).
reverb_freeverb = reverb
reverb = reverb_fdn


# ---------------------------------------------------------------- v13: analoge Drift + Stereo-Chorus
def analog_drift(n, cents, rng, rate_hz=0.35):
    """Langsam wandernde Verstimmung (Cent) wie bei einem analogen VCO."""
    k = max(2, int(n / SR * rate_hz) + 3)
    pts = rng.standard_normal(k)
    xs = np.linspace(0, n, k)
    d = np.interp(np.arange(n), xs, pts)
    d = smooth(d, int(SR / rate_hz / 2))
    return cents * d / (np.std(d) + 1e-9)


@njit(cache=True)
def _moddelay(x, base_ms, depth_ms, rate_hz, phase0):
    n = x.shape[0]
    out = np.empty(n)
    size = int((base_ms + depth_ms) * SR / 1000.0) + 8
    buf = np.zeros(size)
    w = 0
    for i in range(n):
        buf[w] = x[i]
        d = (base_ms + depth_ms * 0.5 * (1.0 + np.sin(2.0 * np.pi * rate_hz * i / SR + phase0))) * SR / 1000.0
        rpos = w - d
        while rpos < 0:
            rpos += size
        i0 = int(rpos)
        fr = rpos - i0
        i1 = (i0 + 1) % size
        out[i] = buf[i0] * (1.0 - fr) + buf[i1] * fr
        w = (w + 1) % size
    return out


def chorus(st, mix=0.35, rate=0.3, depth_ms=2.5, base_ms=8.0):
    """Zwei modulierte Stimmen pro Seite, LFOs L/R um 90 Grad versetzt -> breite, lebendige Flaeche."""
    l, r = st[0], st[1]
    wl = _moddelay(l, base_ms, depth_ms, rate, 0.0) + _moddelay(l, base_ms * 1.37, depth_ms, rate * 0.83, 2.1)
    wr = (_moddelay(r, base_ms, depth_ms, rate, np.pi / 2)
          + _moddelay(r, base_ms * 1.37, depth_ms, rate * 0.83, 2.1 + np.pi / 2))
    return np.array([l + mix * 0.5 * wl, r + mix * 0.5 * wr]) / (1.0 + 0.5 * mix)


@njit(cache=True)
def pulse_pwm(freq, width, phase0=0.0):
    """Pulse mit Pulsbreite pro Sample (PWM)."""
    n = freq.shape[0]
    out = np.empty(n)
    ph = phase0
    for i in range(n):
        dt = freq[i] / SR
        w = width[i]
        v = 1.0 if ph < w else -1.0
        v += _blep(ph, dt)
        p2 = ph + 1.0 - w
        if p2 >= 1.0:
            p2 -= 1.0
        v -= _blep(p2, dt)
        out[i] = v
        ph += dt
        if ph >= 1.0:
            ph -= 1.0
    return out
