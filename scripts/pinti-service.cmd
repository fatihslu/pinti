@echo off
setlocal
cd /d "%~dp0.."

if not exist "logs" mkdir "logs"

:restart
"C:\Program Files\nodejs\node.exe" server.js >> "logs\pinti-service.log" 2>&1
timeout /t 15 /nobreak >nul
goto restart
