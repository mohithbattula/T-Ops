@echo off
cls
echo ╔══════════════════════════════════════════════════════════════╗
echo ║                                                              ║
echo ║           TALENT OPS - QUICK START GUIDE                     ║
echo ║                                                              ║
echo ╚══════════════════════════════════════════════════════════════╝
echo.
echo ⚠️  BEFORE YOU START - HAVE YOU FILLED IN YOUR API KEYS?
echo.
echo You MUST edit this file first:
echo    chatbot-backend\.env
echo.
echo And fill in these 3 values:
echo    SUPABASE_URL=https://your-project.supabase.co
echo    SUPABASE_ANON_KEY=your-supabase-anon-key
echo    OPENAI_API_KEY=sk-your-openai-api-key
echo.
echo Get them from:
echo    Supabase: https://app.supabase.com/project/_/settings/api
echo    OpenAI: https://platform.openai.com/api-keys
echo.
echo ════════════════════════════════════════════════════════════════
echo.
choice /C YN /M "Have you filled in the .env file with your real API keys"
if errorlevel 2 (
    echo.
    echo Please fill in chatbot-backend\.env first, then run this again.
    echo.
    echo Opening .env file for you...
    timeout /t 2 /nobreak >nul
    notepad "chatbot-backend\.env"
    echo.
    echo After filling in your keys, run this script again!
    pause
    exit /b 1
)

echo.
echo ════════════════════════════════════════════════════════════════
echo   STARTING SERVERS...
echo ════════════════════════════════════════════════════════════════
echo.
echo This will open 2 windows:
echo   1. Backend Server (http://localhost:5000)
echo   2. Frontend Server (http://localhost:5173)
echo.
pause

echo.
echo [1/2] Starting Backend Server...
start "Talent Ops - Backend" cmd /k "cd chatbot-backend && echo Starting backend... && python main.py"

echo Waiting 3 seconds for backend to start...
timeout /t 3 /nobreak >nul

echo.
echo [2/2] Starting Frontend Server...
start "Talent Ops - Frontend" cmd /k "cd Landing-login page && echo Starting frontend... && npm run dev"

echo.
echo ════════════════════════════════════════════════════════════════
echo   ✅ SERVERS STARTED!
echo ════════════════════════════════════════════════════════════════
echo.
echo Two new windows have opened:
echo   • Backend:  http://localhost:5000
echo   • Frontend: http://localhost:5173
echo.
echo Wait for both to finish starting, then:
echo   1. Open browser: http://localhost:5173
echo   2. Log in with your credentials
echo   3. Click chatbot icon (bottom-right)
echo   4. Type: "Show me my tasks"
echo.
echo To stop: Close both terminal windows
echo.
echo ════════════════════════════════════════════════════════════════
pause
