"""
Convert assets/logo.png into platform icon files before PyInstaller builds.

Output: assets/icon.ico  (Windows)
        assets/icon.icns (macOS)

macOS icons are built with Apple's own `iconutil` when available (it runs
on the GitHub Actions macOS runner), which guarantees a valid .icns.
Falls back to Pillow's native ICNS encoder otherwise.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    print("Installing Pillow...")
    os.system(f"{sys.executable} -m pip install pillow -q")
    from PIL import Image


SRC = Path("assets/logo.png")
ICO = Path("assets/icon.ico")
ICNS = Path("assets/icon.icns")
ICONSET = Path("assets/icon.iconset")

WIN_SIZES = [16, 32, 48, 64, 128, 256]


def make_ico(src: Image.Image) -> None:
    src.save(ICO, format="ICO", sizes=[(s, s) for s in WIN_SIZES])
    print(f"  OK {ICO}")


def _square(src: Image.Image, size: int) -> Image.Image:
    """Return a square RGBA image of exactly size x size."""
    img = src.convert("RGBA").resize((size, size), Image.LANCZOS)
    return img


def make_icns_with_iconutil(src: Image.Image) -> bool:
    """Build a proper .icns using macOS iconutil. Returns True on success."""
    if not shutil.which("iconutil"):
        return False

    if ICONSET.exists():
        shutil.rmtree(ICONSET)
    ICONSET.mkdir(parents=True)

    # Apple's required iconset members (base + @2x retina variants)
    members = [
        (16, "icon_16x16.png"),
        (32, "icon_16x16@2x.png"),
        (32, "icon_32x32.png"),
        (64, "icon_32x32@2x.png"),
        (128, "icon_128x128.png"),
        (256, "icon_128x128@2x.png"),
        (256, "icon_256x256.png"),
        (512, "icon_256x256@2x.png"),
        (512, "icon_512x512.png"),
        (1024, "icon_512x512@2x.png"),
    ]
    for size, name in members:
        _square(src, size).save(ICONSET / name, format="PNG")

    try:
        subprocess.run(
            ["iconutil", "-c", "icns", str(ICONSET), "-o", str(ICNS)],
            check=True,
        )
        print(f"  OK {ICNS} (iconutil)")
        return True
    except subprocess.CalledProcessError:
        return False
    finally:
        shutil.rmtree(ICONSET, ignore_errors=True)


def make_icns_with_pillow(src: Image.Image) -> None:
    """Fallback: Pillow's native ICNS encoder (needs a 1024 square source)."""
    big = _square(src, 1024)
    big.save(ICNS, format="ICNS")
    print(f"  OK {ICNS} (pillow)")


def main() -> None:
    if not SRC.exists():
        print(f"ERROR: {SRC} not found. Add your logo as assets/logo.png.")
        sys.exit(1)

    Path("assets").mkdir(exist_ok=True)
    print(f"Converting {SRC} ...")
    src_img = Image.open(SRC).convert("RGBA")

    make_ico(src_img)

    if not make_icns_with_iconutil(src_img):
        try:
            make_icns_with_pillow(src_img)
        except Exception as exc:
            print(f"  WARN could not build .icns: {exc}")

    print("Done.")


if __name__ == "__main__":
    main()
