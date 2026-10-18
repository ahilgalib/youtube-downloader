@echo off
title YouTube Downloader - Public Link
cd /d "%~dp0"

if not exist node_modules (
  echo [1/3] Installing dependencies...
  call npm install || (echo npm install failed. Is Node.js installed? https://nodejs.org & pause & exit /b 1)
)

if not exist bin mkdir bin
if not exist bin\cloudflared.exe (
  echo [2/3] Downloading Cloudflare Tunnel...
  powershell -NoProfile -Command "Invoke-WebRequest -UseBasicParsing https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe -OutFile bin\cloudflared.exe"
)

echo [3/3] Starting server...
start "YouTube Downloader server" /min cmd /c "npm start"
timeout /t 8 /nobreak >nul

echo.
echo  ================================================================
echo   Your public link appears below as  https://....trycloudflare.com
echo   Keep this window open. Close it to stop sharing.
echo  ================================================================
echo.
bin\cloudflared.exe tunnel --no-autoupdate --url http://localhost:3000
