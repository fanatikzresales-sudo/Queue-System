@echo off
REM One-shot fix: run this from mobile folder if build keeps using jdk-17
setlocal EnableExtensions
cd /d "%~dp0"

echo Fixing Java + Gradle for Android build...
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
echo Using Java: %JAVA_HOME%
java -version

set "GRADLE_USER_HOME=%CD%\android\.gradle-local"
if not exist "%GRADLE_USER_HOME%" mkdir "%GRADLE_USER_HOME%"

set "JAVA_HOME=%JAVA_HOME%"
node "%CD%\scripts\write-gradle-java.js"

if exist "%USERPROFILE%\.gradle\gradle.properties" (
    echo.
    echo Checking user Gradle config...
    findstr /i "jdk-17" "%USERPROFILE%\.gradle\gradle.properties" >nul 2>&1
    if not errorlevel 1 (
        echo WARNING: Your file has jdk-17:
        echo   %USERPROFILE%\.gradle\gradle.properties
        echo Delete the line org.gradle.java.home=...jdk-17... or delete that file.
    )
)

echo.
echo Done. Now run build-android.bat
pause
