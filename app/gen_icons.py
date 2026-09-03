from PIL import Image, ImageDraw
import math

NAVY = (35, 57, 91, 255)
GOLD = (217, 181, 104, 255)
GOLD_DIM = (169, 130, 47, 140)


def make_icon(size, maskable=False, out="icon.png"):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    pad = size * 0.18 if maskable else 0
    bg_box = [pad, pad, size - pad, size - pad]
    radius = (size - 2 * pad) * (0.22 if maskable else 0.22)
    d.rounded_rectangle(bg_box, radius=radius, fill=NAVY)

    cx, cy = size / 2, size / 2
    max_r = (size - 2 * pad) * 0.34

    for i, frac in enumerate([1.0, 0.66, 0.33]):
        r = max_r * frac
        width = max(2, int(size * 0.014))
        color = GOLD if i == 0 else GOLD_DIM
        d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=color, width=width)

    # sweep line
    ang = math.radians(-40)
    x2 = cx + max_r * math.cos(ang)
    y2 = cy + max_r * math.sin(ang)
    d.line([cx, cy, x2, y2], fill=GOLD, width=max(2, int(size * 0.016)))

    dot_r = size * 0.028
    d.ellipse([cx - dot_r, cy - dot_r, cx + dot_r, cy + dot_r], fill=GOLD)

    img.save(out)


make_icon(192, maskable=False, out="public/icon-192.png")
make_icon(512, maskable=False, out="public/icon-512.png")
make_icon(512, maskable=True, out="public/icon-512-maskable.png")
make_icon(180, maskable=False, out="public/apple-touch-icon.png")
print("icons generated")
