@echo off
cls
echo ========================================
echo   TALENT OPS - FRONTEND SERVER
echo ========================================
echo.

cd "Landing-login page"

if not exist node_modules (
    echo [ERROR] node_modules not found!
    echo.
    echo Please run SETUP.bat first to install dependencies
    echo.
    pause
    exit /b 1
)

echo Starting frontend development server...
echo Server will run on: http://localhost:5173
echo.
echo Press Ctrl+C to stop the server
echo ========================================
echo.

call npm run dev

pause
