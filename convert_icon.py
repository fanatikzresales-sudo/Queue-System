"""
Convert logo.png into platform icon files before PyInstaller builds.

Usage:  python convert_icon.py
Output: assets/icon.ico  (Windows)
        assets/icon.icns (Mac)
"""

from __future__ import annotations
import os
import sys
import struct
import zlib
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    print("Installing Pillow…")
    os.system(f"{sys.executable} -m pip install pillow -q")
    from PIL import Image


SRC  = Path("assets/logo.png")
ICO  = Path("assets/icon.ico")
ICNS = Path("assets/icon.icns")

WIN_SIZES  = [16, 32, 48, 64, 128, 256]
MAC_SIZES  = [16, 32, 64, 128, 256, 512, 1024]

# ICNS type codes for each size
ICNS_CODES = {
    16:   b"icp4",
    32:   b"icp5",
    64:   b"icp6",
    128:  b"ic07",
    256:  b"ic08",
    512:  b"ic09",
    1024: b"ic10",
}


def make_ico(src: Image.Image, dest: Path) -> None:
    imgs = []
    for size in WIN_SIZES:
        img = src.copy()
        img.thumbnail((size, size), Image.LANCZOS)
        # Ensure RGBA
        if img.mode != "RGBA":
            img = img.convert("RGBA")
        imgs.append(img)
    imgs[-1].save(dest, format="ICO", sizes=[(s, s) for s in WIN_SIZES])
    print(f"  ✓ {dest}")


def make_icns(src: Image.Image, dest: Path) -> None:
    """Build a minimal ICNS file from PNG blobs."""
    chunks = b""
    for size in MAC_SIZES:
        if size not in ICNS_CODES:
            continue
        img = src.copy()
        img.thumbnail((size, size), Image.LANCZOS)
        if img.mode != "RGBA":
            img = img.convert("RGBA")

        import io
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        png_data = buf.getvalue()

        code = ICNS_CODES[size]
        chunk_len = 8 + len(png_data)
        chunks += code + struct.pack(">I", chunk_len) + png_data

    total = 8 + len(chunks)
    icns_data = b"icns" + struct.pack(">I", total) + chunks
    dest.write_bytes(icns_data)
    print(f"  ✓ {dest}")


def main() -> None:
    if not SRC.exists():
        print(f"ERROR: {SRC} not found.")
        print("Add your logo as  assets/logo.png  and run again.")
        sys.exit(1)

    Path("assets").mkdir(exist_ok=True)

    print(f"Converting {SRC} …")
    src_img = Image.open(SRC).convert("RGBA")

    make_ico(src_img, ICO)
    make_icns(src_img, ICNS)
    print("Done.")


if __name__ == "__main__":
    main()
