@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo Fixing Java + Gradle...
echo.

set "JAVA_HOME="
for /d %%J in ("C:\Program Files\Eclipse Adoptium\jdk-21*") do if exist "%%~J\bin\java.exe" set "JAVA_HOME=%%~J"
if not defined JAVA_HOME for /d %%J in ("C:\Program Files\Java\jdk-21*") do if exist "%%~J\bin\java.exe" set "JAVA_HOME=%%~J"
if not defined JAVA_HOME if exist "C:\Program Files\Android\Android Studio\jbr\bin\java.exe" set "JAVA_HOME=C:\Program Files\Android\Android Studio\jbr"

if not defined JAVA_HOME (
    echo ERROR: Install JDK 21 from https://adoptium.net/temurin/releases/?version=21
    pause
    exit /b 1
)

set "PATH=%JAVA_HOME%\bin;%PATH%"
echo Java: %JAVA_HOME%
java -version
echo.

set "GRADLE_USER_HOME=%CD%\android\.gradle-local"
if not exist "%GRADLE_USER_HOME%" mkdir "%GRADLE_USER_HOME%"

set "GRADLE_PROPS=%CD%\android\gradle.properties"
set "JAVA_FWD=%JAVA_HOME:\=/%"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$p=$env:GRADLE_PROPS; $j=$env:JAVA_FWD; $lines=@(); if (Test-Path $p) { $lines = Get-Content $p | Where-Object { $_ -notmatch '^org\.gradle\.java\.home=' } }; $lines += \"org.gradle.java.home=$j\"; $lines | Set-Content $p -Encoding UTF8; Write-Host \"Wrote org.gradle.java.home=$j\""
if errorlevel 1 (
    echo ERROR: PowerShell step failed.
    pause
    exit /b 1
)

echo.
echo SUCCESS. Now double-click build-android.bat
pause
