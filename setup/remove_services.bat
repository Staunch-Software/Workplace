@echo off
setlocal EnableDelayedExpansion

:: Check for Administrator permissions
net session >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo Administrator permissions required. Requesting elevation...
    powershell -Command "Start-Process cmd -ArgumentList '/c \"\"%~f0\"\"' -Verb RunAs"
    exit /b
)

set "NSSM=C:\WORKPLACE\nssm\win64\nssm.exe"
echo ===========================================
echo Removing all Workplace Platform Services...
echo ===========================================

"%NSSM%" stop WP_Nginx >nul 2>&1
"%NSSM%" remove WP_Nginx confirm >nul 2>&1

"%NSSM%" stop WP_Lube_Backend >nul 2>&1
"%NSSM%" remove WP_Lube_Backend confirm >nul 2>&1

"%NSSM%" stop WP_Core_Backend >nul 2>&1
"%NSSM%" remove WP_Core_Backend confirm >nul 2>&1

"%NSSM%" stop WP_Jira_Backend >nul 2>&1
"%NSSM%" remove WP_Jira_Backend confirm >nul 2>&1

"%NSSM%" stop WP_DRS_Backend >nul 2>&1
"%NSSM%" remove WP_DRS_Backend confirm >nul 2>&1

"%NSSM%" stop WP_AEPMS_Backend >nul 2>&1
"%NSSM%" remove WP_AEPMS_Backend confirm >nul 2>&1

"%NSSM%" stop WP_ORB_Backend >nul 2>&1
"%NSSM%" remove WP_ORB_Backend confirm >nul 2>&1

"%NSSM%" stop WP_Reports_Backend >nul 2>&1
"%NSSM%" remove WP_Reports_Backend confirm >nul 2>&1

"%NSSM%" stop WP_Azurite >nul 2>&1
"%NSSM%" remove WP_Azurite confirm >nul 2>&1

"%NSSM%" stop WP_Postgres >nul 2>&1
"%NSSM%" remove WP_Postgres confirm >nul 2>&1

echo Services cleaned successfully. You can now run install_workplace.bat again if needed.
pause
