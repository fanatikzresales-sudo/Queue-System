"""
Walmart Queue Optimizer — desktop launcher.

Starts the local web server and opens your browser automatically.
Double-click the executable (Windows) or the .app (Mac) to run.
"""

from __future__ import annotations

import os
import socket
import sys
import threading
import time
import webbrowser


# ── Resource path helper (dev vs. PyInstaller bundle) ─────────────────────────

def resource_path(relative: str) -> str:
    if hasattr(sys, "_MEIPASS"):
        return os.path.join(sys._MEIPASS, relative)
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), relative)


# Point Flask at the bundled templates/static before importing app
os.environ.setdefault("FLASK_TEMPLATE_FOLDER", resource_path("templates"))
os.environ.setdefault("FLASK_STATIC_FOLDER", resource_path("static"))


# ── Import the Flask app ───────────────────────────────────────────────────────

from app import app  # noqa: E402 (import after env setup)


# ── Port helpers ───────────────────────────────────────────────────────────────

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
    # Fall back to any available OS-assigned port
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _wait_for_server(port: int, timeout: float = 10.0) -> bool:
    """Block until the server accepts connections or timeout expires."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.2):
                return True
        except OSError:
            time.sleep(0.1)
    return False


# ── Main ───────────────────────────────────────────────────────────────────────

def main() -> None:
    port = _find_free_port(5000)
    url = f"http://127.0.0.1:{port}"

    print(f"\n{'='*54}")
    print(f"  Walmart Queue Optimizer")
    print(f"  Running at: {url}")
    print(f"  Close this window to stop the app.")
    print(f"{'='*54}\n")

    def _open_browser() -> None:
        if _wait_for_server(port):
            webbrowser.open(url)
        else:
            print(f"[warning] Browser auto-open failed — visit {url} manually.")

    threading.Thread(target=_open_browser, daemon=True).start()

    app.run(
        host="127.0.0.1",
        port=port,
        debug=False,
        use_reloader=False,
        threaded=True,
    )


if __name__ == "__main__":
    main()
