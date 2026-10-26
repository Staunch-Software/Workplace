@echo off
setlocal EnableDelayedExpansion

:: Check for Administrator permissions
net session >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo Administrator permissions required. Requesting elevation...
    powershell -Command "Start-Process cmd -ArgumentList '/c \"\"%~f0\"\"' -Verb RunAs"
    exit /b
)

echo ===========================================
echo Starting Workplace Platform Services...
echo ===========================================

net start WP_Postgres
net start WP_Azurite
net start WP_DRS_Backend
net start WP_Jira_Backend
net start WP_Lube_Backend
net start WP_Core_Backend
net start WP_AEPMS_Backend
net start WP_Reports_Backend
net start WP_ORB_Backend
net start WP_Nginx

echo.
echo All services started successfully! 
echo Platform is live at: http://localhost:8080
pause
