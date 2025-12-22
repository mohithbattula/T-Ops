@echo off
cls
echo ========================================
echo   TALENT OPS HRM - COMPLETE SETUP
echo ========================================
echo.

REM Check if running from correct directory
if not exist "chatbot-backend" (
    echo [ERROR] Please run this script from the "Talent Ops" folder
    echo Current directory: %CD%
    pause
    exit /b 1
)

echo [Step 1/5] Checking Python installation...
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python is not installed or not in PATH
    echo.
    echo Please install Python 3.8 or higher from:
    echo https://www.python.org/downloads/
    echo.
    echo Make sure to check "Add Python to PATH" during installation
    pause
    exit /b 1
)
python --version
echo ✓ Python found

echo.
echo [Step 2/5] Checking Node.js installation...
node --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js is not installed or not in PATH
    echo.
    echo Please install Node.js from:
    echo https://nodejs.org/
    pause
    exit /b 1
)
node --version
npm --version
echo ✓ Node.js and npm found

echo.
echo [Step 3/5] Checking backend configuration...
if not exist "chatbot-backend\.env" (
    echo [WARNING] .env file not found in chatbot-backend folder
    echo.
    echo Creating .env from sample...
    copy "chatbot-backend\SAMPLE_ENV.txt" "chatbot-backend\.env" >nul 2>&1
    if errorlevel 1 (
        echo [ERROR] Could not create .env file
        echo Please manually copy SAMPLE_ENV.txt to .env and fill in your credentials
        pause
        exit /b 1
    )
    echo ✓ Created .env file
    echo.
    echo ⚠️  IMPORTANT: You need to edit chatbot-backend\.env and add:
    echo    - Your Supabase URL
    echo    - Your Supabase Anon Key
    echo    - Your OpenAI API Key
    echo.
    echo Press any key to open .env file in notepad...
    pause >nul
    notepad "chatbot-backend\.env"
    echo.
    echo Have you filled in the .env file with your credentials?
    choice /C YN /M "Continue"
    if errorlevel 2 (
        echo.
        echo Please fill in the .env file and run this script again
        pause
        exit /b 1
    )
) else (
    echo ✓ .env file exists
)

echo.
echo [Step 4/5] Installing backend dependencies...
cd chatbot-backend
pip install -r requirements.txt
if errorlevel 1 (
    echo [ERROR] Failed to install Python dependencies
    cd ..
    pause
    exit /b 1
)
echo ✓ Backend dependencies installed
cd ..

echo.
echo [Step 5/5] Checking frontend dependencies...
cd "Landing-login page"
if not exist "node_modules" (
    echo Installing frontend dependencies (this may take a few minutes)...
    call npm install
    if errorlevel 1 (
        echo [ERROR] Failed to install frontend dependencies
        cd ..
        pause
        exit /b 1
    )
    echo ✓ Frontend dependencies installed
) else (
    echo ✓ Frontend dependencies already installed
)
cd ..

echo.
echo ========================================
echo   SETUP COMPLETE! 🎉
echo ========================================
echo.
echo Your Talent Ops HRM system is ready to run!
echo.
echo To start the system:
echo   1. Backend:  run-backend.bat
echo   2. Frontend: run-frontend.bat
echo   3. Or both:  run-all.bat
echo.
echo ========================================
pause
