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
echo Restarting Workplace Platform Services...
echo ===========================================

:: 1. STOP all services
net stop WP_Nginx
net stop WP_Core_Backend
net stop WP_Jira_Backend
net stop WP_Lube_Backend
net stop WP_DRS_Backend
net stop WP_AEPMS_Backend
net stop WP_ORB_Backend
net stop WP_Reports_Backend
net stop WP_Azurite
net stop WP_Postgres

timeout /t 5 >nul

:: 2. START all services
net start WP_Postgres
net start WP_Azurite
net start WP_Nginx
net start WP_Core_Backend
net start WP_Jira_Backend
net start WP_Lube_Backend
net start WP_DRS_Backend
net start WP_AEPMS_Backend
net start WP_Reports_Backend
net start WP_ORB_Backend

echo.
echo ===========================================
echo All services have been restarted successfully.
echo ===========================================
pause
