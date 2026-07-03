"""
Walmart Queue Optimizer — desktop launcher.

Opens as a standalone native app window (no browser needed).
Double-click the executable on Windows or the .app on Mac.
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


# Point Flask at bundled assets before importing app
os.environ.setdefault("FLASK_TEMPLATE_FOLDER", resource_path("templates"))
os.environ.setdefault("FLASK_STATIC_FOLDER",   resource_path("static"))

from app import app as flask_app  # noqa: E402


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


# ── Main ────────────────────────────────────────────────────────────────────────

def main() -> None:
    port = _find_free_port(5000)
    url  = f"http://127.0.0.1:{port}"

    # Start Flask in a background daemon thread
    def _run_flask() -> None:
        flask_app.run(
            host="127.0.0.1",
            port=port,
            debug=False,
            use_reloader=False,
            threaded=True,
        )

    flask_thread = threading.Thread(target=_run_flask, daemon=True)
    flask_thread.start()

    # Wait until Flask is ready before opening the window
    if not _wait_for_server(port):
        # Fallback: open in browser if native window can't start
        import webbrowser
        webbrowser.open(url)
        flask_thread.join()
        return

    # ── Try to open as a native desktop window ─────────────────────────────────
    try:
        import webview

        window = webview.create_window(
            title="Walmart Queue Optimizer",
            url=url,
            width=1280,
            height=900,
            resizable=True,
            min_size=(900, 640),
            text_select=False,
        )
        # webview.start() blocks until the window is closed
        webview.start(debug=False)

    except Exception:
        # If pywebview fails for any reason, fall back to the browser
        import webbrowser
        webbrowser.open(url)
        flask_thread.join()


if __name__ == "__main__":
    main()
