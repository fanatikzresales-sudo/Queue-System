"""
Self-update logic for FR Queue Optimizer.

Flow (so users only have to close & reopen):
  1. On startup, apply any staged build left from a previous session.
  2. A background thread checks GitHub for a newer release.
  3. If found, it downloads the new build to a staging file next to the app.
  4. When the app closes, a tiny helper script swaps the new build in.
  5. Next launch runs the updated version.

Everything is best-effort and fully guarded: if any step fails the app
keeps working and the user can still update manually from the releases page.
"""

from __future__ import annotations

import atexit
import json
import os
import platform
import subprocess
import sys
import tempfile
import threading
import time
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
_apply_spawned = False


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


def _staging_path() -> str:
    """Where the freshly downloaded build waits until the app closes."""
    app = _app_path()
    d = os.path.dirname(app)
    if platform.system() == "Windows":
        return os.path.join(d, "FRQueueOptimizer.new.exe")
    return os.path.join(d, "FRQueueOptimizer-Mac.new.zip")


def staging_file_ready() -> bool:
    """True when a complete staged build file exists on disk."""
    path = _staging_path()
    try:
        return os.path.isfile(path) and os.path.getsize(path) > 100_000
    except OSError:
        return False


def has_pending_update() -> bool:
    """True when a staged build is ready to swap in."""
    return _is_frozen() and staging_file_ready()


def _sync_staged_flag() -> None:
    with _lock:
        update_state["staged"] = staging_file_ready()


def _log_apply(message: str) -> None:
    try:
        log_path = os.path.join(tempfile.gettempdir(), "fr_queue_update.log")
        with open(log_path, "a", encoding="utf-8") as f:
            f.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {message}\n")
    except OSError:
        pass


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


def _download(url: str, dest: str) -> None:
    req = urllib.request.Request(url, headers={"User-Agent": "FRQueueOptimizer"})
    tmp = dest + ".part"
    if os.path.exists(tmp):
        try:
            os.remove(tmp)
        except OSError:
            pass
    with urllib.request.urlopen(req, timeout=120) as resp, open(tmp, "wb") as f:
        while True:
            chunk = resp.read(65536)
            if not chunk:
                break
            f.write(chunk)
    os.replace(tmp, dest)


def check_and_stage(background: bool = True) -> None:
    """Check GitHub and, if newer, download the build to a staging file."""
    _sync_staged_flag()

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
                update_state["update_available"] = newer or staging_file_ready()
            if staging_file_ready():
                _sync_staged_flag()
                return
            if not newer:
                return

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
                _sync_staged_flag()
                _log_apply(f"Staged update v{latest} at {dest}")
            finally:
                with _lock:
                    update_state["downloading"] = False
        except Exception as exc:
            with _lock:
                update_state["error"] = str(exc)
            _log_apply(f"Update check failed: {exc}")

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
    global _apply_spawned

    if _apply_spawned or not _is_frozen():
        return
    if not staging_file_ready():
        _sync_staged_flag()
        if not staging_file_ready():
            return

    _apply_spawned = True

    system = platform.system()
    try:
        if system == "Windows":
            _apply_windows()
        elif system == "Darwin":
            _apply_mac()
        else:
            return
        _log_apply(f"Spawned update helper for PID {os.getpid()}")
    except Exception as exc:
        _apply_spawned = False
        _log_apply(f"Failed to spawn update helper: {exc}")


def _apply_windows() -> None:
    current = sys.executable
    new = _staging_path()
    if not os.path.exists(new):
        return
    pid = os.getpid()
    backup = current + ".old"

    bat = os.path.join(tempfile.gettempdir(), "fr_queue_update.bat")
    script = f"""@echo off
setlocal EnableExtensions
set PID={pid}
set CURRENT={current}
set NEW={new}
set BACKUP={backup}

rem Wait for the app process to fully exit
:waitloop
tasklist /FI "PID eq %PID%" 2>NUL | findstr /C:"%PID%" >NUL
if %ERRORLEVEL%==0 (
  timeout /t 1 /nobreak >NUL
  goto waitloop
)

rem Extra pause so Windows releases the exe file handle
timeout /t 2 /nobreak >NUL

if not exist "%NEW%" exit /b 1

del /F /Q "%BACKUP%" >NUL 2>&1
if exist "%CURRENT%" move /Y "%CURRENT%" "%BACKUP%" >NUL 2>&1
move /Y "%NEW%" "%CURRENT%"
if errorlevel 1 (
  if exist "%BACKUP%" move /Y "%BACKUP%" "%CURRENT%" >NUL 2>&1
  exit /b 1
)
if exist "%BACKUP%" del /F /Q "%BACKUP%" >NUL 2>&1
start "" "%CURRENT%"
del /F /Q "%~f0" >NUL 2>&1
"""
    with open(bat, "w", encoding="utf-8", newline="\r\n") as f:
        f.write(script)

    CREATE_NO_WINDOW = 0x08000000
    DETACHED_PROCESS = 0x00000008
    subprocess.Popen(
        ["cmd", "/c", bat],
        creationflags=CREATE_NO_WINDOW | DETACHED_PROCESS,
        close_fds=True,
    )


def _apply_mac() -> None:
    new_zip = _staging_path()
    if not os.path.exists(new_zip):
        return

    exe = sys.executable
    app_bundle = exe
    for _ in range(3):
        app_bundle = os.path.dirname(app_bundle)
    apps_dir = os.path.dirname(app_bundle)
    pid = os.getpid()

    sh = os.path.join(tempfile.gettempdir(), "fr_queue_update.sh")
    script = f"""#!/bin/bash
while kill -0 {pid} 2>/dev/null; do sleep 1; done
sleep 2
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
    with open(sh, "w", encoding="utf-8") as f:
        f.write(script)
    os.chmod(sh, 0o755)
    subprocess.Popen(["/bin/bash", sh], start_new_session=True, close_fds=True)


def apply_pending_on_startup() -> bool:
    """
    If a staged build is waiting from a previous session, spawn the swap helper
    and tell the caller to exit immediately so the new build can take over.
    """
    if not has_pending_update():
        return False
    apply_on_exit()
    return _apply_spawned


def register_exit_handler() -> None:
    """Ensure staged updates are applied on any normal process exit."""
    atexit.register(apply_on_exit)
