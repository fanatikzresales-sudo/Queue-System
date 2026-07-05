@echo off
setlocal
title Install FR Queue Optimizer on LDPlayer

set "APK=%~dp0android\app\build\outputs\apk\debug\app-debug.apk"

if not exist "%APK%" (
    echo  APK not found. Run build-android.bat first.
    echo  Expected: %APK%
    pause
    exit /b 1
)

set "ADB=adb"
where adb >nul 2>&1
if errorlevel 1 (
    if exist "%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe" (
        set "ADB=%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe"
    ) else (
        echo  adb not found. Install Android Studio or add platform-tools to PATH.
        pause
        exit /b 1
    )
)

echo  Connecting to LDPlayer on port 5555...
"%ADB%" connect 127.0.0.1:5555
"%ADB%" devices

echo.
echo  Installing APK...
"%ADB%" install -r "%APK%"
if errorlevel 1 (
    echo.
    echo  If install failed, try:
    echo    - Open LDPlayer first, enable ADB in Settings
    echo    - Try port 5557 if you have a 2nd instance
    echo    - adb uninstall com.frqueue.optimizer
    pause
    exit /b 1
)

echo.
echo  Done! Open "FR Queue Optimizer" in LDPlayer app drawer.
pause
