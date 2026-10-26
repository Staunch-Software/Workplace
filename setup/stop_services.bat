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
echo Stopping Workplace Platform Services...
echo ===========================================

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

echo.
echo All services stopped safely.
pause
