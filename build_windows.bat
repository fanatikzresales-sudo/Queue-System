@echo off
REM ============================================================
REM  Walmart Queue Optimizer — Windows Build Script
REM  Run this on a Windows PC to create the .exe
REM ============================================================

echo.
echo  Walmart Queue Optimizer - Build for Windows
echo  ============================================
echo.

REM Check Python is installed
python --version >nul 2>&1
IF ERRORLEVEL 1 (
    echo  ERROR: Python not found. Install Python 3.9+ from python.org
    pause
    exit /b 1
)

echo  [1/3] Installing dependencies...
pip install -r requirements.txt
IF ERRORLEVEL 1 (
    echo  ERROR: pip install failed.
    pause
    exit /b 1
)

echo.
echo  [2/3] Installing PyInstaller...
pip install pyinstaller>=6.0.0
IF ERRORLEVEL 1 (
    echo  ERROR: Could not install PyInstaller.
    pause
    exit /b 1
)

echo.
echo  [3/3] Building executable...
pyinstaller walmart_queue.spec --clean --noconfirm
IF ERRORLEVEL 1 (
    echo  ERROR: Build failed.
    pause
    exit /b 1
)

echo.
echo  ============================================
echo  BUILD COMPLETE!
echo  Your app is at: dist\WalmartQueueOptimizer.exe
echo  Double-click it to run — no install needed.
echo  ============================================
echo.
pause
