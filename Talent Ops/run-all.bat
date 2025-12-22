@echo off
cls
echo ========================================
echo   TALENT OPS - START ALL SERVERS
echo ========================================
echo.

echo This will start both backend and frontend servers
echo in separate windows.
echo.
echo Backend: http://localhost:5000
echo Frontend: http://localhost:5173
echo.
pause

echo Starting backend server...
start "Talent Ops - Backend" cmd /k "cd chatbot-backend && python main.py"

timeout /t 3 /nobreak >nul

echo Starting frontend server...
start "Talent Ops - Frontend" cmd /k "cd Landing-login page && npm run dev"

echo.
echo ========================================
echo   SERVERS STARTED! 🚀
echo ========================================
echo.
echo Backend:  http://localhost:5000
echo Frontend: http://localhost:5173
echo.
echo Two new windows have opened for each server.
echo Close those windows to stop the servers.
echo.
echo ========================================
pause
