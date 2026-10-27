@echo off
setlocal EnableDelayedExpansion

:: ========================================================
::   WORKPLACE PLATFORM - SHORE VM UPDATE SCRIPT
:: ========================================================

:: 0. Check for Administrator permissions (Auto-elevate if not admin)
if "%~1"=="/no-elevate" goto :skip_elevate
net session >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo Administrator permissions required. Requesting elevation...
    powershell -Command "Start-Process cmd -ArgumentList '/c \"\"%~f0\"\" %*' -Verb RunAs"
    exit /b
)
:skip_elevate

echo ========================================================
echo   Updating Workplace Platform (Shore VM)
echo ========================================================
echo.

:: 1. Locate repository root
set "SCRIPT_DIR=%~dp0"
set "REPO_ROOT=%SCRIPT_DIR%.."

if not exist "%REPO_ROOT%\workplace-app" (
    if exist "C:\WORKPLACE\Workplace\workplace-app" (
        set "REPO_ROOT=C:\WORKPLACE\Workplace"
    ) else (
        set "REPO_ROOT=%CD%"
    )
)

echo [1/5] Repository root: %REPO_ROOT%
cd /d "%REPO_ROOT%"

:: 2. Pull latest code from git
echo.
echo [2/5] Pulling latest changes from origin/main...
git pull origin main
if %ERRORLEVEL% NEQ 0 (
    echo     [WARNING] git pull exited with a warning/error. Continuing with current local files...
) else (
    echo     [OK] Latest changes pulled.
)

:: 3. Build Workplace Frontend
echo.
echo [3/5] Building Frontend (workplace-app)...
cd /d "%REPO_ROOT%\workplace-app"
call npm run build
if %ERRORLEVEL% NEQ 0 (
    echo     [ERROR] Frontend build failed! Check errors above.
    pause
    exit /b %ERRORLEVEL%
)
echo     [OK] Frontend build succeeded.

:: Copy build output to Nginx web root
echo     Deploying build artifacts to Nginx...
if exist "C:\WORKPLACE\nginx\html" (
    xcopy /s /y /i dist\* "C:\WORKPLACE\nginx\html\" >nul
    echo     [OK] Copied dist to C:\WORKPLACE\nginx\html\
) else if exist "%REPO_ROOT%\..\nginx\html" (
    xcopy /s /y /i dist\* "%REPO_ROOT%\..\nginx\html\" >nul
    echo     [OK] Copied dist to %REPO_ROOT%\..\nginx\html\
) else (
    echo     [WARNING] Could not locate Nginx html directory. Please verify web root path.
)

:: 4. Apply Database Migrations
echo.
echo [4/5] Applying Database Migrations (ORB Backend)...
cd /d "%REPO_ROOT%\orb-backend"
if exist "venv\Scripts\python.exe" (
    venv\Scripts\python.exe run_migrations.py
) else if exist "venv\Scripts\alembic.exe" (
    venv\Scripts\alembic.exe upgrade head
) else if exist "C:\WORKPLACE\bin\python\python.exe" (
    "C:\WORKPLACE\bin\python\python.exe" run_migrations.py
) else (
    python run_migrations.py
)

:: If standalone C:\WORKPLACE\orb_backend directory exists, sync app files into it
if exist "C:\WORKPLACE\orb_backend" if /i not "C:\WORKPLACE\orb_backend"=="%REPO_ROOT%\orb-backend" (
    echo     Syncing updated files to C:\WORKPLACE\orb_backend...
    xcopy /s /y /i "%REPO_ROOT%\orb-backend\app\*" "C:\WORKPLACE\orb_backend\app\" >nul 2>&1
    if exist "C:\WORKPLACE\bin\python\python.exe" (
        cd /d "C:\WORKPLACE\orb_backend"
        "C:\WORKPLACE\bin\python\python.exe" run_migrations.py >nul 2>&1
    )
)

:: 5. Restart Windows Services
echo.
echo [5/5] Restarting Windows Services...
net stop WP_ORB_Backend >nul 2>&1
net start WP_ORB_Backend >nul 2>&1
echo     [OK] WP_ORB_Backend restarted.

net stop WP_Nginx >nul 2>&1
net start WP_Nginx >nul 2>&1
echo     [OK] WP_Nginx restarted.

echo.
echo ========================================================
echo   WORKPLACE PLATFORM UPDATE COMPLETE!
echo   Platform is running at: http://localhost:8080
echo ========================================================
echo.
pause
