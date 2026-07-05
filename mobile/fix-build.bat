@echo off
setlocal EnableExtensions
title FR Queue Optimizer - Fix Build (no Python)

echo.
echo  Fixing mobile build — removes Python from the build step
echo  ========================================================
echo.

cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
    echo  ERROR: Node.js not found. Install from https://nodejs.org
    pause
    exit /b 1
)

echo  Patching package.json...
node -e "const fs=require('fs');const p='package.json';const j=JSON.parse(fs.readFileSync(p,'utf8'));if(j.scripts['generate:icons']&&j.scripts['generate:icons'].includes('python')){j.scripts['generate:icons']='node scripts/generate-app-icons.js';}j.scripts.build='npm run sync:www && npm run build:js';fs.writeFileSync(p,JSON.stringify(j,null,2)+'\n');console.log('  build script:',j.scripts.build);"

echo.
echo  npm install...
call npm install
if errorlevel 1 goto :fail

echo.
echo  npm run sync:www...
call npm run sync:www
if errorlevel 1 goto :fail

echo.
echo  npm run build:js...
call npm run build:js
if errorlevel 1 goto :fail

echo.
echo  SUCCESS — build fixed. Now run:  build-android.bat
echo.
pause
exit /b 0

:fail
echo.
echo  Fix failed. Copy this folder path and send a screenshot:
echo    %CD%
pause
exit /b 1
