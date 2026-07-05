#!/usr/bin/env python3
"""Generate Android/iOS app icons and splash screens from assets/logo.png."""

from __future__ import annotations

import sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "pillow", "-q"])
    from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
MOBILE = Path(__file__).resolve().parents[1]
LOGO_SRC = ROOT / "assets" / "logo.png"
WWW_LOGO = MOBILE / "www" / "img" / "logo.png"

ANDROID_RES = MOBILE / "android" / "app" / "src" / "main" / "res"
IOS_ICON = MOBILE / "ios" / "App" / "App" / "Assets.xcassets" / "AppIcon.appiconset" / "AppIcon-512@2x.png"
IOS_SPLASH_DIR = MOBILE / "ios" / "App" / "App" / "Assets.xcassets" / "Splash.imageset"

BG_COLOR = (10, 14, 20, 255)  # matches app theme #0a0e14

ANDROID_LAUNCHER = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192,
}

ANDROID_SPLASH = {
    "drawable-port-mdpi": (320, 480),
    "drawable-port-hdpi": (480, 800),
    "drawable-port-xhdpi": (720, 1280),
    "drawable-port-xxhdpi": (960, 1600),
    "drawable-port-xxxhdpi": (1280, 1920),
    "drawable-land-mdpi": (480, 320),
    "drawable-land-hdpi": (800, 480),
    "drawable-land-xhdpi": (1280, 720),
    "drawable-land-xxhdpi": (1600, 960),
    "drawable-land-xxxhdpi": (1920, 1280),
}


def square_canvas(size: int, color=BG_COLOR) -> Image.Image:
    return Image.new("RGBA", (size, size), color)


def fit_logo_on_canvas(logo: Image.Image, canvas_size: int, padding: float = 0.08) -> Image.Image:
    """Scale logo to fit canvas with padding."""
    canvas = square_canvas(canvas_size)
    usable = int(canvas_size * (1 - padding * 2))
    logo = logo.convert("RGBA")
    logo.thumbnail((usable, usable), Image.LANCZOS)
    x = (canvas_size - logo.width) // 2
    y = (canvas_size - logo.height) // 2
    canvas.paste(logo, (x, y), logo)
    return canvas


def splash_with_logo(logo: Image.Image, width: int, height: int) -> Image.Image:
    canvas = Image.new("RGBA", (width, height), BG_COLOR)
    usable = int(min(width, height) * 0.55)
    img = logo.convert("RGBA").copy()
    img.thumbnail((usable, usable), Image.LANCZOS)
    x = (width - img.width) // 2
    y = (height - img.height) // 2
    canvas.paste(img, (x, y), img)
    return canvas


def notification_icon(logo: Image.Image, size: int = 96) -> Image.Image:
    """White silhouette for Android status bar notifications."""
    src = logo.convert("RGBA").resize((size, size), Image.LANCZOS)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    sp = src.load()
    dp = out.load()
    for y in range(size):
        for x in range(size):
            r, g, b, a = sp[x, y]
            if a > 40:
                dp[x, y] = (255, 255, 255, min(255, a))
    return out


def save_png(img: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if img.mode == "RGBA":
        img.save(path, "PNG", optimize=True)
    else:
        img.convert("RGB").save(path, "PNG", optimize=True)
    print(f"  {path.relative_to(MOBILE)}")


def main() -> None:
    if not LOGO_SRC.exists():
        print(f"ERROR: Logo not found at {LOGO_SRC}")
        sys.exit(1)

    logo = Image.open(LOGO_SRC).convert("RGBA")
    print(f"Using logo: {LOGO_SRC} ({logo.width}x{logo.height})")

    # In-app logo
    WWW_LOGO.parent.mkdir(parents=True, exist_ok=True)
    save_png(logo, WWW_LOGO)

    # Android launcher + adaptive foreground
    for folder, size in ANDROID_LAUNCHER.items():
        icon = fit_logo_on_canvas(logo, size, padding=0.06)
        base = ANDROID_RES / folder
        save_png(icon, base / "ic_launcher.png")
        save_png(icon, base / "ic_launcher_round.png")
        save_png(fit_logo_on_canvas(logo, size, padding=0.12), base / "ic_launcher_foreground.png")

    # Android notification icon (PNG replaces vector for logo visibility)
    notif = notification_icon(logo, 96)
    save_png(notif, ANDROID_RES / "drawable-nodpi" / "ic_stat_icon.png")
    # Remove old vector if present — keep vector as fallback name conflict; use png in drawable
    save_png(notif, ANDROID_RES / "drawable" / "ic_stat_icon.png")

    # Android splash screens
    for folder, (w, h) in ANDROID_SPLASH.items():
        splash = splash_with_logo(logo, w, h)
        save_png(splash, ANDROID_RES / folder / "splash.png")
    save_png(splash_with_logo(logo, 480, 480), ANDROID_RES / "drawable" / "splash.png")

    # iOS app icon (1024)
    ios_icon = fit_logo_on_canvas(logo, 1024, padding=0.06)
    save_png(ios_icon, IOS_ICON)

    # iOS splash
    ios_splash = splash_with_logo(logo, 2732, 2732)
    for name in ("splash-2732x2732.png", "splash-2732x2732-1.png", "splash-2732x2732-2.png"):
        save_png(ios_splash, IOS_SPLASH_DIR / name)

    print("Done — app icons and splash screens updated.")


if __name__ == "__main__":
    main()
