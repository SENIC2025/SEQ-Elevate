#!/usr/bin/env python3
"""
Generates every SEQ Elevate logo file the app serves, from one master: the
official lockup supplied by the owner (the arcs "mark" + the "SEQ Elevate"
wordmark + the "Skills for the Future" tagline, black on transparent).

    python3 scripts/brand-assets.py [owner-logo.png]    # needs Pillow

Given the owner's file, it is first trimmed to its content and saved as the
master, public/brand/seq-elevate-lockup.png. Without an argument the committed
master is reused, so everything can be regenerated from the repo alone.
Nothing is ever enlarged past the master's resolution except the mark in the
big PWA icons (LANCZOS, checked by eye).

Outputs (sizes are in pixels; keep BrandLogo.tsx and invite-email.ts in step):
  public/brand/seq-elevate-lockup.png     master lockup, transparent
  public/brand/seq-elevate-mark.png       the mark alone, transparent
  public/brand/seq-elevate-email-2x.png   lockup on WHITE for emails, shown at
                                          half size; white so dark-mode mail
                                          apps can't hide the black lettering
  public/brand/icon-{192,512}.png         PWA icons, purpose "any", transparent
  public/brand/icon-maskable-{192,512}.png  PWA icons, purpose "maskable":
                                          white, mark inside the safe zone
  src/app/favicon.ico                     16 / 32 / 48, transparent
  src/app/icon.png                        96, transparent
  src/app/apple-icon.png                  180, white (iOS rounds the corners)
  src/app/opengraph-image.png             1200x630 link preview, white
  src/app/twitter-image.png               same image, for X / Twitter cards
"""

import sys
from pathlib import Path

from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
BRAND = ROOT / "public" / "brand"
APP = ROOT / "src" / "app"
MASTER = BRAND / "seq-elevate-lockup.png"

# Transparent margin kept around the lockup and the mark, so resampling never
# clips an anti-aliased edge.
PAD = 4
WHITE = (255, 255, 255, 255)
LANCZOS = Image.Resampling.LANCZOS


def trim(img: Image.Image, pad: int = 0) -> Image.Image:
    """Crops to the visible pixels, then adds `pad` transparent pixels."""
    content = img.crop(img.getchannel("A").getbbox())
    if not pad:
        return content
    out = Image.new("RGBA", (content.width + 2 * pad, content.height + 2 * pad))
    out.alpha_composite(content, (pad, pad))
    return out


def split_mark(lockup: Image.Image) -> Image.Image:
    """The mark is the left-most shape: everything before the first fully
    transparent column that separates it from the wordmark."""
    alpha = lockup.getchannel("A")
    for x in range(lockup.width):
        if not alpha.crop((x, 0, x + 1, lockup.height)).getbbox():
            return trim(lockup.crop((0, 0, x, lockup.height)))
    raise SystemExit("No gap between the mark and the wordmark found.")


def fit(img: Image.Image, width: float, height: float) -> Image.Image:
    """Scales to fit the box, keeping proportions. Pillow resizes RGBA with
    premultiplied alpha, so edges don't pick up a dark or light fringe."""
    scale = min(width / img.width, height / img.height)
    size = (max(1, round(img.width * scale)), max(1, round(img.height * scale)))
    return img.resize(size, LANCZOS)


def canvas(img: Image.Image, width: int, height: int, background=None) -> Image.Image:
    """Centres `img` on a width x height canvas (opaque when a background is
    given, so it can be saved without an alpha channel)."""
    out = Image.new("RGBA", (width, height), background or (0, 0, 0, 0))
    out.alpha_composite(img, ((width - img.width) // 2, (height - img.height) // 2))
    return out.convert("RGB") if background else out


def square_icon(mark: Image.Image, size: int, margin: float, background=None) -> Image.Image:
    box = size - 2 * margin
    return canvas(fit(mark, box, box), size, size, background)


def crisp(img: Image.Image) -> Image.Image:
    """At favicon sizes the see-through gaps between the arcs blur into the
    arcs. Sharpening only the alpha channel brings the stripes back without
    shifting the colours."""
    r, g, b, a = img.split()
    return Image.merge("RGBA", (r, g, b, a.filter(ImageFilter.UnsharpMask(1, 100, 0))))


def maskable_icon(mark: Image.Image, size: int) -> Image.Image:
    """Launchers crop maskable icons to any shape that contains the central
    circle of 80% diameter, so the mark's whole box must fit in that circle."""
    diagonal = (mark.width**2 + mark.height**2) ** 0.5
    scale = 0.78 * size / diagonal
    return canvas(fit(mark, mark.width * scale, mark.height * scale), size, size, WHITE)


def save(img: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, optimize=True)
    print(f"{path.relative_to(ROOT)}  {img.width}x{img.height}  {path.stat().st_size / 1024:.1f} KB")


def main() -> None:
    if len(sys.argv) > 1:
        save(trim(Image.open(sys.argv[1]).convert("RGBA"), PAD), MASTER)
    master = Image.open(MASTER).convert("RGBA")
    lockup = trim(master)
    mark = split_mark(lockup)

    save(trim(mark, PAD), BRAND / "seq-elevate-mark.png")

    # Email header: shown at 200 px wide, so 400 px for sharp high-DPI screens,
    # with a slim white border so it reads as a deliberate tile in dark mode.
    border = 12
    email = fit(lockup, 400 - 2 * border, lockup.height)
    height = email.height + 2 * border
    save(canvas(email, 400, height + height % 2, WHITE), BRAND / "seq-elevate-email-2x.png")

    for size in (192, 512):
        save(square_icon(mark, size, size * 0.08), BRAND / f"icon-{size}.png")
        save(maskable_icon(mark, size), BRAND / f"icon-maskable-{size}.png")

    # Favicons: the mark is tall and narrow, so let it use the full height.
    favicons = {
        size: crisp(square_icon(mark, size, 0 if size == 16 else 1)) for size in (16, 32, 48)
    }
    favicons[48].save(
        APP / "favicon.ico",
        sizes=[(s, s) for s in favicons],
        append_images=[favicons[16], favicons[32]],
    )
    print(f"src/app/favicon.ico  16/32/48  {(APP / 'favicon.ico').stat().st_size / 1024:.1f} KB")
    save(square_icon(mark, 96, 3), APP / "icon.png")
    save(square_icon(mark, 180, 180 * 0.15, WHITE), APP / "apple-icon.png")

    # Link previews: the lockup at its own size, centred with wide margins.
    # At 604 px wide it also survives the square centre-crop some apps use.
    preview = canvas(lockup, 1200, 630, WHITE)
    save(preview, APP / "opengraph-image.png")
    save(preview, APP / "twitter-image.png")


if __name__ == "__main__":
    main()
