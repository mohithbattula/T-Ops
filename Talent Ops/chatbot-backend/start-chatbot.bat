@echo off
echo ========================================
echo Talent Ops Chatbot - Quick Start
echo ========================================
echo.

REM Check if .env exists
if not exist .env (
    echo [ERROR] .env file not found!
    echo.
    echo Please create a .env file first:
    echo 1. Copy env-template.txt to .env
    echo 2. Fill in your Supabase and OpenAI credentials
    echo.
    pause
    exit /b 1
)

echo [1/3] Checking Python installation...
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python is not installed or not in PATH
    echo Please install Python 3.8 or higher from python.org
    pause
    exit /b 1
)
echo ✓ Python found

echo.
echo [2/3] Installing dependencies...
pip install -r requirements.txt
if errorlevel 1 (
    echo [ERROR] Failed to install dependencies
    pause
    exit /b 1
)
echo ✓ Dependencies installed

echo.
echo [3/3] Starting chatbot backend server...
echo.
echo ========================================
echo Server will start on http://localhost:5000
echo Press Ctrl+C to stop the server
echo ========================================
echo.

python main.py
