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

REM Auto-detect Java JDK if JAVA_HOME not set
if not defined JAVA_HOME (
    for /d %%J in ("C:\Program Files\Eclipse Adoptium\jdk-17*") do set "JAVA_HOME=%%~J"
)
if not defined JAVA_HOME (
    for /d %%J in ("C:\Program Files\Java\jdk-17*") do set "JAVA_HOME=%%~J"
)
if not defined JAVA_HOME (
    if exist "C:\Program Files\Android\Android Studio\jbr\bin\java.exe" (
        set "JAVA_HOME=C:\Program Files\Android\Android Studio\jbr"
    )
)
if defined JAVA_HOME (
    set "PATH=%JAVA_HOME%\bin;%PATH%"
    echo  Java: %JAVA_HOME%
) else (
    echo  ERROR: Java JDK 17 not found.
    echo.
    echo  Install JDK 17:
    echo    1. Go to https://adoptium.net/temurin/releases/?version=17
    echo    2. Download Windows x64 .msi and run it
    echo    3. CHECK "Set JAVA_HOME" and "Add to PATH" during install
    echo    4. Close this window, open a NEW cmd, run build-android.bat again
    echo.
    pause
    exit /b 1
)

REM Auto-detect Android SDK
if not defined ANDROID_HOME (
    if exist "%LOCALAPPDATA%\Android\Sdk\platforms" set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"
)
if not defined ANDROID_HOME (
    if exist "%USERPROFILE%\AppData\Local\Android\Sdk\platforms" set "ANDROID_HOME=%USERPROFILE%\AppData\Local\Android\Sdk"
)
if not defined ANDROID_HOME (
    if exist "C:\Android\Sdk\platforms" set "ANDROID_HOME=C:\Android\Sdk"
)

if not defined ANDROID_HOME (
    echo  ERROR: Android SDK not found.
    echo.
    echo  You have Android Studio, but Gradle needs the SDK path.
    echo.
    echo  Find your SDK path in Android Studio:
    echo    Settings -^> Languages ^& Frameworks -^> Android SDK
    echo    Copy "Android SDK Location" at the top
    echo.
    echo  Then create this file:
    echo    C:\Queue-System\mobile\android\local.properties
    echo.
    echo  With one line ^(use YOUR path, forward slashes OK^):
    echo    sdk.dir=C:/Users/YOURNAME/AppData/Local/Android/Sdk
    echo.
    echo  Or set ANDROID_HOME system env var to that folder, then re-run.
    echo.
    pause
    exit /b 1
)

set "PATH=%ANDROID_HOME%\platform-tools;%ANDROID_HOME%\cmdline-tools\latest\bin;%PATH%"
echo  Android SDK: %ANDROID_HOME%

REM Gradle reads sdk.dir from local.properties (required even if ANDROID_HOME is set)
set "SDK_FWD=%ANDROID_HOME:\=/%"
echo sdk.dir=%SDK_FWD%> "%MOBILE_DIR%\android\local.properties"
echo  Wrote android\local.properties

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
