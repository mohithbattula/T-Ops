@echo off
cls
echo ========================================
echo   TALENT OPS - BACKEND SERVER
echo ========================================
echo.

cd chatbot-backend

if not exist .env (
    echo [ERROR] .env file not found!
    echo.
    echo Please run SETUP.bat first or create .env file manually
    echo.
    pause
    exit /b 1
)

echo Starting chatbot backend server...
echo Server will run on: http://localhost:5000
echo.
echo Press Ctrl+C to stop the server
echo ========================================
echo.

python main.py

pause
