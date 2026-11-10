#!/usr/bin/env python3
"""timeline.json -> 1920x1080 frames, staged like an anonymised interview.

Same figure and same amber signal as animate.py, but a different camera:
the hooded figure sits on a chair facing us, backlit by a tall curtained
window, inside letterbox bars. The room is drawn, not filmed. Walls,
window, haze and the shadow on the floor are computed once per camera
setup ("shot"); per frame only the light shafts, the dust and the amber
cluster move, which is what keeps a full render to a few minutes.

Captions and chapter labels live in the black bars so the picture itself
stays clean.

  python3 animate_ref.py --probe 5,20,33,44,52   # look before you render
  python3 animate_ref.py --plates                # one PNG per camera setup
  python3 animate_ref.py --render                # raw RGB24 frames on stdout

NC_CLEAN=1 leaves out the burnt-in captions and the progress line. That is
the master for further editing: captions get added in the editor, and a
progress line would be wrong as soon as the film is trimmed.
"""
import sys, json, math, os
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

W, H, FPS = 1920, 1080, 30
BAR = 138                       # letterbox bars; picture is 1920x804 (2.39:1)
PW, PH = W, H - 2 * BAR
OS = 1.08                       # plates are drawn larger so a push-in never upscales
WP, HP = int(round(PW * OS)) // 2 * 2, int(round(PH * OS)) // 2 * 2

TL = json.load(open("timeline.json", encoding="utf-8"))
TOTAL = TL["total"]
KAPITEL = TL.get("kapitel", {})
PANEL_SPEC = TL.get("panel", {})
TITEL = TL.get("titel") or "NARCO CLARITY"
ORDER = TL["order"]
CLEAN = os.environ.get("NC_CLEAN") == "1"

INK     = (236, 232, 225)
AMBER   = (201, 138, 60)
AMBER_F = np.array(AMBER, dtype=np.float32)
DIM     = (118, 124, 130)
FAINT   = (62, 67, 72)
CORE    = np.array([214, 235, 241], dtype=np.float32)   # the glass itself
HAZE    = np.array([70, 122, 140], dtype=np.float32)    # light hanging in the air
ROOM    = np.array([0.80, 1.00, 1.09], dtype=np.float32) * 255.0
POOL    = np.array([120, 176, 194], dtype=np.float32)   # window light on the floor
WRAP    = np.array([118, 168, 186], dtype=np.float32)   # light bending round an edge
FIGC    = np.array([13, 16, 20], dtype=np.float32)

F_DISP = "/usr/share/texmf/fonts/opentype/public/tex-gyre/texgyreheroscn-bold.otf"
F_REG  = "/usr/share/texmf/fonts/opentype/public/tex-gyre/texgyreheroscn-regular.otf"
F_MONO = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"

HILFE = [("SUCHT- & DROGEN-HOTLINE", "01806 313031", "rund um die Uhr · 20 ct/Anruf, mobil max. 60 ct"),
         ("TELEFONSEELSORGE", "0800 111 0 111", "kostenlos und anonym")]

# Camera setups. s = pixels per centimetre at the figure, cx = where the
# window centre sits, yh = horizon line; all in picture pixels.
SHOTS = {
    "wide":  dict(s=3.9, cx=960, yh=440, second=False, bgblur=0.0, right=True,  scrim=False),
    "med":   dict(s=8.3, cx=960, yh=655, second=False, bgblur=3.2, right=False, scrim=False),
    "wide2": dict(s=3.9, cx=500, yh=440, second=True,  bgblur=0.0, right=False, scrim=True),
}
SCENE_SHOT = {"open": "wide", "title": "wide", "reward": "wide", "flood": "med", "down": "med",
              "flat": "med", "crave": "med", "lapse": "med", "help": "wide2", "outro": "wide2"}
ZOOM = {"wide": (0.0, 0.6), "med": (0.1, 0.9), "wide2": (0.0, 0.55)}

RW, RH, HC = 235.0, 265.0, 70.0     # room half width, room height, camera height (cm)
WX, WY0, WY1 = 78.0, 4.0, 238.0     # window half width, sill, head


# ---------------------------------------------------------------- helpers
def ease(x):
    return 0.0 if x <= 0 else 1.0 if x >= 1 else x * x * (3 - 2 * x)


def _box(a, r, axis):
    n = a.shape[axis]
    pad = [(0, 0)] * a.ndim
    pad[axis] = (r + 1, r)
    c = np.cumsum(np.pad(a, pad, mode="edge").astype(np.float64), axis=axis)
    hi = [slice(None)] * a.ndim
    lo = [slice(None)] * a.ndim
    hi[axis] = slice(2 * r + 1, 2 * r + 1 + n)
    lo[axis] = slice(0, n)
    return ((c[tuple(hi)] - c[tuple(lo)]) / (2 * r + 1)).astype(np.float32)


def gblur(a, sigma):
    """Gaussian blur for float images (three box passes); PIL only blurs 8 bit."""
    if sigma < 0.6:
        return a
    r = max(1, int(round((math.sqrt(4 * sigma * sigma + 1) - 1) / 2)))
    for _ in range(3):
        a = _box(_box(a, r, 0), r, 1)
    return a


def soft_box(v, lo, hi, soft):
    return np.clip((v - lo) / soft + 0.5, 0, 1) * np.clip((hi - v) / soft + 0.5, 0, 1)


class Mask:
    """Supersampled 8 bit canvas for hard-edged shapes."""

    def __init__(self, ss=2):
        self.ss = ss
        self.im = Image.new("L", (WP * ss, HP * ss), 0)
        self.d = ImageDraw.Draw(self.im)

    def _s(self, pts):
        return [(x * self.ss, y * self.ss) for x, y in pts]

    def poly(self, pts, v=255):
        self.d.polygon(self._s(pts), fill=v)

    def ell(self, cx, cy, rx, ry, v=255):
        s = self.ss
        self.d.ellipse([(cx - rx) * s, (cy - ry) * s, (cx + rx) * s, (cy + ry) * s], fill=v)

    def line(self, pts, wdt, v=255):
        self.d.line(self._s(pts), fill=v, width=max(1, int(round(wdt * self.ss))), joint="curve")

    def cap(self, p0, p1, r, v=255):
        self.line([p0, p1], 2 * r, v)
        self.ell(p0[0], p0[1], r, r, v)
        self.ell(p1[0], p1[1], r, r, v)

    def taper(self, p0, r0, p1, r1, v=255):
        """A limb: two circles and the skin stretched between them."""
        dx, dy = p1[0] - p0[0], p1[1] - p0[1]
        ln = math.hypot(dx, dy) or 1.0
        nx, ny = -dy / ln, dx / ln
        self.poly([(p0[0] + nx * r0, p0[1] + ny * r0), (p1[0] + nx * r1, p1[1] + ny * r1),
                   (p1[0] - nx * r1, p1[1] - ny * r1), (p0[0] - nx * r0, p0[1] - ny * r0)], v)
        self.ell(p0[0], p0[1], r0, r0, v)
        self.ell(p1[0], p1[1], r1, r1, v)

    def organic(self, r_px, gain=5.0):
        """Blur then re-threshold: rounds every corner and fuses the parts,
        so a body built from polygons reads as cloth rather than geometry."""
        im = self.im.filter(ImageFilter.GaussianBlur(r_px * self.ss))
        lut = [int(max(0, min(255, (v - 127.5) * gain + 127.5))) for v in range(256)]
        self.im = im.point(lut)
        self.d = ImageDraw.Draw(self.im)

    def get(self, blur=0.0):
        im = self.im
        if blur > 0:
            im = im.filter(ImageFilter.GaussianBlur(blur * self.ss))
        return np.asarray(im.resize((WP, HP), Image.LANCZOS), dtype=np.float32) / 255.0


def zoom_blur(src, ox, oy, reach=2.6, steps=64, decay=2.6):
    """Smear every bright pixel away from (ox, oy): light shafts."""
    h, w = src.shape
    im = Image.fromarray(src.astype(np.float32))
    acc = np.zeros((h, w), dtype=np.float32)
    tot = 0.0
    for i in range(steps):
        inv = 1.0 / (1.0 + (reach - 1.0) * i / (steps - 1))
        wgt = math.exp(-decay * i / (steps - 1))
        t = im.transform((w, h), Image.AFFINE,
                         (inv, 0, ox * (1 - inv), 0, inv, oy * (1 - inv)), resample=Image.BILINEAR)
        acc += np.asarray(t, dtype=np.float32) * wgt
        tot += wgt
    return acc / tot


# ---------------------------------------------------------------- figure
def _rot(x, y, deg, px=0.0, py=104.0):
    a = math.radians(deg)
    dx, dy = x - px, y - py
    return (px + dx * math.cos(a) - dy * math.sin(a), py + dx * math.sin(a) + dy * math.cos(a))


POSE_1 = dict(hood=True, tilt=-4.0, lean=-1.2, knee=23.5, ankle=7.5, hands="knees",
              elbow=(31.0, 29.2), drop=1.2, fwd=2.0)       # the one who tells the story
POSE_2 = dict(hood=False, tilt=5.0, lean=2.0, knee=19.0, ankle=13.0, hands="lap",
              elbow=(28.5, 28.0), drop=0.6, fwd=0.0)       # the one who sits down to listen


def body_frames(U, pose):
    """Upper body leans from the hips; the head tilts from the neck on top of that."""
    def UB(x, y):
        return U(*_rot(x, y, pose["lean"], 0.0, 56.0))

    def HD(x, y):
        return UB(*_rot(x, y, pose["tilt"], 0.0, 104.0))
    return UB, HD


def draw_body(m, U, sc, pose):
    """Seated figure seen from the front, in centimetres above the floor.
    U maps (x, y) to plate pixels, sc is pixels per centimetre."""
    UB, HD = body_frames(U, pose)

    def E(T, x, y, rx, ry):
        px, py = T(x, y)
        m.ell(px, py, rx * sc, ry * sc)

    def Pg(T, pts):
        m.poly([T(x, y) for x, y in pts])

    kx, ax = pose["knee"], pose["ankle"]
    for sg in (1, -1):
        fw = pose["fwd"] if sg > 0 else 0.0              # one foot a little nearer to us
        Pg(U, [(sg * (ax - 6.8), -fw), (sg * (ax + 7.6), -fw),
               (sg * (ax + 7.9), 2.6 - fw), (sg * (ax - 6.6), 2.6 - fw)])
        E(U, sg * (ax + 0.8), 4.0 - fw, 7.2, 4.6)                                # shoe
        m.taper(U(sg * kx, 50.0), 7.4 * sc, U(sg * ax, 9.0 - fw), 4.7 * sc)      # shin
        E(U, sg * kx, 54.0, 8.6, 8.2)                                            # knee
    Pg(U, [(-kx - 6.5, 47), (kx + 6.5, 47), (kx + 7.5, 55), (kx + 3, 61.5), (17, 64.5),
           (-17, 64.5), (-kx - 3, 61.5), (-kx - 7.5, 55)])                       # lap
    Pg(UB, [(-19.5, 54), (19.5, 54), (19.5, 70), (21.5, 88), (26.5, 99.5), (12.5, 108),
            (-12.5, 108), (-26.5, 98.5), (-21.5, 88), (-19.5, 70)])              # torso
    for sg in (1, -1):
        dy = -pose["drop"] if sg < 0 else 0.0            # one shoulder hangs a little
        sh = (sg * 25.5, 94.5 + dy)
        el = (sg * pose["elbow"][0 if sg > 0 else 1], 74.0 + dy)
        E(UB, sh[0], sh[1], 6.8, 6.4)
        m.taper(UB(*sh), 6.3 * sc, UB(*el), 5.3 * sc)                            # upper arm
        if pose["hands"] == "knees":
            m.taper(UB(*el), 5.2 * sc, U(sg * (kx - 2.5), 62.0), 4.1 * sc)       # forearm
            E(U, sg * (kx - 3.4), 59.8, 5.6, 4.0)                                # hand on the thigh
        else:
            m.taper(UB(*el), 5.2 * sc, U(sg * 6.5, 60.5), 4.1 * sc)
    if pose["hands"] != "knees":
        E(U, 0.0, 59.5, 8.5, 4.6)                                                # hands folded
    if pose["hood"]:
        Pg(UB, [(-27, 98), (-12, 112), (12, 112), (27, 99), (24, 93), (-24, 92)])
        pts = []
        for i in range(72):
            th = 2 * math.pi * i / 72
            c, sn = math.cos(th), math.sin(th)
            pts.append(HD(14.2 * math.copysign(abs(c) ** 0.8, c),
                          117.2 + 17.2 * math.copysign(abs(sn) ** 0.8, sn)))
        m.poly(pts)
        Pg(HD, [(-13.4, 117), (-12.6, 104), (12.6, 104), (13.4, 117)])
    else:
        Pg(UB, [(-26, 98), (-5.5, 106.5), (5.5, 106.5), (26, 99), (24, 93), (-24, 92)])
        Pg(HD, [(-4.9, 101), (4.9, 101), (4.9, 110), (-4.9, 110)])
        E(HD, 0.0, 118.0, 9.3, 11.8)
        E(HD, 0.6, 121.6, 9.9, 9.3)                                              # hair


def draw_chair(m, U, sc):
    def Pg(pts):
        m.poly([U(x, y) for x, y in pts])
    Pg([(-21.5, 43.5), (21.5, 43.5), (21.5, 47.5), (-21.5, 47.5)])               # seat
    for sg in (1, -1):
        Pg([(sg * 19.4, 2.6), (sg * 22.0, 2.6), (sg * 22.0, 44), (sg * 19.4, 44)])   # front legs
        Pg([(sg * 15.6, 7.4), (sg * 17.8, 7.4), (sg * 17.8, 44), (sg * 15.6, 44)])   # back legs
    Pg([(-16, 25.0), (16, 25.0), (16, 27.2), (-16, 27.2)])                       # back stretcher
    Pg([(-20, 13.6), (20, 13.6), (20, 15.8), (-20, 15.8)])                       # front stretcher


# ---------------------------------------------------------------- one camera setup
def build_shot(s, cx, yh, second, bgblur, right, scrim):
    s, cx, yh = s * OS, cx * OS, yh * OS
    k = s / (3.9 * OS)                             # detail scale relative to the wide shot
    yy, xx = np.mgrid[0:HP, 0:WP].astype(np.float32)

    def P(X, Y, Z=1.0):
        """Room point -> plate pixel. Z is depth relative to the figure (wall = 2)."""
        return (cx + s * X / Z, yh - s * (Y - HC) / Z)

    # which surface each pixel looks at, and how deep into the room it is
    dxa = np.abs(xx - cx)
    dy = yy - yh
    Zs = s * RW / np.maximum(dxa, 1e-3)
    Zv = np.where(dy > 0, s * HC / np.maximum(dy, 1e-3), s * (RH - HC) / np.maximum(-dy, 1e-3))
    Z = np.minimum(np.minimum(Zs, Zv), 2.0).astype(np.float32)
    back = (Zs >= 2.0) & (Zv >= 2.0)
    side = ~back & (Zs < Zv)
    floor = ~back & ~side & (dy > 0)
    ceil = ~back & ~side & (dy <= 0)
    zn = np.clip((Z - 0.45) / 1.55, 0, 1)
    Xw = (xx - cx) * Z / s                         # sideways position on floor / ceiling, cm

    lum = np.where(back, 0.040, 0.0)
    lum = np.where(side, 0.011 + 0.036 * zn ** 1.6, lum)
    lum = np.where(ceil, 0.013 + 0.055 * zn ** 2 * np.exp(-(Xw / 170.0) ** 2), lum)
    lum = np.where(floor, 0.009 + 0.012 * zn, lum).astype(np.float32)

    rng = np.random.default_rng(5)

    def noise(nx, ny):
        a = rng.uniform(0, 1, (ny, nx)).astype(np.float32)
        return np.asarray(Image.fromarray(a).resize((WP, HP), Image.BICUBIC), dtype=np.float32)

    lum *= 0.72 + 0.56 * (0.55 * noise(28, 12) + 0.30 * noise(90, 38) + 0.15 * noise(300, 126))

    # floorboards running towards the camera
    seam_w = np.maximum(1.25 * Z / s, 1e-3)
    dseam = (0.5 - np.abs(((Xw / 13.0) % 1.0) - 0.5)) * 13.0
    bid = np.floor(Xw / 13.0).astype(np.float64)
    bvar = 0.86 + 0.28 * ((np.sin(bid * 12.9898) * 43758.5453) % 1.0)
    floor_mod = (bvar * (1 - 0.35 * np.clip(1.0 - dseam / seam_w, 0, 1))).astype(np.float32)

    # furniture on the side walls, drawn before any light is added
    dark, hl = Mask(), Mask()
    rf = np.random.default_rng(11)
    z0, z1, Xs = 1.95, 1.02, -RW + 1
    dark.poly([P(Xs, 0, z0), P(Xs, 214, z0), P(Xs, 214, z1), P(Xs, 0, z1)], v=205)
    for ya, yb_ in ((3, 38), (41, 76), (79, 114), (117, 152), (155, 190)):
        zz = z0 - 0.015
        while zz > z1 + 0.04:
            wb = rf.uniform(0.012, 0.032)
            hb = rf.uniform(0.55, 0.96) * (yb_ - ya)
            if rf.uniform() < 0.86:
                hl.poly([P(Xs + 3, ya, zz), P(Xs + 3, ya + hb, zz),
                         P(Xs + 3, ya + hb, zz - wb), P(Xs + 3, ya, zz - wb)], v=int(rf.uniform(14, 78)))
            zz -= wb + rf.uniform(0.002, 0.014)
    for ysh in (1.5, 39.5, 77.5, 115.5, 153.5, 191.5, 214):
        hl.line([P(Xs + 3, ysh, z0), P(Xs + 3, ysh, z1)], 1.5 * k, v=120)
    for zz in np.linspace(z0, z1, 5):
        hl.line([P(Xs + 3, 0, zz), P(Xs + 3, 214, zz)], 1.5 * k, v=96)
    if right:
        tz0, tz1, tx0, tx1 = 1.74, 1.20, RW - 84, RW - 1
        dark.poly([P(tx0, 0, tz1), P(tx1, 0, tz1), P(tx1, 76, tz1), P(tx0, 76, tz1)], v=225)
        dark.poly([P(tx0, 0, tz1), P(tx0, 76, tz1), P(tx0, 76, tz0), P(tx0, 0, tz0)], v=190)
        hl.poly([P(tx0, 76, tz1), P(tx1, 76, tz1), P(tx1, 76, tz0), P(tx0, 76, tz0)], v=70)
        lz = 1.42                                   # a lamp nobody switched on
        dark.poly([P(tx0 + 30, 76, lz), P(tx0 + 33, 76, lz), P(tx0 + 33, 112, lz), P(tx0 + 30, 112, lz)], v=235)
        dark.poly([P(tx0 + 19, 112, lz), P(tx0 + 44, 112, lz), P(tx0 + 39, 134, lz), P(tx0 + 24, 134, lz)], v=235)
    rgb = lum[..., None] * ROOM
    rgb *= (1 - 0.88 * dark.get())[..., None]
    rgb += (hl.get() * (0.20 + 0.80 * zn))[..., None] * np.array([44, 64, 74], dtype=np.float32)

    # the window, in centimetres on the back wall
    Xb = (xx - cx) * 2.0 / s
    Yb = HC + (yh - yy) * 2.0 / s
    so = 2.4 / s
    glass = soft_box(Xb, -WX, WX, so) * soft_box(Yb, WY0, WY1, so)
    bars = np.maximum.reduce([
        soft_box(Xb, -2.6, 2.6, so),
        soft_box(Xb, -40.4, -38.2, so), soft_box(Xb, 38.2, 40.4, so),
        soft_box(Yb, 157.0, 161.0, so), soft_box(Yb, 84.0, 88.0, so),
        1.0 - soft_box(Xb, -WX + 5.0, WX - 5.0, so) * soft_box(Yb, WY0 + 5.0, WY1 - 5.0, so),
    ])
    light = glass * (0.90 + 0.34 * np.clip((Yb - WY0) / (WY1 - WY0), 0, 1)) * (1 - 0.95 * bars)

    br = Image.new("L", (WP, HP), 0)                 # bare branches outside
    d = ImageDraw.Draw(br)
    rb = np.random.default_rng(21)
    for _ in range(8):
        x, y = rb.uniform(-WX - 70, WX + 70), rb.uniform(10, 110)
        ang, wdt = rb.uniform(math.radians(50), math.radians(130)), rb.uniform(1.4, 2.8)
        for _ in range(10):
            nx, ny = x + math.cos(ang) * 22, y + math.sin(ang) * 22
            d.line([P(x, y, 2.0), P(nx, ny, 2.0)], fill=255, width=max(1, int(round(wdt * s / 2))))
            if rb.uniform() < 0.65:
                a2 = ang + rb.choice([-1, 1]) * rb.uniform(0.5, 1.0)
                d.line([P(nx, ny, 2.0), P(nx + math.cos(a2) * 28, ny + math.sin(a2) * 28, 2.0)],
                       fill=210, width=max(1, int(round(wdt * 0.5 * s / 2))))
            x, y = nx, ny
            ang += rb.uniform(-0.35, 0.35)
            wdt *= 0.84
    light *= 1 - 0.40 * np.asarray(br.filter(ImageFilter.GaussianBlur(2.0 * k)), dtype=np.float32) / 255.0

    ax = np.abs(Xb)                                   # sheer curtains either side
    cur = soft_box(ax, WX - 22.0, WX + 110.0 + 0.9 * np.sin(Yb * 0.07) + 0.6 * np.sin(Yb * 0.19 + 1.3), so * 14) * soft_box(Yb, 1.0, 251.0, so)
    xw = Xb + 0.9 * np.sin(Yb * 0.05 + Xb * 0.21)
    folds = 0.52 + 0.48 * np.abs(np.sin(xw * 0.47 + 1.1 * np.sin(xw * 0.11))) ** 0.75
    sheer = (0.15 + 0.38 * np.exp(-np.clip(ax - WX, 0, None) / 60.0)) * folds
    light = (light * (1 - 0.50 * cur) + sheer * cur) * back
    light = light.astype(np.float32)
    if bgblur > 0:
        light = gblur(light, bgblur * k)             # shallow focus in the closer shot

    haze = 0.50 * gblur(light, 9 * k) + 0.40 * gblur(light, 34 * k) + 0.42 * gblur(light, 105 * k)

    # light on the floor: the pool the window throws, plus its dull reflection
    half = WX + (2.0 - Z) * 62.0
    pool = np.clip((half - np.abs(Xw)) / 16.0 + 0.5, 0, 1) * np.clip((Z - 0.5) / 1.5, 0, 1) ** 1.25 * 0.40
    ybl = yh + s * HC / 2.0
    rows = np.clip(np.round(ybl - (np.arange(HP) - ybl) / 1.7), 0, HP - 1).astype(np.int32)
    refl = gblur(light, 5 * k)[rows, :] * np.exp(-np.clip(yy - ybl, 0, None) / (s * 26.0))
    floor_light = ((pool + 0.30 * gblur(refl, 4 * k)) * floor * floor_mod).astype(np.float32)

    rgb += floor_light[..., None] * POOL
    rgb += haze[..., None] * HAZE
    rgb += light[..., None] * CORE

    if right:                                         # a mirror catching the window
        mz0, mz1 = 1.62, 1.24
        mm = Mask()
        quad = [P(RW - 1, 124, mz0), P(RW - 1, 192, mz0), P(RW - 1, 199, mz1), P(RW - 1, 117, mz1)]
        mm.poly(quad, v=255)
        mir = mm.get(blur=0.5)
        grad = 0.05 + 0.13 * np.clip((yy - quad[2][1]) / max(1.0, quad[3][1] - quad[2][1]), 0, 1)
        rgb += (mir * grad)[..., None] * CORE + (gblur(mir, 12 * k) * 0.07)[..., None] * HAZE

    ch = Mask()                                       # chandelier, hanging between us and the wall
    def Pc(x, y):
        return P(x, y, 1.45)
    cs = s / 1.45
    ch.line([Pc(0, RH), Pc(0, 232)], 1.5 * cs)
    ch.ell(*Pc(0, 229), 4.5 * cs, 6.5 * cs)
    ch.ell(*Pc(0, 220.5), 2.3 * cs, 2.3 * cs)
    for xo in (-35, -19, 19, 35):
        ch.line([Pc(0, 227), Pc(xo * 0.55, 218.5), Pc(xo, 226)], 1.5 * cs)
        ch.ell(*Pc(xo, 228.3), 3.1 * cs, 1.8 * cs)
        ch.poly([Pc(xo - 1.0, 228.3), Pc(xo + 1.0, 228.3), Pc(xo + 1.0, 237), Pc(xo - 1.0, 237)])
    rgb *= (1 - 0.90 * ch.get())[..., None]

    # the figure(s)
    def figure(X0, Zr, mirror, pose):
        sc = s / Zr

        def U(x, y):
            return P(X0 + mirror * x, y, Zr)
        m = Mask()
        draw_body(m, U, sc, pose)
        m.organic(0.5 * sc)
        c = Mask()
        draw_chair(c, U, sc)
        return np.maximum(m.get(), c.get()), U, sc

    def shadow(a, U, sc):
        xc, yf = U(0, 0)
        out = np.zeros((HP, WP), dtype=np.float32)
        y0 = int(math.ceil(yf))
        if y0 >= HP:
            return out
        dd = np.arange(y0, HP, dtype=np.float32) - yf
        sy = np.clip(np.round(yf - dd / 1.45), 0, HP - 1).astype(np.int32)
        fan = 1.0 + 0.55 * dd / (sc * 30.0)
        sx = np.clip(np.round(xc + (np.arange(WP, dtype=np.float32)[None, :] - xc) / fan[:, None]),
                     0, WP - 1).astype(np.int32)
        out[y0:, :] = a[sy[:, None], sx]
        near, far = gblur(out, 1.4 * k), gblur(out, 6.0 * k)
        t = np.clip(dd / (sc * 24.0), 0, 1)[:, None]
        near[y0:, :] = near[y0:, :] * (1 - t) + far[y0:, :] * t
        return near * floor

    def comp(base, a, void=None):
        bl = gblur(base.mean(axis=2), 5 * k) / 255.0
        inner = a * (1 - gblur(a, 2.2 * k))
        fr = np.empty_like(base)
        fr[:] = FIGC
        if void is not None:
            fr *= (1 - 0.86 * void)[..., None]
        fr += (inner * bl * 1.7)[..., None] * WRAP
        return base * (1 - a[..., None]) + fr * a[..., None]

    a1, U1, sc1 = figure(0.0, 1.0, 1, POSE_1)
    hx, hy = body_frames(U1, POSE_1)[1](0.0, 115.0)
    rx, ry = 8.2 * sc1, 10.6 * sc1
    vm = Mask()
    vm.ell(hx, hy, rx, ry)
    void = vm.get(blur=0.13 * rx) * a1
    hm = Mask()
    hm.ell(hx, hy, rx * 1.8, ry * 1.4)
    glow_area = hm.get(blur=0.42 * rx) * a1 * (0.35 + 0.65 * void)

    bg = rgb * (1 - 0.80 * shadow(a1, U1, sc1))[..., None]
    plate = comp(bg, a1, void)

    # light shafts: two versions with different gaps, cross-faded while the film runs
    ox, oy = P(22.0, WY1 + 160.0, 2.0)

    def shafts(seed):
        th = np.arctan2(xx - ox, np.maximum(yy - oy, 1e-3))
        idx = np.clip((th / math.pi + 0.5) * 4095, 0, 4095).astype(np.int32)
        n = np.random.default_rng(seed).uniform(0, 1, 4096)
        for _ in range(3):
            n = np.convolve(np.pad(n, 7, mode="wrap"), np.ones(15) / 15, mode="valid")
        n = (n - n.min()) / (n.max() - n.min())
        src = (light * (0.10 + 0.90 * n[idx] ** 2.0)).astype(np.float32)
        small = src.reshape(HP // 2, 2, WP // 2, 2).mean(axis=(1, 3))
        r = zoom_blur(small, ox / 2, oy / 2)
        r = np.asarray(Image.fromarray(r).resize((WP, HP), Image.BILINEAR), dtype=np.float32)
        return gblur(r, 1.2 * k) * (0.55 + 0.45 * np.clip((ox - xx) / (260 * k) + 0.5, 0, 1))

    rA, rB = shafts(31), shafts(47)
    vg = np.clip(1.0 - 0.38 * (((xx - WP / 2) / (WP * 0.62)) ** 2 + ((yy - HP * 0.46) / (HP * 0.78)) ** 2), 0.25, 1.0)
    if scrim:                                         # keep the text side of the frame quiet
        vg = vg * (1 - 0.55 * np.clip((xx - 0.50 * WP) / (0.22 * WP), 0, 1))
    vg3 = vg[..., None].astype(np.float32)
    gain = 1.15

    out = {
        "plate": (plate * vg3).astype(np.float32),
        "raysA": ((rA * (1 - 0.94 * a1) * gain)[..., None] * HAZE * vg3).astype(np.float32),
        "raysB": ((rB * (1 - 0.94 * a1) * gain)[..., None] * HAZE * vg3).astype(np.float32),
        "vol": ((rA + rB) * 0.5 * vg).astype(np.float32),
        "focus": P(40.0, 92.0) if second else P(0.0, 96.0),
        "k": k,
    }

    if second:                                        # someone sits down next to him
        a2, U2, sc2 = figure(74.0, 1.08, -1, POSE_2)
        bg2 = bg * (1 - 0.80 * shadow(a2, U2, sc2))[..., None]
        plate2 = comp(comp(bg2, a2), a1, void)
        diff = np.abs(plate2 - plate).max(axis=2) > 0.25
        ys, xs = np.where(diff)
        x0, x1 = max(0, xs.min() - 6), min(WP, xs.max() + 7)
        y0, y1 = max(0, ys.min() - 6), min(HP, ys.max() + 7)
        cover = (np.maximum(a1, a2) - a1)[y0:y1, x0:x1]
        v = vg3[y0:y1, x0:x1]
        out["box2"] = (x0, y0, x1, y1)
        out["dplate"] = ((plate2 - plate)[y0:y1, x0:x1] * v).astype(np.float32)
        out["draysA"] = ((-0.94 * gain * rA[y0:y1, x0:x1] * cover)[..., None] * HAZE * v).astype(np.float32)
        out["draysB"] = ((-0.94 * gain * rB[y0:y1, x0:x1] * cover)[..., None] * HAZE * v).astype(np.float32)

    # the amber cluster inside the hood
    gx0, gy0 = max(0, int(hx - 2.6 * rx)), max(0, int(hy - 2.4 * ry))
    gx1, gy1 = min(WP, int(hx + 2.6 * rx) + 1), min(HP, int(hy + 2.4 * ry) + 1)
    sub_y, sub_x = np.mgrid[gy0:gy1, gx0:gx1].astype(np.float32)
    r = np.sqrt(((sub_x - hx) / (rx * 2.0)) ** 2 + ((sub_y - hy) / (ry * 1.8)) ** 2)
    out["glow"] = ((np.clip(1 - r, 0, 1) ** 2.1 * glow_area[gy0:gy1, gx0:gx1])[..., None]
                   * AMBER_F * vg3[gy0:gy1, gx0:gx1]).astype(np.float32)
    out["gpos"] = (gx0, gy0)
    rc = np.random.default_rng(7)
    dots = []
    while len(dots) < 26:
        a, rr = rc.uniform(0, 2 * math.pi), math.sqrt(rc.uniform(0, 1))
        dots.append((hx + math.cos(a) * rx * 0.92 * rr, hy + math.sin(a) * ry * 0.92 * rr,
                     rc.uniform(0, 2 * math.pi)))
    out["dots"] = dots
    dk = max(3, int(round(rx * 0.15)))
    dyy, dxx = np.mgrid[0:dk * 2 + 1, 0:dk * 2 + 1].astype(np.float32)
    out["dk"] = dk
    out["tint"] = (np.clip(1 - np.sqrt((dxx - dk) ** 2 + (dyy - dk) ** 2) / dk, 0, 1) ** 1.6
                   )[..., None] * AMBER_F

    rd = np.random.default_rng(3)                     # dust drifting through the shafts
    n = 110
    out["dust"] = (rd.uniform(0, WP, n), rd.uniform(0, HP, n), rd.uniform(-7, -1.5, n) * k,
                   rd.uniform(-2.5, 2.5, n) * k, rd.uniform(0, 6.28, n), rd.uniform(0.7, 1.6, n))
    return out


_SHOTS = {}


def shot(kind):
    if kind not in _SHOTS:
        _SHOTS[kind] = build_shot(**SHOTS[kind])
    return _SHOTS[kind]


_dy, _dx = np.mgrid[0:7, 0:7].astype(np.float32)
MOTE = (np.exp(-((_dx - 3) ** 2 + (_dy - 3) ** 2) / 2.6))[..., None] * np.array([190, 224, 234], dtype=np.float32)
_g = np.random.default_rng(99)
GRAIN = [_g.normal(0, 2.1, (PH, PW)).astype(np.float32) for _ in range(6)]
TMP = np.empty((HP, WP, 3), dtype=np.float32)


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


def spread(text, font, color, width, pad=6):
    """Letter-spaced to an exact width, the way a title card is set."""
    m = ImageDraw.Draw(Image.new("L", (1, 1)))
    gw = sum(m.textlength(c, font=font) for c in text)
    return tracked(text, font, color, (width - gw) / max(1, len(text) - 1), pad)


def with_shadow(sp, blur=16, strength=0.7, pad=48):
    """Dark halo under light type so it survives a bright window behind it."""
    big = Image.new("RGBA", (sp.size[0] + pad * 2, sp.size[1] + pad * 2), (0, 0, 0, 0))
    a = Image.new("L", big.size, 0)
    a.paste(sp.split()[3], (pad, pad))
    a = a.filter(ImageFilter.GaussianBlur(blur)).point(lambda v: int(min(255, v * 2.2 * strength)))
    big.putalpha(a)
    big.alpha_composite(sp, (pad, pad))
    return big, pad


def caption(text):
    """One line, sized down if it has to be: the caption lives in the lower bar."""
    size = 50
    d = ImageDraw.Draw(Image.new("L", (1, 1)))
    while size > 34 and d.textlength(text, font=fnt(F_REG, size)) > W - 240:
        size -= 2
    font = fnt(F_REG, size)
    wd = int(d.textlength(text, font=font)) + 8
    img = Image.new("RGBA", (wd, int(size * 1.36)), (0, 0, 0, 0))
    ImageDraw.Draw(img).text((4, 0), text, font=font, fill=INK + (255,))
    return img


CAPS = {e["i"]: caption(e["text"]) for e in TL["lines"]}
LABELS = {k: tracked(KAPITEL.get(k, k.upper()), fnt(F_MONO, 24), DIM, 5) for k in ORDER}
BUG = tracked("NARCO CLARITY", fnt(F_MONO, 20), DIM, 7)
PANEL_X, PANEL_W = 1090, 780


def item(title, sub):
    img = Image.new("RGBA", (PANEL_W, 110 if sub else 76), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.ellipse([0, 14, 26, 40], outline=AMBER + (255,), width=3)
    d.text((52, 2), title, font=fnt(F_DISP, 44), fill=INK + (255,))
    if sub:
        d.text((52, 62), sub, font=fnt(F_MONO, 24), fill=DIM + (255,))
    return img


PANELS = {k: [item(a, b) for a, b in v] for k, v in PANEL_SPEC.items()}
TITLE_BIG, TPAD = with_shadow(spread(TITEL.upper(), fnt(F_DISP, 112), INK, 1330))
TITLE_SUB, SPAD = with_shadow(tracked("THE TRUTH BEHIND THE RUSH", fnt(F_MONO, 27), AMBER, 9), 12, 1.0, 30)
DISCLAIM, DPAD = with_shadow(tracked("KEINE VERHERRLICHUNG · KEINE ANLEITUNG", fnt(F_MONO, 22), (156, 162, 168), 5), 12, 1.0, 30)


def help_card():
    img = Image.new("RGBA", (PANEL_W, 490), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    y = 0
    for label, num, note in HILFE:
        d.rectangle([0, y, 5, y + 150], fill=AMBER + (255,))
        d.text((30, y), label, font=fnt(F_MONO, 24), fill=DIM + (255,))
        d.text((30, y + 34), num, font=fnt(F_DISP, 74), fill=INK + (255,))
        d.text((30, y + 122), note, font=fnt(F_MONO, 22), fill=DIM + (255,))
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


def stamp(dst, src, x, y, kk):
    """Additive, clipped to the plate."""
    if kk <= 0.003:
        return
    sh, sw = src.shape[:2]
    x, y = int(x), int(y)
    x0, y0, x1, y1 = max(0, x), max(0, y), min(WP, x + sw), min(HP, y + sh)
    if x1 <= x0 or y1 <= y0:
        return
    dst[y0:y1, x0:x1] += src[y0 - y:y1 - y, x0 - x:x1 - x] * kk


def scene_at(t):
    cur = ORDER[0]
    for k in ORDER:
        if t >= TL["scenes"][k]["start"] - 0.9:
            cur = k
    return cur


def line_at(t):
    for e in TL["lines"]:
        if e["start"] - 0.25 <= t <= e["end"] + 0.45:
            return e
    return None


# camera segments: consecutive scenes that share a setup are one take
SEGS = []
for _sc in ORDER:
    _kind = SCENE_SHOT.get(_sc, "wide")
    if SEGS and SEGS[-1]["kind"] == _kind and _sc != "title" and SEGS[-1]["scenes"][-1] != "title":
        SEGS[-1]["scenes"].append(_sc)
    else:
        SEGS.append({"kind": _kind, "t0": TL["scenes"][_sc]["start"] - 0.9, "scenes": [_sc]})
SEGS[0]["t0"] = 0.0
for _i, _sg in enumerate(SEGS):
    _sg["t1"] = SEGS[_i + 1]["t0"] if _i + 1 < len(SEGS) else TOTAL
    _sg["zoom"] = (0.35, 0.75) if _sg["scenes"] == ["title"] else ZOOM[_sg["kind"]]


def is_cut(i, j):
    """Wide to close on the same axis is a straight cut; everything else dips to black."""
    return SEGS[i]["kind"] == "wide" and SEGS[j]["kind"] == "med"


def seg_at(t):
    for i, sg in enumerate(SEGS):
        if t < sg["t1"]:
            return i
    return len(SEGS) - 1


LOW_BEFORE = [k for k in ("down", "flat", "crave", "lapse") if k in ORDER]


def switch_time(sc):
    """When the picture leaves this scene (None for the last one)."""
    i = ORDER.index(sc)
    return TL["scenes"][ORDER[i + 1]]["start"] - 0.9 if i + 1 < len(ORDER) else None


def help_times(n):
    """The first point lands with the first sentence, the last with the second."""
    ls = [e for e in TL["lines"] if e["scene"] == "help"]
    if n == 0 or not ls:
        return []
    a = ls[0]["start"] - 0.1
    b = ls[1]["start"] - 0.1 if len(ls) > 1 else ls[0]["end"]
    return [a + (b - a) * i / max(1, n - 1) for i in range(n)]


HELP_AT = help_times(len(PANELS.get("help", [])))


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
    if sc == "title" and any(ORDER.index(k) < ORDER.index("title") for k in LOW_BEFORE):
        return 0.13, 0.3, 8                          # nothing has come back yet
    return 0.18 + 0.07 * math.sin(t * 1.6), 0.45, 26


def picture(t):
    """The scene inside the bars, PH x PW float RGB."""
    i = seg_at(t)
    sg = SEGS[i]
    sh = shot(sg["kind"])
    sc = scene_at(t)
    s = TL["scenes"][sc]
    p = float(np.clip((t - s["start"]) / max(0.001, s["end"] - s["start"]), 0, 1.4))
    kq = sh["k"]

    f = sh["plate"].copy()
    ca = 0.42 + 0.78 * (0.5 + 0.5 * math.sin(t * 0.37 + 0.6))
    cb = 0.42 + 0.78 * (0.5 + 0.5 * math.sin(t * 0.23 + 2.1))
    np.multiply(sh["raysA"], ca, out=TMP)
    f += TMP
    np.multiply(sh["raysB"], cb, out=TMP)
    f += TMP

    if "box2" in sh:
        k2 = ease((p - 0.45) / 0.3) if sc == "help" else 1.0 if sc == "outro" else 0.0
        if k2 > 0.003:
            x0, y0, x1, y1 = sh["box2"]
            f[y0:y1, x0:x1] += k2 * (sh["dplate"] + sh["draysA"] * ca + sh["draysB"] * cb)

    glow, rec_a, rec_n = cluster(sc, p, t)
    boost = 1.0 if kq > 1.5 else 1.5                 # the head is small in the wide shots
    gx0, gy0 = sh["gpos"]
    stamp(f, sh["glow"], gx0, gy0, glow * boost)
    dk = sh["dk"]
    for px, py, ph in sh["dots"][:max(0, rec_n)]:
        kk = rec_a * (0.55 + 0.45 * math.sin(t * 1.7 + ph))
        if kk > 0.02:
            stamp(f, sh["tint"], int(px) - dk, int(py) - dk, kk * 1.5 * boost)

    x0s, y0s, vx, vy, phs, szs = sh["dust"]
    vol = sh["vol"]
    xs = (x0s + vx * t + 9 * np.sin(t * 0.31 + phs)) % WP
    ys = (y0s + vy * t + 6 * np.sin(t * 0.23 + phs * 1.7)) % HP
    for j in range(len(xs)):
        v = vol[int(ys[j]), int(xs[j])] * (0.5 + 0.5 * math.sin(t * 1.3 + phs[j] * 3)) * szs[j]
        if v > 0.02:
            stamp(f, MOTE, int(xs[j]) - 3, int(ys[j]) - 3, min(1.0, v * 1.6))

    e = 1.0
    if sc == "title":
        e *= 1 - 0.60 * ease(p * 3)                  # the room steps back behind the title
    if i > 0 and not is_cut(i - 1, i):
        e *= ease((t - sg["t0"]) / 0.7)
    if i + 1 < len(SEGS) and not is_cut(i, i + 1):
        e *= ease((sg["t1"] - t) / 0.45)
    if e < 0.999:
        f *= e

    u = (t - sg["t0"]) / max(0.001, sg["t1"] - sg["t0"])
    z = 1 + (OS - 1) * (sg["zoom"][0] + (sg["zoom"][1] - sg["zoom"][0]) * u)
    fx, fy = sh["focus"]
    bx, by = fx * (1 - 1 / z), fy * (1 - 1 / z)
    img = Image.fromarray(np.clip(f, 0, 255).astype(np.uint8))
    img = img.resize((PW, PH), Image.BICUBIC, box=(bx, by, bx + WP / z, by + HP / z))
    return np.asarray(img, dtype=np.float32), sc, p


def render(t):
    pic, sc, p = picture(t)
    f = np.zeros((H, W, 3), dtype=np.float32)
    pic += GRAIN[(int(round(t * FPS)) * 7) % len(GRAIN)][..., None]
    f[BAR:BAR + PH] = np.clip(pic, 0, 255)

    if sc == "title":
        over(f, TITLE_BIG, (W - TITLE_BIG.size[0]) / 2, 474 - TPAD, ease((p - 0.05) / 0.25))
        over(f, TITLE_SUB, (W - TITLE_SUB.size[0]) / 2, 628 - SPAD, ease((p - 0.25) / 0.25))
        over(f, DISCLAIM, (W - DISCLAIM.size[0]) / 2, 684 - DPAD, ease((p - 0.45) / 0.3))
    elif sc == "outro":
        over(f, HELP, PANEL_X, 296, ease((t - (TL["scenes"][sc]["start"] - 0.75)) / 1.0))
    elif sc in PANELS:
        items = PANELS[sc]
        y0 = 540 - len(items) * 62
        sw = switch_time(sc)
        leave = 1.0 if sw is None else ease((sw - t) / 0.45)      # clear the panel before the next scene
        for i, spr in enumerate(items):
            if sc == "flat":
                kk = 1 - 0.88 * ease((p - 0.18 - i * 0.12) / 0.22)
            elif sc == "crave":
                kk = 0.22 + 0.78 * max(0.0, math.sin(t * 2.9 - i * 1.5)) ** 6
            elif sc == "help":
                kk = ease((t - HELP_AT[i]) / 0.5)
            else:
                kk = ease((p - 0.15 - i * 0.18) / 0.2)
            over(f, spr, PANEL_X, y0 + i * 124, kk * leave)

    over(f, LABELS[sc], 96, 52, 0.9)
    if sc != "title":
        over(f, BUG, W - 96 - BUG.size[0], 55, 0.6)
    ln = None if CLEAN else line_at(t)
    if ln is not None:
        cap = CAPS[ln["i"]]
        fade = min(ease((t - ln["start"] + 0.25) / 0.25), ease((ln["end"] + 0.45 - t) / 0.3))
        over(f, cap, (W - cap.size[0]) / 2, 990 - cap.size[1] / 2, fade)

    if not CLEAN:
        f[H - 34:H - 32, 96:W - 96] = np.array([38, 42, 46], dtype=np.float32)
        ex = int(96 + (W - 192) * min(1.0, t / TOTAL))
        if ex > 96:
            f[H - 34:H - 32, 96:ex] = AMBER_F

    g = ease((t - 0.1) / 1.2) * ease((TOTAL - t) / 0.6)
    if g < 0.999:
        f *= g
    return np.clip(f, 0, 255).astype(np.uint8)


if __name__ == "__main__":
    if "--plates" in sys.argv:
        for kind in SHOTS:
            sh = shot(kind)
            f = sh["plate"] + sh["raysA"] * 0.8 + sh["raysB"] * 0.8
            if "box2" in sh:
                x0, y0, x1, y1 = sh["box2"]
                f[y0:y1, x0:x1] += sh["dplate"] + (sh["draysA"] + sh["draysB"]) * 0.8
            Image.fromarray(np.clip(f, 0, 255).astype(np.uint8)).save(f"plate_{kind}.png")
        print("Plates geschrieben")
    elif "--probe" in sys.argv:
        for ts in sys.argv[sys.argv.index("--probe") + 1].split(","):
            tt = float(ts)
            Image.fromarray(render(tt)).save(f"probe_{int(tt):03d}.png")
        print("Probebilder geschrieben")
    else:
        out = sys.stdout.buffer
        for i in range(int(TOTAL * FPS)):
            out.write(render(i / FPS).tobytes())
        out.flush()
