"""
Self-update logic for FR Queue Optimizer.

Flow (so users only have to close & reopen):
  1. On startup, a background thread checks GitHub for a newer release.
  2. If found, it downloads the new build to a staging file next to the app.
  3. When the app closes, a tiny helper script swaps the new build in.
  4. Next launch runs the updated version.

Everything is best-effort and fully guarded: if any step fails the app
keeps working and the user can still update manually from the releases page.
"""

from __future__ import annotations

import json
import os
import platform
import subprocess
import sys
import tempfile
import threading
import urllib.request

from version import APP_VERSION, GITHUB_REPO


# ── State shared with the UI ────────────────────────────────────────────────────

update_state: dict = {
    "checked": False,
    "latest": None,
    "update_available": False,
    "downloading": False,
    "staged": False,        # True when a new build is downloaded and ready
    "error": None,
    "download_url": f"https://github.com/{GITHUB_REPO}/releases/latest",
}
_lock = threading.Lock()


def _is_frozen() -> bool:
    """True when running as a bundled PyInstaller executable."""
    return getattr(sys, "frozen", False)


def _version_tuple(v: str) -> tuple:
    try:
        return tuple(int(x) for x in v.strip().lstrip("v").split("."))
    except Exception:
        return (0,)


def _app_path() -> str:
    """Path to the running executable (frozen) or this script (dev)."""
    if _is_frozen():
        return sys.executable
    return os.path.abspath(__file__)


# ── GitHub release lookup ───────────────────────────────────────────────────────

def _fetch_latest_release() -> dict | None:
    url = f"https://api.github.com/repos/{GITHUB_REPO}/releases/latest"
    req = urllib.request.Request(url, headers={"User-Agent": "FRQueueOptimizer"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read())


def _pick_asset(release: dict) -> tuple[str, str] | None:
    """Return (asset_name, download_url) matching this platform."""
    system = platform.system()
    assets = release.get("assets", [])
    for a in assets:
        name = a.get("name", "")
        if system == "Windows" and name.endswith(".exe"):
            return name, a["browser_download_url"]
        if system == "Darwin" and name.endswith("-Mac.zip"):
            return name, a["browser_download_url"]
    return None


# ── Staging download ─────────────────────────────────────────────────────────────

def _staging_path() -> str:
    """Where the freshly downloaded build waits until the app closes."""
    app = _app_path()
    d = os.path.dirname(app)
    if platform.system() == "Windows":
        return os.path.join(d, "FRQueueOptimizer.new.exe")
    # Mac: stage the zip alongside; applied by helper on close
    return os.path.join(d, "FRQueueOptimizer-Mac.new.zip")


def _download(url: str, dest: str) -> None:
    req = urllib.request.Request(url, headers={"User-Agent": "FRQueueOptimizer"})
    tmp = dest + ".part"
    with urllib.request.urlopen(req, timeout=120) as resp, open(tmp, "wb") as f:
        while True:
            chunk = resp.read(65536)
            if not chunk:
                break
            f.write(chunk)
    os.replace(tmp, dest)


def check_and_stage(background: bool = True) -> None:
    """Check GitHub and, if newer, download the build to a staging file."""
    def _run() -> None:
        try:
            release = _fetch_latest_release()
            if not release:
                return
            latest = release.get("tag_name", "").lstrip("v")
            with _lock:
                update_state["checked"] = True
                update_state["latest"] = latest
                update_state["download_url"] = release.get(
                    "html_url", update_state["download_url"]
                )

            newer = _version_tuple(latest) > _version_tuple(APP_VERSION)
            with _lock:
                update_state["update_available"] = newer
            if not newer:
                return

            # Only self-download when running as a bundled app
            if not _is_frozen():
                return

            asset = _pick_asset(release)
            if not asset:
                return
            _, url = asset

            with _lock:
                update_state["downloading"] = True
            try:
                dest = _staging_path()
                _download(url, dest)
                with _lock:
                    update_state["staged"] = True
            finally:
                with _lock:
                    update_state["downloading"] = False
        except Exception as exc:  # never crash the app over an update check
            with _lock:
                update_state["error"] = str(exc)

    if background:
        threading.Thread(target=_run, daemon=True).start()
    else:
        _run()


# ── Apply the staged update when the app closes ──────────────────────────────────

def apply_on_exit() -> None:
    """
    If a staged build exists, spawn a detached helper that waits for this
    process to exit, swaps in the new build, and relaunches the app.
    Safe no-op if nothing is staged or not frozen.
    """
    with _lock:
        staged = update_state.get("staged")
    if not staged or not _is_frozen():
        return

    system = platform.system()
    try:
        if system == "Windows":
            _apply_windows()
        elif system == "Darwin":
            _apply_mac()
    except Exception:
        pass  # leave the staged file; user can still update manually


def _apply_windows() -> None:
    current = sys.executable                    # ...\FRQueueOptimizer.exe
    new = _staging_path()                       # ...\FRQueueOptimizer.new.exe
    if not os.path.exists(new):
        return
    pid = os.getpid()

    bat = os.path.join(tempfile.gettempdir(), "fr_queue_update.bat")
    script = f"""@echo off
rem Wait for the app (PID {pid}) to fully exit
:waitloop
tasklist /FI "PID eq {pid}" 2>NUL | find "{pid}" >NUL
if not errorlevel 1 (
  timeout /t 1 /nobreak >NUL
  goto waitloop
)
rem Swap in the new build
del "{current}" >NUL 2>&1
move /Y "{new}" "{current}" >NUL 2>&1
rem Relaunch
start "" "{current}"
del "%~f0" >NUL 2>&1
"""
    with open(bat, "w") as f:
        f.write(script)

    # Detached, no console window
    CREATE_NO_WINDOW = 0x08000000
    DETACHED_PROCESS = 0x00000008
    subprocess.Popen(
        ["cmd", "/c", bat],
        creationflags=CREATE_NO_WINDOW | DETACHED_PROCESS,
        close_fds=True,
    )


def _apply_mac() -> None:
    """
    On macOS the app is a .app bundle. We staged a zip; a helper unzips it
    over the existing bundle after the app exits, then relaunches.
    """
    new_zip = _staging_path()
    if not os.path.exists(new_zip):
        return

    # Resolve the .app bundle root from the running executable path:
    #   .../FRQueueOptimizer.app/Contents/MacOS/FRQueueOptimizer
    exe = sys.executable
    app_bundle = exe
    for _ in range(3):
        app_bundle = os.path.dirname(app_bundle)
    # app_bundle now ends with FRQueueOptimizer.app
    apps_dir = os.path.dirname(app_bundle)
    pid = os.getpid()

    sh = os.path.join(tempfile.gettempdir(), "fr_queue_update.sh")
    script = f"""#!/bin/bash
while kill -0 {pid} 2>/dev/null; do sleep 1; done
TMP=$(mktemp -d)
unzip -o "{new_zip}" -d "$TMP" >/dev/null 2>&1
if [ -d "$TMP/FRQueueOptimizer.app" ]; then
  rm -rf "{app_bundle}"
  mv "$TMP/FRQueueOptimizer.app" "{apps_dir}/"
fi
rm -f "{new_zip}"
rm -rf "$TMP"
open "{apps_dir}/FRQueueOptimizer.app"
rm -f "$0"
"""
    with open(sh, "w") as f:
        f.write(script)
    os.chmod(sh, 0o755)
    subprocess.Popen(["/bin/bash", sh], start_new_session=True, close_fds=True)
