@echo off
REM Optional alternative to "Enshrouded Server Manager.vbs" — use this one
REM instead if you want to watch what's happening in a normal window
REM (useful for troubleshooting). Most people should just use the .vbs file.
setlocal
cd /d "%~dp0"

echo Starting ChillWithSyd Enshrouded Server Manager...
echo Open http://localhost:8790 in your browser once you see it says "listening" below.
echo (This window is the manager's own log output - leave it open while your server is running.)

if exist "EnshroudedServerManager.exe" (
  REM Packaged release build - Node.js and all dependencies are already
  REM baked in, nothing to check or install.
  EnshroudedServerManager.exe
  pause
  exit /b 0
)

REM Running from the source checkout instead of a packaged release.
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js isn't installed on this PC.
  echo Download it from https://nodejs.org/ ^(the LTS version^), install it, then double-click this file again.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo First time setup - installing dependencies, this only happens once...
  call npm install --omit=dev
)

node server.js
pause
