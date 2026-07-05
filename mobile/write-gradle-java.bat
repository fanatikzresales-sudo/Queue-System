@echo off
REM Write org.gradle.java.home into android/gradle.properties (no Node required)
setlocal EnableExtensions

if not defined JAVA_HOME (
    echo ERROR: JAVA_HOME not set
    exit /b 1
)
if not exist "%JAVA_HOME%\bin\java.exe" (
    echo ERROR: Invalid JAVA_HOME: %JAVA_HOME%
    exit /b 1
)

set "GRADLE_PROPS=%~dp0android\gradle.properties"
set "JAVA_FWD=%JAVA_HOME:\=/%"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$p='%GRADLE_PROPS%'; $j='%JAVA_FWD%';" ^
  "$lines=@(); if (Test-Path $p) { $lines = Get-Content $p | Where-Object { $_ -notmatch '^org\.gradle\.java\.home=' } };" ^
  "while ($lines.Count -gt 0 -and [string]::IsNullOrWhiteSpace($lines[-1])) { $lines = $lines[0..($lines.Count-2)] };" ^
  "$lines += \"org.gradle.java.home=$j\";" ^
  "$lines | Set-Content $p -Encoding UTF8;" ^
  "Write-Host \"Wrote org.gradle.java.home=$j\""

if errorlevel 1 exit /b 1
exit /b 0
