@echo off
setlocal
echo ============================================================
echo   Vessel Performance Database Restore Utility
echo ============================================================

set "SCRIPT_DIR=%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%restore_vessel_perf.ps1" %*

if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Restore encountered an issue or warning. Check logs above.
    pause
    exit /b %ERRORLEVEL%
)

echo [SUCCESS] Operation finished.
pause
