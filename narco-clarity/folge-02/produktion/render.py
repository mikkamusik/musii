#!/usr/bin/env python3
"""NARCO CLARITY – Folge 02 – picture.

Real stock footage (Pexels / Coverr), cut to the finished narration in
build/timeline.json. Every shot is decoded by ffmpeg (trim, speed, crop
box, per-shot pre-grade, channel LUT), then moved here with sub-pixel
precision (slow push-ins / lateral moves), dissolved, graded with grain
and vignette, and overlaid with titles and burned-in subtitles.

  python3 render.py WORKDIR --probe 1.0,7.5,...   -> PNG stills
  python3 render.py WORKDIR --render              -> raw rgb24 to stdout
"""
import sys, os, json, math, subprocess, re
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

WD = sys.argv[1]
RAW = f'{WD}/stock/raw'
OUTW, OUTH, FPS = 1080, 1920, 30
TL = json.load(open(f'{WD}/build/timeline.json', encoding='utf-8'))
TOTAL = TL['total']
NFR = int(round(TOTAL * FPS))
LINES = TL['lines']

TEAL = (38, 224, 210)
WHITE = (255, 255, 255)
F_DISPLAY = '/usr/share/fonts/opentype/inter/InterDisplay-ExtraBold.otf'
F_BLACK = '/usr/share/fonts/opentype/inter/InterDisplay-Black.otf'
F_SUB = '/usr/share/fonts/opentype/inter/Inter-ExtraBold.otf'
F_SEMI = '/usr/share/fonts/opentype/inter/Inter-SemiBold.otf'
F_MED = '/usr/share/fonts/opentype/inter/Inter-Medium.otf'

def L(i, k='start'):
    return LINES[i][k]

# ------------------------------------------------------------------ shots
# win0/win1: (cx, cy, hfrac) crop window at shot start/end, in source-normalised
# coordinates; hfrac = window height / source height (9:16 window).
# pre: ffmpeg filters before the LUT (exposure / white balance per source).
C = dict(  # cut points (centre of the transition) and dissolve lengths
    c1=5.70, c2=8.85, c3=14.00, c4=16.80, c5=18.70, c6=21.45, c7=23.75,
    c8=27.40, c9=30.40, c10=32.70, c11=36.10, card=42.30)
D = dict(c1=.4, c2=.4, c3=.5, c4=.35, c5=.35, c6=.5, c7=.4, c8=.5, c9=.4, c10=1.0, c11=.6)

def span(a, b):
    s = 0.0 if a is None else C[a] - D[a] / 2
    e = C['card'] if b == 'card' else C[b] + D[b] / 2
    return s, e, (0.0 if a is None else D[a])

SHOTS = [
    # S1 – night, man alone on the bed (silhouette), slow dolly-in
    dict(name='S1 Bett', src='p6944074.mp4', tin=31.4, speed=0.80, span=span(None, 'c1'),
         win0=(0.47, 0.43, 0.86), win1=(0.48, 0.42, 0.72),
         pre="curves=all='0/0 0.04/0.03 0.12/0.16 0.35/0.48 0.7/0.82 1/1',colortemperature=temperature=9500:mix=0.6"),
    # S2 – somewhere else: landscape passing a vehicle window
    dict(name='S2 Fenster unterwegs', src='p36827483.mp4', tin=16.4, speed=0.80, span=span('c1', 'c2'),
         win0=(0.46, 0.42, 0.80), win1=(0.47, 0.41, 0.70),
         pre='eq=gamma=0.95:brightness=-0.02'),
    # S2 – holiday room: unused suitcase, the man at the window (pan)
    dict(name='S2 Zimmer Koffer', src='c2737.mp4', tin=1.0, speed=0.75, span=span('c2', 'c3'),
         win0=(0.31, 0.52, 1.00), win1=(0.50, 0.50, 0.94),
         pre='eq=gamma=0.78:brightness=-0.06:contrast=1.05,colortemperature=temperature=8500:mix=0.5'),
    # S4 – help: empty chairs
    dict(name='S4 Stuehle', src='p5712771.mp4', tin=1.0, speed=0.85, span=span('c3', 'c4'),
         win0=(0.50, 0.55, 1.00), win1=(0.50, 0.58, 0.90),
         pre='eq=gamma=1.05'),
    # S4 – anonymous consultation, patient from behind, doctor out of frame
    dict(name='S4 Gespraech', src='p7579331.mp4', tin=0.4, speed=0.85, span=span('c4', 'c5'),
         win0=(0.84, 0.47, 0.94), win1=(0.845, 0.45, 0.88),
         pre='eq=gamma=0.70:brightness=-0.09,colortemperature=temperature=8000:mix=0.5'),
    # S4 – closed door, corridor
    dict(name='S4 Tuer Flur', src='p5203510.mp4', tin=0.0, speed=0.70, span=span('c5', 'c6'),
         win0=(0.44, 0.50, 1.00), win1=(0.47, 0.50, 0.95),
         pre='eq=gamma=0.80:brightness=-0.06,colortemperature=temperature=8500:mix=0.6'),
    # S5 – night, rain on the glass, a silhouette at the window
    dict(name='S5 Regen', src='p31069867.mp4', tin=15.0, speed=0.80, span=span('c6', 'c7'),
         win0=(0.50, 0.50, 1.00), win1=(0.53, 0.47, 0.90),
         pre='eq=gamma=0.95'),
    # S5 – the man at the window at night, slow lateral move
    dict(name='S5 Silhouette', src='p4538212.mp4', tin=4.4, speed=0.80, span=span('c7', 'c8'),
         win0=(0.565, 0.50, 0.96), win1=(0.625, 0.50, 0.96),
         pre='eq=gamma=1.0'),
    # S3 – hands
    dict(name='S3 Haende', src='p13335630.mp4', tin=2.0, speed=0.85, span=span('c8', 'c9'),
         win0=(0.50, 0.52, 1.00), win1=(0.52, 0.50, 0.86),
         pre='eq=gamma=1.0,colortemperature=temperature=9000:mix=0.5'),
    # S3 – alone in the room
    dict(name='S3 allein', src='p6944076.mp4', tin=33.0, speed=0.80, span=span('c9', 'c10'),
         win0=(0.50, 0.60, 0.80), win1=(0.50, 0.61, 0.72),
         pre="eq=gamma=0.85:brightness=-0.03,colortemperature=temperature=12000:mix=0.8"),
    # S3 – slow dissolve to the empty street at night
    dict(name='S3 Strasse', src='p38003073.mp4', tin=0.4, speed=0.75, span=span('c10', 'c11'),
         win0=(0.50, 0.50, 1.00), win1=(0.50, 0.47, 0.90),
         pre='eq=gamma=1.0'),
    # S6 – morning: curtain opens, muted daylight falls in, then it gets darker
    dict(name='S6 Morgen', src='p6944071.mp4', tin=8.3, speed=0.85, span=span('c11', 'card'),
         win0=(0.255, 0.50, 1.00), win1=(0.26, 0.48, 0.90),
         pre='eq=gamma=1.28:saturation=0.6,colortemperature=temperature=11000:mix=0.85'),
]

# ------------------------------------------------------------------ LUT
LUT = f'{WD}/build/narco.cube'

def make_lut(n=33):
    g = np.linspace(0, 1, n)
    b, gg, r = np.meshgrid(g, g, g, indexing='ij')  # cube order: r fastest
    rgb = np.stack([r, gg, b], -1).reshape(-1, 3)
    y = rgb @ np.array([0.2126, 0.7152, 0.0722])
    mx, mn = rgb.max(1), rgb.min(1)
    d = mx - mn + 1e-6
    rr, g2, bb = rgb.T
    h = np.where(mx == rr, ((g2 - bb) / d) % 6, np.where(mx == g2, (bb - rr) / d + 2, (rr - g2) / d + 4)) * 60
    def win(c, w):
        dd = np.minimum(np.abs(h - c), 360 - np.abs(h - c))
        return np.clip(1 - dd / w, 0, 1) ** 1.5
    warm = win(38, 45)
    teal = win(190, 40)
    sat = 0.50 - 0.28 * warm + 0.40 * teal
    out = y[:, None] + (rgb - y[:, None]) * sat[:, None]
    # tone: slightly deeper mids, gentle S, soft highlight roll-off, deep blacks
    yy = out @ np.array([0.2126, 0.7152, 0.0722])
    y1 = np.clip(yy, 0, 1) ** 1.10
    s = y1 * y1 * (3 - 2 * y1)
    y2 = y1 + (s - y1) * 0.35
    y2 = np.maximum(0, (y2 - 0.010) / 0.99) * 0.95
    k = np.where(yy > 1e-4, y2 / np.maximum(yy, 1e-4), 0)
    out = out * k[:, None]
    # split tone: blue-teal shadows, cool neutral highlights
    sh = (1 - np.clip(y2, 0, 1)) ** 3
    hi = np.clip(y2, 0, 1) ** 2
    out += sh[:, None] * np.array([-0.006, 0.010, 0.026]) + hi[:, None] * np.array([-0.012, 0.002, 0.012])
    out *= np.array([0.965, 1.0, 1.035])
    out = np.clip(out, 0, 1)
    with open(LUT, 'w') as f:
        f.write('TITLE "NARCO CLARITY"\nLUT_3D_SIZE %d\n' % n)
        for v in out:
            f.write('%.6f %.6f %.6f\n' % tuple(v))

# ------------------------------------------------------------------ decoding
def probe(path):
    o = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries',
                        'stream=width,height', '-of', 'csv=p=0', path], capture_output=True, text=True).stdout
    w, h = map(int, o.strip().split(',')[:2])
    return w, h

class Reader:
    """Delivers the shot's frames (bounding box of the crop path) at 30 fps."""
    def __init__(self, shot, t0=None, nfr=None):
        self.s = shot
        sw, sh = probe(f"{RAW}/{shot['src']}")
        self.sw, self.sh = sw, sh
        a, b, _ = shot['span']
        self.nfr = int(math.ceil((b - a) * FPS)) + 2 if nfr is None else nfr
        wins = []
        for (cx, cy, hf) in (shot['win0'], shot['win1']):
            wh = hf * sh
            ww = wh * OUTW / OUTH
            wins.append((cx * sw - ww / 2, cy * sh - wh / 2, ww, wh))
        x0 = max(0, min(w[0] for w in wins)); y0 = max(0, min(w[1] for w in wins))
        x1 = min(sw, max(w[0] + w[2] for w in wins)); y1 = min(sh, max(w[1] + w[3] for w in wins))
        bx, by = int(math.floor(x0)) & ~1, int(math.floor(y0)) & ~1
        bw, bh = (int(math.ceil(x1)) - bx + 1) & ~1, (int(math.ceil(y1)) - by + 1) & ~1
        bw, bh = min(bw, sw - bx), min(bh, sh - by)
        sc = OUTH / min(w[3] for w in wins)
        self.ow, self.oh = int(round(bw * sc / 2)) * 2, int(round(bh * sc / 2)) * 2
        self.sx, self.sy = self.ow / bw, self.oh / bh
        self.box = (bx, by)
        self.wins = [((w[0] - bx) * self.sx, (w[1] - by) * self.sy, w[2] * self.sx, w[3] * self.sy) for w in wins]
        start = shot['tin'] + (0 if t0 is None else t0 * shot['speed'])
        dur = (self.nfr + 2) / FPS * shot['speed'] + 0.2
        vf = (f"crop={bw}:{bh}:{bx}:{by},setpts=(PTS-STARTPTS)/{shot['speed']},fps={FPS},"
              f"scale={self.ow}:{self.oh}:flags=lanczos,format=rgb24,{shot['pre']},lut3d=file='{LUT}':interp=tetrahedral,format=rgb24")
        cmd = ['ffmpeg', '-nostdin', '-loglevel', 'error', '-ss', f'{start:.3f}', '-t', f'{dur:.3f}',
               '-i', f"{RAW}/{shot['src']}", '-vf', vf, '-an', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']
        self.p = subprocess.Popen(cmd, stdout=subprocess.PIPE, bufsize=self.ow * self.oh * 3 * 2)
        self.k = 0
        self.last = None

    def frame(self, k_out):
        """frame index k_out within the shot (sequential access)."""
        while self.k <= k_out:
            buf = self.p.stdout.read(self.ow * self.oh * 3)
            if len(buf) == self.ow * self.oh * 3:
                self.last = np.frombuffer(buf, np.uint8).reshape(self.oh, self.ow, 3)
            self.k += 1
        return self.last

    def close(self):
        try:
            self.p.stdout.close(); self.p.kill()
        except Exception:
            pass

def ease(x):
    x = min(1.0, max(0.0, x))
    return x * x * (3 - 2 * x)

def ease_io(x):  # gentle sine ease for camera moves
    x = min(1.0, max(0.0, x))
    return 0.5 - 0.5 * math.cos(math.pi * x)

def place(rd, img, u):
    (x0, y0, w0, h0), (x1, y1, w1, h1) = rd.wins
    e = ease_io(u)
    x, y, w, h = x0 + (x1 - x0) * e, y0 + (y1 - y0) * e, w0 + (w1 - w0) * e, h0 + (h1 - h0) * e
    im = Image.fromarray(img)
    out = im.transform((OUTW, OUTH), Image.AFFINE, (w / OUTW, 0, x, 0, h / OUTH, y), resample=Image.BICUBIC)
    return np.asarray(out).astype(np.float32)

# ------------------------------------------------------------------ text
def font(p, s):
    return ImageFont.truetype(p, s)

def text_block(lines, fnt, color_fn, track=0, lead=1.12, shadow=True, align='center', maxw=None, glow=True):
    """lines: list of list of (word, accent). Returns RGBA image."""
    d = ImageDraw.Draw(Image.new('L', (1, 1)))
    space = d.textlength(' ', font=fnt) + track
    asc, desc = fnt.getmetrics()
    lh = int((asc + desc) * lead)
    widths = []
    for ln in lines:
        w = 0
        for j, (wd, ac) in enumerate(ln):
            w += sum(d.textlength(c, font=fnt) for c in wd) + track * (len(wd) - 1) + (space if j else 0)
        widths.append(w)
    W = int(max(widths)) + 80
    H = lh * len(lines) + 80
    PAD = 40
    txt = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    acc = Image.new('L', (W, H), 0)
    dt, da = ImageDraw.Draw(txt), ImageDraw.Draw(acc)
    for i, ln in enumerate(lines):
        x = 40 + ((W - 80 - widths[i]) / 2 if align == 'center' else 0)
        y = 40 + i * lh
        for j, (wd, ac) in enumerate(ln):
            if j:
                x += space
            col = TEAL if ac else WHITE
            for c in wd:
                dt.text((x, y), c, font=fnt, fill=col + (255,))
                if ac:
                    da.text((x, y), c, font=fnt, fill=255)
                x += d.textlength(c, font=fnt) + track
            x -= track
    alpha = txt.split()[3]
    base = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    if shadow:
        halo = alpha.filter(ImageFilter.GaussianBlur(26)).point(lambda v: min(255, int(v * 0.95)))
        hlimg = Image.new('RGBA', (W, H), (4, 8, 12, 0)); hlimg.putalpha(halo)
        base.alpha_composite(hlimg)
        sh = alpha.filter(ImageFilter.GaussianBlur(9)).point(lambda v: int(v * 0.62))
        shimg = Image.new('RGBA', (W, H), (0, 0, 0, 0)); shimg.putalpha(sh)
        base.alpha_composite(shimg, (0, 4))
        sh2 = alpha.filter(ImageFilter.GaussianBlur(2)).point(lambda v: int(v * 0.45))
        sh2img = Image.new('RGBA', (W, H), (0, 0, 0, 0)); sh2img.putalpha(sh2)
        base.alpha_composite(sh2img, (0, 2))
    if glow:
        gl = acc.filter(ImageFilter.GaussianBlur(12)).point(lambda v: int(v * 0.40))
        glimg = Image.new('RGBA', (W, H), TEAL + (0,)); glimg.putalpha(gl)
        base.alpha_composite(glimg)
    base.alpha_composite(txt)
    return base

def words_of(text, accents):
    acc = set(a.lower() for a in accents)
    out = []
    for wd in text.split():
        key = re.sub(r'[^\wäöüÄÖÜß]', '', wd).lower()
        out.append((wd, key in acc))
    return out

def wrap(words, fnt, maxw, track=0):
    d = ImageDraw.Draw(Image.new('L', (1, 1)))
    lines, cur = [], []
    def wlen(ws):
        s = ' '.join(w for w, _ in ws)
        return d.textlength(s, font=fnt) + track * max(0, len(s) - 1)
    for w in words:
        if cur and wlen(cur + [w]) > maxw:
            lines.append(cur); cur = [w]
        else:
            cur.append(w)
    if cur:
        lines.append(cur)
    # balance two lines
    if len(lines) == 2:
        allw = lines[0] + lines[1]
        best = None
        for k in range(1, len(allw)):
            a, b = wlen(allw[:k]), wlen(allw[k:])
            if a <= maxw and b <= maxw:
                score = abs(a - b) + (0 if a >= b else 25)
                if best is None or score < best[0]:
                    best = (score, k)
        if best:
            lines = [allw[:best[1]], allw[best[1]:]]
    return lines

# ---- subtitles: exact script text, split only where a sentence is too long
SUB_FONT = font(F_SUB, 56)
SUB_MAXW = 860
SUB_Y = 1395          # block centre: lower middle, above the TikTok caption area
CUES_SPEC = {
    0: [("Ich habe sogar im Urlaub versucht,", ['Urlaub']), ("mit Crack aufzuhören.", ['aufzuhören'])],
    1: [("Mehrmals.", ['Mehrmals'])],
    2: [("Ich war raus aus meinem normalen Alltag.", ['Alltag'])],
    3: [("Aber ein anderer Ort hat meine Abhängigkeit", ['Abhängigkeit']), ("nicht einfach beendet.", [])],
    4: [("Ich habe auch ärztliche Hilfe gesucht.", ['ärztliche', 'Hilfe'])],
    5: [("Nicht nur einmal.", [])],
    6: [("Bei wem, das bleibt privat.", ['privat'])],
    7: [("Trotzdem bin ich immer wieder rückfällig geworden.", ['rückfällig'])],
    8: [("Bis heute.", ['Bis', 'heute'])],
    9: [("Von außen sieht man dann oft nur das Ergebnis:", ['Ergebnis']), ("wieder konsumiert.", [])],
    10: [("Was man nicht sieht, sind die Versuche davor.", ['Versuche'])],
    11: [("Ich erzähle das nicht als Erfolgsgeschichte.", ['Erfolgsgeschichte'])],
    12: [("Sondern so, wie es ist.", [])],
    13: [("NARCO CLARITY.", ['CLARITY'])],
    14: [("Folge zwei.", [])],
}

def norm(w):
    return re.sub(r'[^\wäöüß]', '', w.lower())

def build_cues():
    cues = []
    for ln in LINES:
        spec = CUES_SPEC[ln['i']]
        assert ' '.join(t for t, _ in spec) == ln['text'], (spec, ln['text'])
        starts = [ln['start']]
        for (txt, _) in spec[1:]:
            first = norm(txt.split()[0])
            ws = [w for w in ln['words'] if norm(w['w']) == first]
            assert ws, (first, ln['words'])
            starts.append(ws[0]['s'])
        ends = []
        for j in range(len(spec)):
            if j + 1 < len(spec):
                last = norm(spec[j][0].split()[-1])
                ws = [w for w in ln['words'] if norm(w['w']) == last and w['s'] < starts[j + 1] + 0.01]
                ends.append(ws[-1]['e'] if ws else starts[j + 1])
            else:
                ends.append(ln['end'])
        for j, (txt, acc) in enumerate(spec):
            cues.append(dict(text=txt, acc=acc, start=starts[j] - 0.06, end=ends[j] + 0.12))
    for a, b in zip(cues, cues[1:]):
        a['end'] = min(a['end'], b['start'] - 0.04)
    for c in cues:
        lines = wrap(words_of(c['text'], c['acc']), SUB_FONT, SUB_MAXW)
        assert len(lines) <= 2, c['text']
        c['img'] = text_block(lines, SUB_FONT, None, lead=1.16, glow=True)
        c['nlines'] = len(lines)
    return cues

# ---- big documentary titles
TITLE_FONT = font(F_DISPLAY, 80)
TITLE_Y = 690

def title(lines_spec, size=80, track=1, glow=True):
    f = font(F_DISPLAY, size)
    lines = [[(w, w.strip('.,„“').upper() in acc) for w in ln.split()] for ln, acc in lines_spec]
    return text_block(lines, f, None, track=track, lead=1.04, glow=glow)

def build_titles():
    T = []
    T.append(dict(img=title([("ICH HABE SOGAR", []), ("IM URLAUB VERSUCHT", []), ("AUFZUHÖREN.", ['AUFZUHÖREN'])], size=80),
                  a=-1.0, b=C['c1'] - 0.25, y=TITLE_Y, rise=0))
    T.append(dict(img=title([("EIN ANDERER ORT.", []), ("DIESELBE ABHÄNGIGKEIT.", ['ABHÄNGIGKEIT'])], size=70),
                  a=L(3) + 0.05, b=L(3, 'end') + 0.55, y=TITLE_Y))
    T.append(dict(img=title([("ICH HABE MIR", []), ("HILFE GESUCHT.", ['HILFE'])], size=82),
                  a=L(4) - 0.05, b=L(4, 'end') + 0.40, y=TITLE_Y))
    T.append(dict(img=title([("UND WURDE TROTZDEM", []), ("RÜCKFÄLLIG.", ['RÜCKFÄLLIG'])], size=76, glow=False),
                  a=L(7) - 0.05, b=L(7) + 2.0, y=TITLE_Y))
    T.append(dict(img=title([("BIS HEUTE.", [])], size=96),
                  a=L(8) - 0.04, b=C['c8'] - 0.15, y=TITLE_Y))
    lab = text_block([[('SYMBOLBILDER', False)]], font(F_SEMI, 26), None, track=5, shadow=True, glow=False)
    T.append(dict(img=lab, a=-1.0, b=5.2, x=64 - 40, y=205, alpha=0.62, rise=0))
    return T

# ---- end card
def end_card():
    E = []
    f_logo = font(F_BLACK, 112)
    logo = text_block([[('NARCO', False), ('CLARITY', True)]], f_logo, None, track=4, lead=1.0, glow=True)
    E.append(dict(img=logo, a=L(13) - 0.10, b=TOTAL + 1, y=800, fade=0.55))
    line = Image.new('RGBA', (600, 8), (0, 0, 0, 0))
    ImageDraw.Draw(line).rectangle([0, 2, 599, 5], fill=TEAL + (255,))
    E.append(dict(img=line, a=L(13) + 0.35, b=TOTAL + 1, y=905, fade=0.6, wipe=True))
    folge = text_block([[('FOLGE 02', False)]], font(F_SEMI, 46), None, track=14, glow=False)
    E.append(dict(img=folge, a=L(14) - 0.08, b=TOTAL + 1, y=975, fade=0.5))
    weiter = text_block([[('„DIE', False), ('GESCHICHTE', False), ('GEHT', False), ('WEITER.“', False)]],
                        font(F_DISPLAY, 54), None, track=1, glow=False)
    E.append(dict(img=weiter, a=L(14, 'end') + 0.22, b=TOTAL + 1, y=1100, fade=0.7))
    f_h = font(F_MED, 34)
    hl = text_block([[('Hilfe', False), ('&', False), ('Beratung,', False), ('anonym:', False)],
                     [('TelefonSeelsorge', False), ('0800', True), ('111', True), ('0', True), ('111', True), ('·', False), ('kostenlos', False)],
                     [('Sucht-', False), ('&', False), ('Drogen-Hotline', False), ('01806', True), ('313031', True), ('·', False), ('kostenpflichtig', False)]],
                    f_h, None, lead=1.30, glow=False)
    E.append(dict(img=hl, a=L(14, 'end') + 0.55, b=TOTAL + 1, y=1415, fade=0.6, alpha=0.82))
    return E

# ------------------------------------------------------------------ finishing
yy, xx = np.mgrid[0:OUTH, 0:OUTW].astype(np.float32)
rr = np.sqrt(((xx - OUTW / 2) / (OUTW * 0.62)) ** 2 + ((yy - OUTH * 0.47) / (OUTH * 0.60)) ** 2)
VIG = np.clip(1 - 0.42 * np.clip(rr, 0, 1.6) ** 2.3, 0.35, 1)[..., None].astype(np.float32)
RNG = np.random.default_rng(5)

def grain(f, amt=7.5):
    n = RNG.standard_normal((OUTH // 2, OUTW // 2)).astype(np.float32)
    n = np.asarray(Image.fromarray(n).resize((OUTW, OUTH), Image.BILINEAR))
    l = f.mean(2, keepdims=True) / 255.0
    w = 0.55 + 1.6 * l * (1 - l)          # most visible in the mids
    return f + n[..., None] * amt * w

def over(dst, img, cx, cy, alpha):
    if alpha <= 0.003:
        return
    a = np.asarray(img).astype(np.float32)
    h, w = a.shape[:2]
    x, y = int(round(cx - w / 2)), int(round(cy - h / 2))
    x0, y0, x1, y1 = max(0, x), max(0, y), min(OUTW, x + w), min(OUTH, y + h)
    if x1 <= x0 or y1 <= y0:
        return
    s = a[y0 - y:y1 - y, x0 - x:x1 - x]
    al = s[..., 3:4] / 255.0 * alpha
    dst[y0:y1, x0:x1] = dst[y0:y1, x0:x1] * (1 - al) + s[..., :3] * al

def fade_k(t, a, b, fi=0.35, fo=0.30):
    return min(ease((t - a) / fi), ease((b - t) / fo))

# ------------------------------------------------------------------ main loop
def picture_alpha(t):
    """overall picture visibility: fade in from black, darken into the end card."""
    k = 0.45 + 0.55 * ease(t / 0.6)          # no black first frame: the hook is visible at once
    dark_from, dark_to = C['card'] - 2.6, C['card'] - 0.05
    k *= 1 - 0.92 * ease((t - dark_from) / (dark_to - dark_from)) ** 1.2
    if t >= C['card']:
        k = 0
    return k

def compose(t, frames):
    # frames are in timeline order; each incoming shot dissolves over the previous
    f = None
    for sh, img in frames:
        a, b, din = sh['span']
        w = 1.0 if din <= 0 else ease((t - a) / din)
        f = img.copy() if f is None else f * (1 - w) + img * w
    f *= picture_alpha(t)
    f *= VIG
    f = grain(f)
    return f

def render(times, sink):
    make_lut()
    cues = build_cues()
    titles = build_titles()
    card = end_card()
    readers = {}
    for n, t in times:
        frames = []
        for si, sh in enumerate(SHOTS):
            a, b, _ = sh['span']
            if a - 1e-6 <= t < b:
                if si not in readers:
                    if sink is None:
                        readers[si] = Reader(sh, t0=t - a, nfr=3)
                        readers[si].base = int(round((t - a) * FPS))
                    else:
                        readers[si] = Reader(sh)
                        readers[si].base = 0
                rd = readers[si]
                k = int(round((t - a) * FPS)) - rd.base
                img = rd.frame(k)
                u = (t - a) / (b - a)
                frames.append((sh, place(rd, img, u)))
            elif t >= b and si in readers and sink is not None:
                readers.pop(si).close()
        if sink is None:
            for si in list(readers):
                readers.pop(si).close()
        f = compose(t, frames) if frames else np.zeros((OUTH, OUTW, 3), np.float32)
        if not frames:
            f = grain(f, 3.0)
        for T in titles:
            if T['a'] - 0.4 <= t <= T['b'] + 0.4:
                k = fade_k(t, T['a'], T['b'])
                rise = T.get('rise', 14) * (1 - ease((t - T['a']) / 0.5))
                cx = T['x'] + T['img'].size[0] / 2 if 'x' in T else OUTW / 2
                over(f, T['img'], cx, T['y'] + rise, k * T.get('alpha', 1.0))
        for c in cues:
            if c['start'] <= t <= c['end']:
                k = min(ease((t - c['start']) / 0.10), ease((c['end'] - t) / 0.10))
                over(f, c['img'], OUTW / 2, SUB_Y, k)
        if t >= C['card'] - 0.2:
            fin = 1 - ease((t - (TOTAL - 0.95)) / 0.9)
            for E in card:
                if t >= E['a'] - 0.05:
                    k = ease((t - E['a']) / E['fade']) * fin * E.get('alpha', 1.0)
                    img = E['img']
                    if E.get('wipe'):
                        p = ease((t - E['a']) / 0.9)
                        wv = max(2, int(img.size[0] * p))
                        img = img.crop(((img.size[0] - wv) // 2, 0, (img.size[0] + wv) // 2, img.size[1]))
                    over(f, img, OUTW / 2, E['y'] + 10 * (1 - ease((t - E['a']) / 0.6)), k)
        out = np.clip(f, 0, 255).astype(np.uint8)
        if sink is None:
            Image.fromarray(out).save(f"{WD}/build/probe_{t:06.2f}.png")
        else:
            sink.write(out.tobytes())
    for r in readers.values():
        r.close()

if __name__ == '__main__':
    if '--probe' in sys.argv:
        ts = [float(x) for x in sys.argv[sys.argv.index('--probe') + 1].split(',')]
        render([(int(round(t * FPS)), t) for t in ts], None)
        print('probes written')
    elif '--srt' in sys.argv:
        def ts(x):
            ms = int(round(x * 1000)); h, ms = divmod(ms, 3600000); m, ms = divmod(ms, 60000); s_, ms = divmod(ms, 1000)
            return f'{h:02d}:{m:02d}:{s_:02d},{ms:03d}'
        out = []
        for n, c in enumerate(build_cues(), 1):
            lines = wrap(words_of(c['text'], c['acc']), SUB_FONT, SUB_MAXW)
            txt = '\n'.join(' '.join(w for w, _ in ln) for ln in lines)
            out.append(f"{n}\n{ts(c['start'])} --> {ts(c['end'])}\n{txt}\n")
        open(sys.argv[sys.argv.index('--srt') + 1], 'w', encoding='utf-8').write('\n'.join(out))
        print('srt written')
    elif '--cues' in sys.argv:
        for c in build_cues():
            print(f"{c['start']:6.2f} {c['end']:6.2f} [{c['nlines']}] {c['text']}")
    else:
        sink = sys.stdout.buffer
        render([(n, n / FPS) for n in range(NFR)], sink)
        sink.flush()
