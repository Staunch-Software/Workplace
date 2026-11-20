@echo off
setlocal
echo ============================================================
echo   Backing Up All Workplace Platform Databases
echo ============================================================

set "SCRIPT_DIR=%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%backup_all_workplace_dbs.ps1" %*

if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Backup batch finished with errors.
    pause
    exit /b %ERRORLEVEL%
)

echo [SUCCESS] Platform backup completed successfully.
pause
