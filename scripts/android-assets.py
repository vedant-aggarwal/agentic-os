# Makes the Android launcher icons and splash from the iPhone app's icon.
# Run from the repo root: python scripts/android-assets.py
import sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
ICON = ROOT / "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png"
RES = ROOT / "android/app/src/main/res"
BG = (11, 12, 18)  # #0b0c12, the splash colour in capacitor.config.json
DENSITIES = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}

src = Image.open(ICON).convert("RGBA")
# Android masks the icon to a circle (launcher and the Android 12 splash), which clips the bottom bar, so the
# marks are lifted off the gradient: the gradient is the icon with the marks median-filtered away.
MARK_SCALE = 0.78
# the gradient: a cubic surface per channel, fitted to the pixels around the marks
px = np.asarray(src.convert("RGB"), dtype=np.float64)
n = px.shape[0]
yy, xx = np.mgrid[0:n, 0:n] / n
terms = lambda x, y: np.stack([x**i * y**j for i in range(4) for j in range(4 - i)], -1)
A = terms(xx, yy)
around = (xx < 0.15) | (xx > 0.83) | (yy < 0.22) | (yy > 0.85)
coef = np.linalg.lstsq(A[around], px[around], rcond=None)[0]
ground = Image.fromarray(np.clip(A @ coef, 0, 255).astype(np.uint8), "RGB")
diff = ImageChops.difference(src.convert("RGB"), ground).convert("L")
alpha = diff.point(lambda v: 0 if v < 14 else min(255, (v - 14) * 8)).filter(ImageFilter.GaussianBlur(1))
marks = src.copy()
marks.putalpha(alpha)


def masked(img, shape):
    m = Image.new("L", img.size, 0)
    d = ImageDraw.Draw(m)
    w, h = img.size
    if shape == "round":
        d.ellipse((0, 0, w - 1, h - 1), fill=255)
    else:
        d.rounded_rectangle((0, 0, w - 1, h - 1), radius=int(w * 0.18), fill=255)
    out = Image.new("RGBA", img.size, (0, 0, 0, 0))
    out.paste(img, (0, 0), m)
    return out


for name, k in DENSITIES.items():
    d = RES / f"mipmap-{name}"
    d.mkdir(parents=True, exist_ok=True)
    legacy = src.resize((round(48 * k),) * 2, Image.LANCZOS)
    masked(legacy, "square").save(d / "ic_launcher.png")
    masked(legacy, "round").save(d / "ic_launcher_round.png")
    # adaptive icon: the gradient as the background layer, the marks shrunk into the round safe zone in front
    side = round(108 * k)
    ground.resize((side, side), Image.LANCZOS).save(d / "ic_launcher_background.png")
    fg = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    m = marks.resize((round(side * MARK_SCALE),) * 2, Image.LANCZOS)
    fg.paste(m, ((side - m.width) // 2,) * 2, m)
    fg.save(d / "ic_launcher_foreground.png")

(RES / "values/ic_launcher_background.xml").write_text(
    '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n'
    '    <color name="ic_launcher_background">#0B0C12</color>\n</resources>\n'
)
for f in ("ic_launcher.xml", "ic_launcher_round.xml"):
    (RES / "mipmap-anydpi-v26" / f).write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
        '    <background android:drawable="@mipmap/ic_launcher_background"/>\n'
        '    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n'
        '</adaptive-icon>\n'
    )
# `--preview out.png`: the icon through the round safe-zone mask, for checking the marks clear it
if len(sys.argv) > 2 and sys.argv[1] == "--preview":
    prev = ground.convert("RGBA")
    m = marks.resize((round(1024 * MARK_SCALE),) * 2, Image.LANCZOS)
    prev.paste(m, ((1024 - m.width) // 2,) * 2, m)
    masked(prev.crop((171, 171, 853, 853)), "round").save(sys.argv[2])

# splash: the icon's marks centred on the dark background, for every drawable folder Capacitor made
mark = src.resize((288, 288), Image.LANCZOS)
for d in RES.glob("drawable*"):
    f = d / "splash.png"
    if not f.exists():
        continue
    w, h = Image.open(f).size
    s = Image.new("RGBA", (w, h), BG + (255,))
    side = min(w, h) // 3
    m = masked(mark.resize((side, side), Image.LANCZOS), "square")
    s.paste(m, ((w - side) // 2, (h - side) // 2), m)
    s.convert("RGB").save(f)
print("android icons and splash ready")
