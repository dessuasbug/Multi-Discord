@echo off
title Build Multi Discord installer
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Get the LTS version from https://nodejs.org then run this again.
  pause
  exit /b 1
)
echo Installing dependencies...
call npm install
if errorlevel 1 goto fail
echo Building the installer...
call npm run dist
if errorlevel 1 goto fail
echo.
echo Done. Your installer is in the "dist" folder: Multi-Discord-Setup-*.exe
start "" "%~dp0dist"
pause
exit /b 0
:fail
echo.
echo Something went wrong. If you saw a "symbolic link" error, turn on Developer Mode in
echo Windows Settings (Privacy and security, For developers) and run this again.
pause
exit /b 1
