"""
FR Queue Optimizer — desktop launcher.

Opens as a standalone native app window (no browser needed).
Provides real OS notifications and auto-updates on close/reopen.
"""

from __future__ import annotations

import os
import socket
import sys
import threading
import time


# ── Resource path helper (dev vs. PyInstaller bundle) ──────────────────────────

def resource_path(relative: str) -> str:
    if hasattr(sys, "_MEIPASS"):
        return os.path.join(sys._MEIPASS, relative)
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), relative)


os.environ.setdefault("FLASK_TEMPLATE_FOLDER", resource_path("templates"))
os.environ.setdefault("FLASK_STATIC_FOLDER",   resource_path("static"))

from app import app as flask_app  # noqa: E402
import updater  # noqa: E402


# ── Port helpers ────────────────────────────────────────────────────────────────

def _port_is_free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            s.bind(("127.0.0.1", port))
            return True
        except OSError:
            return False


def _find_free_port(preferred: int = 5000) -> int:
    if _port_is_free(preferred):
        return preferred
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _wait_for_server(port: int, timeout: float = 15.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.25):
                return True
        except OSError:
            time.sleep(0.1)
    return False


# ── JS ↔ Python bridge (real OS notifications + window control) ─────────────────

class Api:
    """Exposed to the web UI as window.pywebview.api.*"""

    def __init__(self) -> None:
        self._window = None

    def set_window(self, window) -> None:
        self._window = window

    def notify(self, title: str, body: str) -> bool:
        """Show a real OS notification and bring the app window forward."""
        shown = False
        try:
            from plyer import notification
            notification.notify(
                title=str(title)[:64],
                message=str(body)[:240],
                app_name="FR Queue Optimizer",
                timeout=15,
            )
            shown = True
        except Exception:
            pass

        # Always try to grab attention by bringing the window to the front
        try:
            if self._window is not None:
                self._window.restore()
                self._window.show()
                try:
                    self._window.on_top = True
                    self._window.on_top = False
                except Exception:
                    pass
        except Exception:
            pass
        return shown

    def update_status(self) -> dict:
        """Return current update state for the UI banner."""
        return dict(updater.update_state)


# ── Main ────────────────────────────────────────────────────────────────────────

def main() -> None:
    # Kick off an update check + background download of the new build
    try:
        updater.check_and_stage(background=True)
    except Exception:
        pass

    port = _find_free_port(5000)
    url  = f"http://127.0.0.1:{port}"

    def _run_flask() -> None:
        flask_app.run(
            host="127.0.0.1", port=port,
            debug=False, use_reloader=False, threaded=True,
        )

    threading.Thread(target=_run_flask, daemon=True).start()

    if not _wait_for_server(port):
        import webbrowser
        webbrowser.open(url)
        while True:
            time.sleep(3600)
        return

    # Try a native desktop window
    try:
        import webview

        api = Api()
        window = webview.create_window(
            title="FR Queue Optimizer",
            url=url,
            width=1280,
            height=900,
            resizable=True,
            min_size=(900, 640),
            text_select=False,
            js_api=api,
        )
        api.set_window(window)

        # webview.start() blocks until the window is closed
        webview.start(debug=False)

        # Window closed → apply any downloaded update, then exit
        try:
            updater.apply_on_exit()
        except Exception:
            pass

    except Exception:
        import webbrowser
        webbrowser.open(url)
        while True:
            time.sleep(3600)


if __name__ == "__main__":
    main()
