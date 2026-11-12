"""Draws DRONE 3D's icons (public/icons): a drone seen from above, orange on the barangay hall's navy.
Run: python3 scripts/make-icons.py  (needs Pillow). The icons are committed; run it again only to change them."""
from pathlib import Path
from PIL import Image, ImageDraw

NAVY, CREAM, ORANGE, ARM, GREEN, RED = (22, 48, 63), (255, 245, 223), (255, 122, 26), (92, 106, 115), (63, 191, 90), (226, 56, 43)
OUT = Path(__file__).resolve().parent.parent / 'public' / 'icons'


def drone(d, s, ox, oy, k):
    """The drone in a square of side k (in units of 64), at (ox, oy), drawn s times larger."""
    u = lambda v: v * k / 64 * s
    p = lambda x, y: (ox * s + u(x), oy * s + u(y))
    for (x0, y0, x1, y1) in [(17, 17, 47, 47), (47, 17, 17, 47)]:
        d.line([p(x0, y0), p(x1, y1)], fill=ARM, width=int(u(5.5)))
    for (cx, cy) in [(16, 16), (48, 16), (16, 48), (48, 48)]:
        r = 9.5
        d.ellipse([p(cx - r, cy - r), p(cx + r, cy + r)], fill=(70, 92, 104), outline=CREAM, width=max(2, int(u(2.4))))
        d.ellipse([p(cx - 1.6, cy - 1.6), p(cx + 1.6, cy + 1.6)], fill=CREAM)
    d.rounded_rectangle([p(24, 21), p(40, 43)], radius=u(4.5), fill=ORANGE)
    d.ellipse([p(29, 23.5), p(35, 29.5)], fill=NAVY)
    d.rectangle([p(26, 40), p(29, 43)], fill=GREEN)
    d.rectangle([p(35, 40), p(38, 43)], fill=GREEN)
    d.rectangle([p(26, 21), p(29, 23)], fill=RED)
    d.rectangle([p(35, 21), p(38, 23)], fill=RED)


def icon(size, maskable=False, rounded=True):
    s = 4  # drawn larger, then made smaller, for smooth edges
    img = Image.new('RGBA', (size * s, size * s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if maskable or not rounded:
        d.rectangle([0, 0, size * s, size * s], fill=NAVY)
    else:
        d.rounded_rectangle([0, 0, size * s - 1, size * s - 1], radius=size * s * 0.22, fill=NAVY)
    # a maskable icon keeps its drawing inside the middle 80%, where every phone's mask leaves it whole
    k = size * (0.62 if maskable else 0.86)
    o = (size - k) / 2
    drone(d, s, o, o, k)
    return img.resize((size, size), Image.LANCZOS)


OUT.mkdir(parents=True, exist_ok=True)
icon(192).save(OUT / 'icon-192.png')
icon(512).save(OUT / 'icon-512.png')
icon(512, maskable=True).save(OUT / 'icon-maskable-512.png')
icon(180, rounded=False).convert('RGB').save(OUT / 'apple-touch-icon.png')
print('icons written to', OUT)
