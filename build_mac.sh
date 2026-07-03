#!/usr/bin/env bash
# ============================================================
#  FR Queue Optimizer — macOS Build Script
#  Run this on a Mac to create the .app bundle
# ============================================================

set -e

echo ""
echo " FR Queue Optimizer - Build for macOS"
echo " =========================================="
echo ""

# Check Python 3.9+
if ! command -v python3 &>/dev/null; then
    echo " ERROR: python3 not found."
    echo " Install Python 3.9+ from https://python.org or via Homebrew:"
    echo "   brew install python"
    exit 1
fi

PY_VERSION=$(python3 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
echo " Python $PY_VERSION detected."

echo ""
echo " [1/3] Installing dependencies..."
pip3 install -r requirements.txt

echo ""
echo " [2/3] Installing PyInstaller..."
pip3 install "pyinstaller>=6.0.0"

echo ""
echo " [3/3] Building app bundle..."
pyinstaller walmart_queue.spec --clean --noconfirm

echo ""
echo " =========================================="
echo " BUILD COMPLETE!"
echo " Your app is at: dist/FRQueueOptimizer.app"
echo " Drag it to your Applications folder to install."
echo " Double-click to open — Safari/Chrome will launch automatically."
echo " =========================================="
echo ""
