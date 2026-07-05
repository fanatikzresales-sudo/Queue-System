@echo off
setlocal EnableExtensions
title FR Queue Optimizer - BUILD NOW (no Python)

echo.
echo  BUILD NOW — skips Python entirely
echo  ==================================
echo.

cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
    echo  ERROR: Node.js not found.
    pause
    exit /b 1
)

node -e "const fs=require('fs');const j=JSON.parse(fs.readFileSync('package.json'));j.scripts.build='npm run sync:www && npm run build:js';fs.writeFileSync('package.json',JSON.stringify(j,null,2)+'\n');"

echo  [1/5] npm install...
call npm install
if errorlevel 1 goto :fail

echo  [2/5] sync:www...
call npm run sync:www
if errorlevel 1 goto :fail

echo  [3/5] build:js...
call npm run build:js
if errorlevel 1 goto :fail

echo  [4/5] cap sync...
call npx cap sync android
if errorlevel 1 goto :fail

echo  [5/5] gradle assembleDebug...
cd android
call gradlew.bat assembleDebug
if errorlevel 1 (
    cd ..
    goto :fail
)
cd ..

echo.
echo  SUCCESS! APK at:
echo    %CD%\android\app\build\outputs\apk\debug\app-debug.apk
pause
exit /b 0

:fail
echo  FAILED — see errors above
pause
exit /b 1
