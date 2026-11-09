#!/usr/bin/env python3
"""timeline.json -> 1920x1080 frames (raw RGB24 on stdout, or probe PNGs).

The figure is a hooded silhouette seen in profile, lit from behind by a
cold window. It has no face on purpose: the subject concerns people who
would rather not be recognised, and an empty hood lets a viewer put
themselves there. Inside the head sits the reward system as a cluster of
amber points. That cluster carries the argument - it floods, it goes out
one point at a time, it comes back - so the explanation is visible and
not only audible.

Amber is reserved for that signal. Used as decoration it stops meaning
anything.

  python3 animate.py --probe 5,40,90,160   # look before you render
  python3 animate.py --render              # raw frames to stdout
"""
import sys, json, math, os
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
W, H, FPS = 1920, 1080, 30
TL = json.load(open("timeline.json", encoding="utf-8"))
TOTAL = TL["total"]
KAPITEL = TL.get("kapitel", {})
PANEL_SPEC = TL.get("panel", {})
TITEL = TL.get("titel", "NARCO CLARITY")

BG      = (13, 15, 18)
INK     = (236, 232, 225)
AMBER   = (201, 138, 60)
AMBER_F = np.array([201, 138, 60], dtype=np.float32)
COLD    = np.array([72, 92, 116], dtype=np.float32)   # window light
DIM     = (118, 124, 130)
FAINT   = (62, 67, 72)

F_DISP = "/usr/share/texmf/fonts/opentype/public/tex-gyre/texgyreheroscn-bold.otf"
F_REG  = "/usr/share/texmf/fonts/opentype/public/tex-gyre/texgyreheroscn-regular.otf"
F_MONO = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"

HILFE = [("SUCHT- & DROGEN-HOTLINE", "01806 313031", "rund um die Uhr · kostenpflichtig"),
         ("TELEFONSEELSORGE", "0800 111 0 111", "kostenlos und anonym")]

# ---------------------------------------------------------------- figure
HOOD = [
    (268, 182), (296, 112), (356, 62), (442, 38), (528, 48), (596, 92),
    (636, 160), (654, 236), (652, 306), (632, 366), (606, 414), (572, 452),
    (520, 480), (566, 520), (636, 556), (692, 606), (766, 652), (866, 722),
    (930, 820), (956, 940), (960, 1000), (52, 1000), (60, 900), (94, 790),
    (168, 706), (252, 650), (316, 606), (336, 560), (304, 492), (272, 404),
    (254, 300),
]
VOID = (516, 292, 84, 116)      # cx, cy, rx, ry - the empty hood opening
HEAD = (486, 268, 152, 158)     # where the reward cluster lives
SCALE, SIL_X, SIL_Y = 0.79, 96, 150


def build_figure():
    s = 4
    box = (int(1000 * SCALE), int(1000 * SCALE))
    big = Image.new("L", (box[0] * s, box[1] * s), 0)
    ImageDraw.Draw(big).polygon([(x * SCALE * s, y * SCALE * s) for x, y in HOOD], fill=255)
    mask = big.resize(box, Image.LANCZOS)

    sprite = Image.new("RGBA", box, (0, 0, 0, 0))
    sprite.paste(Image.new("RGBA", box, (18, 21, 26, 255)), (0, 0), mask)

    # the hood opening: darker than the hood, so the head reads as empty
    vb = Image.new("L", box, 0)
    cx, cy, rx, ry = VOID
    ImageDraw.Draw(vb).ellipse([(cx - rx) * SCALE, (cy - ry) * SCALE,
                                (cx + rx) * SCALE, (cy + ry) * SCALE], fill=255)
    vb = vb.filter(ImageFilter.GaussianBlur(10))
    void = np.asarray(vb).astype(np.float32) / 255.0 * (np.asarray(mask).astype(np.float32) / 255.0)
    arr = np.asarray(sprite).astype(np.float32)
    arr[..., :3] *= (1 - void * 0.80)[..., None]

    # cold rim where the window light grazes the hood
    edge = mask.filter(ImageFilter.FIND_EDGES).filter(ImageFilter.GaussianBlur(2.4))
    ea = np.asarray(edge).astype(np.float32) / 255.0
    yy, xx = np.mgrid[0:box[1], 0:box[0]].astype(np.float32)
    side = np.clip((xx / box[0] - 0.30) * 2.0, 0, 1) * np.clip(1.30 - yy / box[1], 0, 1)
    rim = np.clip(ea * side * 2.0, 0, 1)
    for i in range(3):
        arr[..., i] = np.maximum(arr[..., i], rim * COLD[i] * 1.55)
    arr[..., 3] = np.maximum(arr[..., 3], rim * 255)
    sprite = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGBA")

    # glow mask: light bleeds through the hood, brightest in the opening
    hb = Image.new("L", box, 0)
    hx, hy, hrx, hry = HEAD
    ImageDraw.Draw(hb).ellipse([(hx - hrx) * SCALE, (hy - hry) * SCALE,
                                (hx + hrx) * SCALE, (hy + hry) * SCALE], fill=255)
    hb = hb.filter(ImageFilter.GaussianBlur(28))
    glow_area = np.asarray(hb).astype(np.float32) / 255.0
    glow_area *= np.asarray(mask).astype(np.float32) / 255.0
    glow_area *= 0.35 + 0.65 * void          # hood dims it, the opening does not
    return sprite, glow_area, box


SPRITE, GLOW_AREA, BOX = build_figure()
SIL_RGB = np.asarray(SPRITE).astype(np.float32)[..., :3]
SIL_A = np.asarray(SPRITE).astype(np.float32)[..., 3:4] / 255.0
SIL_SMALL = SPRITE.resize((int(BOX[0] * 0.74), int(BOX[1] * 0.74)),
                          Image.LANCZOS).transpose(Image.FLIP_LEFT_RIGHT)

_gy, _gx = np.mgrid[0:BOX[1], 0:BOX[0]].astype(np.float32)
_r = np.sqrt(((_gx - VOID[0] * SCALE) / (VOID[2] * SCALE * 2.0)) ** 2 +
             ((_gy - VOID[1] * SCALE) / (VOID[3] * SCALE * 1.8)) ** 2)
GLOW_RGB = (np.clip(1 - _r, 0, 1) ** 2.1)[..., None] * AMBER_F[None, None, :] * GLOW_AREA[..., None]

rng = np.random.default_rng(7)
REC = []
while len(REC) < 26:
    a, rr = rng.uniform(0, 2 * math.pi), math.sqrt(rng.uniform(0, 1))
    REC.append(((VOID[0] + math.cos(a) * VOID[2] * 0.92 * rr) * SCALE,
                (VOID[1] + math.sin(a) * VOID[3] * 0.92 * rr) * SCALE,
                rng.uniform(0, 2 * math.pi)))
_dk = 10
_dy, _dx = np.mgrid[0:_dk * 2 + 1, 0:_dk * 2 + 1].astype(np.float32)
GLOW_TINT = (np.clip(1 - np.sqrt((_dx - _dk) ** 2 + (_dy - _dk) ** 2) / _dk, 0, 1) ** 1.6
             )[..., None] * AMBER_F[None, None, :]


# ---------------------------------------------------------------- backdrop
def build_bg():
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    v = 1.0 - 0.45 * np.sqrt(((xx - W * 0.42) / (W * 0.85)) ** 2 +
                             ((yy - H * 0.45) / (H * 0.95)) ** 2)
    base = np.array(BG, dtype=np.float32)[None, None, :] * np.clip(v, 0.35, 1.2)[..., None]

    # a window behind the figure: the only other light in the room
    win = Image.new("L", (W, H), 0)
    d = ImageDraw.Draw(win)
    d.rectangle([700, 232, 826, 474], fill=255)
    d.rectangle([758, 232, 768, 474], fill=0)
    d.rectangle([700, 346, 826, 356], fill=0)
    win = win.filter(ImageFilter.GaussianBlur(15))
    wa = np.asarray(win).astype(np.float32) / 255.0
    base += wa[..., None] * COLD[None, None, :] * 0.62

    hx = SIL_X + HEAD[0] * SCALE
    hy = SIL_Y + HEAD[1] * SCALE
    pool = np.clip(1 - np.sqrt(((xx - hx) / 580.0) ** 2 + ((yy - hy) / 520.0) ** 2), 0, 1) ** 1.7
    base += pool[..., None] * np.array([34, 40, 48], dtype=np.float32)[None, None, :]

    base *= (1.0 - 0.55 * np.clip((yy - 840) / 240.0, 0, 1) ** 1.4)[..., None]
    return base


BASE = build_bg()


# ---------------------------------------------------------------- text
def fnt(p, s):
    return ImageFont.truetype(p, s)


def tracked(text, font, color, track, pad=4):
    m = ImageDraw.Draw(Image.new("L", (1, 1)))
    wsum = sum(m.textlength(c, font=font) for c in text) + track * max(0, len(text) - 1)
    img = Image.new("RGBA", (int(wsum) + pad * 2, int(font.getbbox("Mg")[3] + pad * 2)), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    x = pad
    for c in text:
        d.text((x, pad), c, font=font, fill=color + (255,))
        x += d.textlength(c, font=font) + track
    return img


CAP_FONT, CAP_MAX = fnt(F_REG, 50), W - 300


def wrap(text, font, maxpx):
    d = ImageDraw.Draw(Image.new("L", (1, 1)))
    out, cur = [], ""
    for w_ in text.split():
        t = (cur + " " + w_).strip()
        if d.textlength(t, font=font) <= maxpx or not cur:
            cur = t
        else:
            out.append(cur); cur = w_
    if cur:
        out.append(cur)
    return out


def caption(text):
    lines = wrap(text, CAP_FONT, CAP_MAX)[:3]
    img = Image.new("RGBA", (CAP_MAX, 62 * len(lines) + 10), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    for i, l in enumerate(lines):
        d.text(((CAP_MAX - d.textlength(l, font=CAP_FONT)) / 2, i * 62), l,
               font=CAP_FONT, fill=INK + (255,))
    return img


CAPS = {e["i"]: caption(e["text"]) for e in TL["lines"]}
LABELS = {k: tracked(KAPITEL.get(k, k.upper()), fnt(F_MONO, 24), DIM, 5) for k in TL["order"]}
PANEL_X, PANEL_W = 1000, 800


def item(title, sub):
    img = Image.new("RGBA", (PANEL_W, 110 if sub else 76), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.ellipse([0, 14, 26, 40], outline=AMBER + (255,), width=3)
    d.text((52, 2), title, font=fnt(F_DISP, 44), fill=INK + (255,))
    if sub:
        d.text((52, 62), sub, font=fnt(F_MONO, 24), fill=DIM + (255,))
    return img


PANELS = {k: [item(a, b) for a, b in v] for k, v in PANEL_SPEC.items()}
TITLE_BIG = tracked(TITEL.upper(), fnt(F_DISP, 104), INK, 12)
TITLE_SUB = tracked("THE TRUTH BEHIND THE RUSH", fnt(F_MONO, 28), AMBER, 6)
DISCLAIM = tracked("KEINE VERHERRLICHUNG · KEINE ANLEITUNG", fnt(F_MONO, 23), FAINT, 4)


def help_card():
    img = Image.new("RGBA", (PANEL_W, 490), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    y = 0
    for label, num, note in HILFE:
        d.rectangle([0, y, 5, y + 150], fill=AMBER + (255,))
        d.text((30, y), label, font=fnt(F_MONO, 24), fill=DIM + (255,))
        d.text((30, y + 36), num, font=fnt(F_DISP, 74), fill=INK + (255,))
        d.text((30, y + 118), note, font=fnt(F_MONO, 23), fill=DIM + (255,))
        y += 196
    d.text((0, y + 8), "Suchtberatung vor Ort: dhs.de", font=fnt(F_REG, 38), fill=DIM + (255,))
    return img


HELP = help_card()


# ---------------------------------------------------------------- compositing
def over(dst, sp, x, y, alpha=1.0):
    if alpha <= 0.003:
        return
    sw, sh = sp.size
    x, y = int(x), int(y)
    x0, y0, x1, y1 = max(0, x), max(0, y), min(W, x + sw), min(H, y + sh)
    if x1 <= x0 or y1 <= y0:
        return
    sub = np.asarray(sp).astype(np.float32)[y0 - y:y1 - y, x0 - x:x1 - x]
    a = sub[..., 3:4] / 255.0 * alpha
    dst[y0:y1, x0:x1] = dst[y0:y1, x0:x1] * (1 - a) + sub[..., :3] * a


def add(dst, src, x, y, k):
    if k <= 0.003:
        return
    sh, sw = src.shape[:2]
    x, y = int(x), int(y)
    x0, y0, x1, y1 = max(0, x), max(0, y), min(W, x + sw), min(H, y + sh)
    if x1 <= x0 or y1 <= y0:
        return
    dst[y0:y1, x0:x1] += src[y0 - y:y1 - y, x0 - x:x1 - x] * k


def ease(x):
    return 0.0 if x <= 0 else 1.0 if x >= 1 else x * x * (3 - 2 * x)


def scene_at(t):
    cur = TL["order"][0]
    for k in TL["order"]:
        if t >= TL["scenes"][k]["start"] - 0.9:
            cur = k
    return cur


def line_at(t):
    for e in TL["lines"]:
        if e["start"] - 0.25 <= t <= e["end"] + 0.45:
            return e
    return None


# Each scene key drives the cluster differently. Unlisted keys fall back to
# a calm idle, so a new script never crashes the render.
def cluster(sc, p, t):
    if sc == "reward":
        b = max(0.0, math.sin(t * 1.5)) ** 3
        return 0.22 + 0.5 * b, 0.55 + 0.35 * b, 26
    if sc == "flood":
        rise = ease(min(1.0, p * 2.2))
        hold = 1 - 0.45 * ease(max(0.0, (p - 0.62) / 0.38))
        return 0.25 + 3.1 * rise * hold, 1.0, 26
    if sc == "down":
        return 1.4 * (1 - ease(p)) + 0.12, 0.9 - 0.55 * ease(p), int(round(26 - 18 * ease(p)))
    if sc == "flat":
        return 0.10, 0.28, 8
    if sc == "crave":
        s = max(0.0, math.sin(t * 2.9)) ** 8
        return 0.12 + 1.5 * s, 0.3 + 0.5 * s, 8
    if sc == "lapse":
        return 0.14 + 0.5 * max(0.0, math.sin(t * 0.8)) ** 6, 0.3, 8
    if sc == "help":
        return 0.14 + 0.5 * ease(p), 0.3 + 0.4 * ease(p), int(round(8 + 11 * ease(p)))
    if sc == "outro":
        return 0.5, 0.6, 19
    return 0.18 + 0.07 * math.sin(t * 1.6), 0.45, 26


def render(t):
    f = BASE.copy()
    sc = scene_at(t)
    s = TL["scenes"][sc]
    p = np.clip((t - s["start"]) / max(0.001, s["end"] - s["start"]), 0, 1.4)
    bob = math.sin(t * 0.9) * 4.0 + math.sin(t * 2.3) * 1.2
    glow, rec_a, rec_n = cluster(sc, p, t)
    sx, sy = SIL_X, SIL_Y + bob

    if sc in ("help", "outro"):
        k = ease((p - 0.45) / 0.3) if sc == "help" else 1.0
        over(f, SIL_SMALL, sx + 352, sy + 268 - bob * 0.5, 0.88 * k)

    ys, xs = int(sy), int(sx)
    y1, x1 = min(H, ys + BOX[1]), min(W, xs + BOX[0])
    if y1 > ys and x1 > xs:
        aa = SIL_A[:y1 - ys, :x1 - xs]
        f[ys:y1, xs:x1] = f[ys:y1, xs:x1] * (1 - aa) + SIL_RGB[:y1 - ys, :x1 - xs] * aa
    add(f, GLOW_RGB, sx, sy, glow)

    for px, py, ph in REC[:max(0, rec_n)]:
        k = rec_a * (0.55 + 0.45 * math.sin(t * 1.7 + ph))
        if k > 0.02:
            add(f, GLOW_TINT, int(sx + px) - _dk, int(sy + py) - _dk, k * 1.5)

    if sc == "title":
        over(f, TITLE_BIG, PANEL_X, 400, ease((p - 0.05) / 0.25))
        over(f, TITLE_SUB, PANEL_X + 6, 530, ease((p - 0.25) / 0.25))
        over(f, DISCLAIM, PANEL_X + 6, 606, ease((p - 0.45) / 0.3))
    elif sc == "outro":
        over(f, HELP, PANEL_X, 286, ease(p * 3))
    elif sc in PANELS:
        items = PANELS[sc]
        y0 = 540 - len(items) * 62
        for i, spr in enumerate(items):
            if sc == "flat":
                k = 1 - 0.88 * ease((p - 0.18 - i * 0.12) / 0.22)
            elif sc == "crave":
                k = 0.22 + 0.78 * max(0.0, math.sin(t * 2.9 - i * 1.5)) ** 6
            elif sc == "help":
                k = ease((p - 0.22 - i * 0.14) / 0.14)
            else:
                k = ease((p - 0.15 - i * 0.18) / 0.2)
            over(f, spr, PANEL_X, y0 + i * 124, k)

    over(f, LABELS[sc], 96, 64, 0.9)
    ln = line_at(t)
    if ln is not None:
        cap = CAPS[ln["i"]]
        fade = min(ease((t - ln["start"] + 0.25) / 0.25), ease((ln["end"] + 0.45 - t) / 0.3))
        over(f, cap, (W - cap.size[0]) / 2, H - 140 - cap.size[1] / 2, fade)

    f[H - 34:H - 32, 96:W - 96] = np.array([38, 42, 46], dtype=np.float32)
    ex = int(96 + (W - 192) * min(1.0, t / TOTAL))
    if ex > 96:
        f[H - 34:H - 32, 96:ex] = AMBER_F
    return np.clip(f, 0, 255).astype(np.uint8)


if __name__ == "__main__":
    if "--probe" in sys.argv:
        for ts in sys.argv[sys.argv.index("--probe") + 1].split(","):
            tt = float(ts)
            Image.fromarray(render(tt)).save(f"probe_{int(tt):03d}.png")
        print("Probebilder geschrieben")
    else:
        out = sys.stdout.buffer
        for i in range(int(TOTAL * FPS)):
            out.write(render(i / FPS).tobytes())
        out.flush()
