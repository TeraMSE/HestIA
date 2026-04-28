@echo off
REM Quick start script for the Django backend server

setlocal enabledelayedexpansion

cd /d "%~dp0"

echo ========================================
echo HestIA Backend - Django Server Launcher
echo ========================================
echo.

REM Activate venv
if exist .venv\Scripts\activate.bat (
    call .venv\Scripts\activate.bat
    echo ✓ Virtual environment activated
) else (
    echo ✗ Virtual environment not found!
    echo Please run: python -m venv .venv
    pause
    exit /b 1
)

echo.
echo Starting server on http://localhost:8000
echo Press Ctrl+C to stop
echo.

REM Run server
.\.venv\Scripts\python.exe manage.py runserver 0.0.0.0:8000

pause
