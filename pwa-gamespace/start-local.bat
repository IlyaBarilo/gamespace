@echo off
setlocal
cd /d "%~dp0"
where node.exe >nul 2>nul
if errorlevel 1 (
    echo Install Node.js 20 or newer, then run this file again.
    pause
    exit /b 1
)
if not exist "node_modules\vite\bin\vite.js" (
    echo Install project dependencies first:
    echo cd /d "%~dp0"
    echo npm install
    pause
    exit /b 1
)
echo GameSpace PWA: http://localhost:5180/?gamespaceMode=app
echo Keep this window open. Press Ctrl+C to stop the local server.
call npm.cmd run dev -- --host 127.0.0.1 --port 5180 --strictPort --open "http://localhost:5180/?gamespaceMode=app"
set "gamespaceExitCode=%errorlevel%"
if not "%gamespaceExitCode%"=="0" pause
exit /b %gamespaceExitCode%
