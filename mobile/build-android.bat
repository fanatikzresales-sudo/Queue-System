@echo off
setlocal EnableExtensions
title FR Queue Optimizer - Android Build

echo.
echo  FR Queue Optimizer - Android build helper
echo  ==========================================
echo.

REM Must run from repo root OR mobile folder
if exist "mobile\package.json" (
    set "MOBILE_DIR=%CD%\mobile"
) else if exist "package.json" (
    if exist "android\gradlew.bat" (
        set "MOBILE_DIR=%CD%"
    )
)

if not defined MOBILE_DIR (
    echo  ERROR: Cannot find the mobile folder.
    echo.
    echo  You need the FULL GitHub repo, not the .exe download.
    echo.
    echo  Fix:
    echo    1. Go to: https://github.com/fanatikzresales-sudo/Queue-System
    echo    2. Click green "Code" -^> "Download ZIP"
    echo    3. Unzip to something like C:\Queue-System
    echo    4. Double-click this file again from that folder
    echo       OR run:  cd C:\Queue-System\mobile  then build-android.bat
    echo.
    echo  Current folder: %CD%
    echo  Contents here:
    dir /b
    echo.
    pause
    exit /b 1
)

echo  Using: %MOBILE_DIR%
cd /d "%MOBILE_DIR%"

where node >nul 2>&1
if errorlevel 1 (
    echo  ERROR: Node.js not found. Install from https://nodejs.org
    pause
    exit /b 1
)

echo.
echo  [1/4] npm install...
call npm install
if errorlevel 1 goto :fail

echo.
echo  [2/4] npm run build...
call npm run build
if errorlevel 1 goto :fail

echo.
echo  [3/4] cap sync android...
call npx cap sync android
if errorlevel 1 goto :fail

echo.
echo  [4/4] Building APK (gradlew assembleDebug)...
cd android
call gradlew.bat assembleDebug
if errorlevel 1 (
    echo.
    echo  Gradle failed. You may need:
    echo    - Java JDK 17  https://adoptium.net
    echo    - Android Studio + SDK  https://developer.android.com/studio
    echo  Set ANDROID_HOME to your SDK path if needed.
    cd ..
    goto :fail
)
cd ..

set "APK=%MOBILE_DIR%\android\app\build\outputs\apk\debug\app-debug.apk"
echo.
echo  SUCCESS!
echo  APK built at:
echo    %APK%
echo.
echo  Install on LDPlayer:
echo    adb connect 127.0.0.1:5555
echo    adb install "%APK%"
echo.
pause
exit /b 0

:fail
echo.
echo  Build failed. See errors above.
pause
exit /b 1
