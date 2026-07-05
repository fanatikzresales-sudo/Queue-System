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

REM Auto-fix old package.json copies that still call Python for icons
node -e "try{const fs=require('fs');const p='package.json';const j=JSON.parse(fs.readFileSync(p,'utf8'));let c=0;if(j.scripts.build&&j.scripts.build.includes('generate:icons')){j.scripts.build='npm run sync:www && npm run build:js';c=1;}if(j.scripts['generate:icons']&&String(j.scripts['generate:icons']).includes('python')){j.scripts['generate:icons']='node scripts/generate-app-icons.js';c=1;}if(c){fs.writeFileSync(p,JSON.stringify(j,null,2)+'\n');console.log('  Auto-fixed package.json (removed Python from build)');}}catch(e){console.error('  WARN: could not patch package.json:',e.message);}"

REM Capacitor 8 requires Java 21 — find a working JDK (ignore broken system JAVA_HOME)
set "JAVA_HOME="
for /d %%J in ("C:\Program Files\Eclipse Adoptium\jdk-21*") do (
    if exist "%%~J\bin\java.exe" set "JAVA_HOME=%%~J"
)
if not defined JAVA_HOME (
    for /d %%J in ("C:\Program Files\Microsoft\jdk-21*") do (
        if exist "%%~J\bin\java.exe" set "JAVA_HOME=%%~J"
    )
)
if not defined JAVA_HOME (
    for /d %%J in ("C:\Program Files\Java\jdk-21*") do (
        if exist "%%~J\bin\java.exe" set "JAVA_HOME=%%~J"
    )
)
if not defined JAVA_HOME (
    if exist "C:\Program Files\Android\Android Studio\jbr\bin\java.exe" (
        set "JAVA_HOME=C:\Program Files\Android\Android Studio\jbr"
    )
)

if defined JAVA_HOME (
    set "PATH=%JAVA_HOME%\bin;%PATH%"
    echo  Java: %JAVA_HOME%
    java -version 2>&1 | findstr /i "version"
) else (
    echo  ERROR: Java JDK 21 not found.
    echo.
    echo  Your old JAVA_HOME may point to jdk-17 that no longer exists.
    echo  Capacitor 8 needs JDK 21.
    echo.
    echo  Fix:
    echo    1. Install JDK 21: https://adoptium.net/temurin/releases/?version=21
    echo    2. Windows Search -^> "Environment Variables"
    echo    3. Delete or fix JAVA_HOME if it says jdk-17
    echo    4. Close ALL cmd windows, run build-android.bat again
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
    echo  Find SDK path in Android Studio:
    echo    Settings -^> Languages ^& Frameworks -^> Android SDK
    echo  Create C:\Queue-System\mobile\android\local.properties with:
    echo    sdk.dir=C:/Users/YOURNAME/AppData/Local/Android/Sdk
    echo.
    pause
    exit /b 1
)

set "PATH=%ANDROID_HOME%\platform-tools;%ANDROID_HOME%\cmdline-tools\latest\bin;%PATH%"
echo  Android SDK: %ANDROID_HOME%

set "SDK_FWD=%ANDROID_HOME:\=/%"
echo sdk.dir=%SDK_FWD%> "%MOBILE_DIR%\android\local.properties"
echo  Wrote android\local.properties

echo.
echo  [1/4] npm install...
call npm install
if errorlevel 1 goto :fail

echo.
echo  [2/4] Building web assets (no Python required)...
call npm run sync:www
if errorlevel 1 goto :fail
call npm run build:js
if errorlevel 1 goto :fail

echo.
echo  [3/4] cap sync android...
call npx cap sync android
if errorlevel 1 goto :fail

echo.
echo  [4/4] Building APK (gradlew assembleDebug)...

REM Use project-local Gradle home — ignores broken org.gradle.java.home in user profile
set "GRADLE_USER_HOME=%MOBILE_DIR%\android\.gradle-local"
if not exist "%GRADLE_USER_HOME%" mkdir "%GRADLE_USER_HOME%"

set "GRADLE_PROPS=%MOBILE_DIR%\android\gradle.properties"
set "JAVA_FWD=%JAVA_HOME:\=/%"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$p=$env:GRADLE_PROPS; $j=$env:JAVA_FWD; $lines=@(); if (Test-Path $p) { $lines = Get-Content $p | Where-Object { $_ -notmatch '^org\.gradle\.java\.home=' } }; while ($lines.Count -gt 0 -and [string]::IsNullOrWhiteSpace($lines[-1])) { $lines = $lines[0..($lines.Count-2)] }; $lines += \"org.gradle.java.home=$j\"; $lines | Set-Content $p -Encoding UTF8; Write-Host \"Gradle Java: $j\""
if errorlevel 1 (
    echo  ERROR: Could not configure Java for Gradle.
    goto :fail
)

cd android
call gradlew.bat --stop 2>nul
call gradlew.bat assembleDebug
if errorlevel 1 (
    echo.
    echo  Gradle failed. You may need:
    echo    - Java JDK 21  https://adoptium.net/temurin/releases/?version=21
    echo    - Android Studio + SDK  https://developer.android.com/studio
    echo  Fix broken JAVA_HOME in Windows Environment Variables if it still says jdk-17.
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
