@echo off
setlocal
echo ============================================================
echo   Running Vessel Performance PostgreSQL Database Backup
echo ============================================================

set "SCRIPT_DIR=%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%backup_vessel_perf.ps1" %*

if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Backup failed with exit code %ERRORLEVEL%.
    pause
    exit /b %ERRORLEVEL%
)

echo [SUCCESS] Backup completed successfully.
pause
