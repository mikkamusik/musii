"""NARCO CLARITY brand elements in the style of the reference video:
brush-script logo (white NARCO, teal CLARITY, teal swoosh, black brush
backdrop) and black dry-brush banners behind on-screen titles."""
import math, os
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

FONTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fonts')
TEAL = (38, 224, 210)
WHITE = (250, 250, 248)


def _rng(seed):
    return np.random.default_rng(seed)


def streaks(w, h, seed, density=0.08, horizontal=True):
    """dry-brush texture: 1 = paint, with thin horizontal gaps/streaks"""
    r = _rng(seed)
    m = np.ones((h, w), np.float32)
    n = int(h * density)
    for _ in range(n):
        y = r.integers(0, h)
        x0 = r.integers(-w // 3, w)
        ln = r.integers(w // 6, w)
        th = r.integers(1, max(2, h // 60) + 1)
        m[y:y + th, max(0, x0):min(w, x0 + ln)] *= r.uniform(0.0, 0.55)
    img = Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.6))
    return np.asarray(img).astype(np.float32) / 255


def rough_edges(alpha, seed, amount=2.2, grid=6):
    """displace the alpha mask a little so edges look painted, not typeset"""
    a = np.asarray(alpha).astype(np.float32)
    h, w = a.shape
    r = _rng(seed)
    nx = r.standard_normal((h // grid + 2, w // grid + 2)).astype(np.float32)
    ny = r.standard_normal((h // grid + 2, w // grid + 2)).astype(np.float32)
    nx = np.asarray(Image.fromarray(nx).resize((w, h), Image.BICUBIC)) * amount
    ny = np.asarray(Image.fromarray(ny).resize((w, h), Image.BICUBIC)) * amount
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    xs = np.clip(xx + nx, 0, w - 1).astype(np.int32)
    ys = np.clip(yy + ny, 0, h - 1).astype(np.int32)
    return a[ys, xs]


def brush_word(text, font_path, size, color, seed, shear=-0.20, track=2):
    f = ImageFont.truetype(font_path, size)
    d = ImageDraw.Draw(Image.new('L', (1, 1)))
    w = int(sum(d.textlength(c, font=f) for c in text) + track * len(text) + size)
    h = int(size * 1.6)
    m = Image.new('L', (w, h), 0)
    dm = ImageDraw.Draw(m)
    x = size * 0.3
    for c in text:
        dm.text((x, size * 0.15), c, font=f, fill=255)
        x += d.textlength(c, font=f) + track
    # italic shear
    k = abs(shear)
    m = m.transform((w + int(k * h), h), Image.AFFINE, (1, k, -k * h, 0, 1, 0), resample=Image.BICUBIC)
    a = rough_edges(m, seed, 0.9, grid=2)
    a *= streaks(a.shape[1], a.shape[0], seed + 1, density=0.035) * 0.45 + 0.55
    out = np.zeros(a.shape + (4,), np.uint8)
    out[..., :3] = color
    out[..., 3] = np.clip(a, 0, 255).astype(np.uint8)
    im = Image.fromarray(out, 'RGBA')
    return im.crop(im.getbbox())


def brush_stroke(w, h, seed, color=(6, 8, 10), opacity=0.86, taper=0.10, ragged=0.05):
    """black dry-brush banner like the reference: solid body, uneven top and
    bottom, streaky bristle ends left and right"""
    r = _rng(seed)
    pad = int(h * 0.5)
    W, H = w + 2 * pad, h + 2 * pad
    a = np.zeros((H, W), np.float32)
    # uneven top / bottom edge (high-frequency jitter on a slow wobble)
    xs = np.arange(W)
    wob = np.sin(xs / W * 2 * np.pi * r.uniform(0.6, 1.4) + r.uniform(0, 6)) * h * 0.04
    top = pad + wob + r.normal(0, h * 0.012, W)
    bot = pad + h + wob * 0.6 + r.normal(0, h * 0.012, W)
    for i in range(h + int(h * 0.1)):
        y = int(pad - h * 0.05 + i)
        edge = abs((i / max(1, h)) - 0.5) * 2
        s0 = pad + abs(r.normal(0, w * ragged)) + edge ** 3 * w * taper * r.uniform(0.3, 1.0)
        e0 = pad + w - abs(r.normal(0, w * ragged)) - edge ** 3 * w * taper * r.uniform(0.3, 1.0)
        s0, e0 = int(max(0, s0)), int(min(W, e0))
        if e0 > s0:
            v = r.uniform(0.86, 1.0) if r.random() > 0.05 else r.uniform(0.35, 0.65)
            a[y, s0:e0] = v
    cols = (np.arange(H)[:, None] >= top[None, :]) & (np.arange(H)[:, None] <= bot[None, :])
    a *= cols
    # bristle tails
    for _ in range(int(h * 0.5)):
        y = pad + r.integers(0, h)
        ln = r.integers(int(w * 0.02), int(w * 0.09))
        th = r.integers(1, 3)
        if r.random() < 0.5:
            x = pad + int(abs(r.normal(0, w * ragged)))
            a[y:y + th, max(0, x - ln):x] = np.maximum(a[y:y + th, max(0, x - ln):x], r.uniform(0.25, 0.8))
        else:
            x = pad + w - int(abs(r.normal(0, w * ragged)))
            a[y:y + th, x:min(W, x + ln)] = np.maximum(a[y:y + th, x:min(W, x + ln)], r.uniform(0.25, 0.8))
    img = Image.fromarray((a * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.9))
    a = np.asarray(img).astype(np.float32) / 255.0
    a *= streaks(W, H, seed + 3, density=0.03) * 0.18 + 0.82
    out = np.zeros((H, W, 4), np.uint8)
    out[..., :3] = color
    out[..., 3] = np.clip(a * 255 * opacity, 0, 255).astype(np.uint8)
    im = Image.fromarray(out, 'RGBA')
    return im.crop(im.getbbox())


def swoosh(w, h, seed, color=TEAL):
    """tapered teal brush underline, slightly rising to the right"""
    r = _rng(seed)
    W, H = w + 20, h * 3 + 20
    a = np.zeros((H, W), np.float32)
    for x in range(w):
        u = x / (w - 1)
        th = h * (0.25 + 0.75 * math.sin(math.pi * min(1, u * 1.15)) ** 0.6) * (1 - 0.55 * u)
        yc = 10 + h * 1.6 - u * h * 0.9
        y0, y1 = int(yc - th / 2), int(yc + th / 2) + 1
        a[max(0, y0):min(H, y1), 10 + x] = 1
    img = Image.fromarray((a * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.8))
    a = rough_edges(img, seed, 0.8, grid=2) / 255.0
    a *= streaks(W, H, seed + 2, density=0.12) * 0.4 + 0.6
    out = np.zeros((H, W, 4), np.uint8)
    out[..., :3] = color
    out[..., 3] = np.clip(a * 255, 0, 255).astype(np.uint8)
    im = Image.fromarray(out, 'RGBA')
    return im.crop(im.getbbox())


def logo(scale=1.0, backdrop=True, font='PermanentMarker-Regular.ttf'):
    fp = f'{FONTS}/{font}'
    s = scale
    narco = brush_word('NARCO', fp, int(78 * s), WHITE, 11)
    clarity = brush_word('CLARITY', fp, int(70 * s), TEAL, 23)
    sw = swoosh(int(clarity.size[0] * 0.92), max(6, int(15 * s)), 31)
    W = int(max(narco.size[0], clarity.size[0] + 30 * s) + 60 * s)
    H = int(narco.size[1] + clarity.size[1] + sw.size[1] + 10 * s)
    canvas = Image.new('RGBA', (W + int(160 * s), H + int(40 * s)), (0, 0, 0, 0))
    if backdrop:
        bs = brush_stroke(int(W * 0.80), int(H * 0.50), 41, opacity=0.80, taper=0.25, ragged=0.10)
        canvas.alpha_composite(bs, (int(W * 0.30), int(H * 0.30)))
    x0, y0 = int(6 * s), int(6 * s)
    canvas.alpha_composite(narco, (x0 + int(8 * s), y0))
    cy = y0 + narco.size[1] - int(3 * s)
    canvas.alpha_composite(clarity, (x0 + int(22 * s), cy))
    canvas.alpha_composite(sw, (x0 + int(34 * s), cy + clarity.size[1] - int(8 * s)))
    # soft shadow so the white reads on bright footage
    al = canvas.split()[3].filter(ImageFilter.GaussianBlur(6)).point(lambda v: int(v * 0.5))
    sh = Image.new('RGBA', canvas.size, (0, 0, 0, 0)); sh.putalpha(al)
    out = Image.new('RGBA', canvas.size, (0, 0, 0, 0))
    out.alpha_composite(sh, (0, 0)); out.alpha_composite(canvas)
    return out.crop(out.getbbox())


if __name__ == '__main__':
    import sys
    bg = Image.new('RGBA', (1400, 900), (90, 96, 104, 255))
    y = 10
    for fnt in ['PermanentMarker-Regular.ttf', 'Knewave-Regular.ttf', 'CaveatBrush-Regular.ttf', 'KaushanScript-Regular.ttf']:
        lg = logo(1.0, font=fnt)
        bg.alpha_composite(lg, (10 + (0 if y < 450 else 0), y)) if y < 450 else bg.alpha_composite(lg, (700, y - 440))
        y += 220
    b = brush_stroke(640, 150, 5)
    bg.alpha_composite(b, (700, 30))
    bg.save(sys.argv[1])
