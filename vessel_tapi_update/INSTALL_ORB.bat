@echo off
setlocal EnableDelayedExpansion

:: ========================================================
::   WORKPLACE PLATFORM - ORB SINGLE-RUN SETUP / UPDATE
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

set "ROOT=C:\WORKPLACE"
set "NSSM=%ROOT%\nssm\win64\nssm.exe"
set "PYTHONEXE=%ROOT%\bin\python\python.exe"
set "PGBIN=%ROOT%\bin\pgsql\bin"

echo ========================================================
echo   Setting Up / Updating Workplace ORB Module
echo ========================================================
echo.

:: [1/7] Ensure PostgreSQL is running & Database workplace_orb exists with UTF-8
echo [1/7] Checking PostgreSQL and ORB Database...
"%PGBIN%\pg_isready.exe" -h 127.0.0.1 -p 5432 >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo     PostgreSQL is not responding. Starting WP_Postgres service...
    net start WP_Postgres >nul 2>&1
    timeout /t 5 /nobreak >nul
)

:: Detect working PostgreSQL password (maritime123 on vessels, sujil123 on dev, or postgres/root)
set "DB_PASS=maritime123"
set "PGPASSWORD=maritime123"
"%PGBIN%\psql.exe" -h 127.0.0.1 -U postgres -c "SELECT 1;" >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    set "PGPASSWORD=sujil123"
    "%PGBIN%\psql.exe" -h 127.0.0.1 -U postgres -c "SELECT 1;" >nul 2>&1
    if !ERRORLEVEL! EQU 0 (
        set "DB_PASS=sujil123"
    ) else (
        set "PGPASSWORD=postgres"
        "%PGBIN%\psql.exe" -h 127.0.0.1 -U postgres -c "SELECT 1;" >nul 2>&1
        if !ERRORLEVEL! EQU 0 (
            set "DB_PASS=postgres"
        ) else (
            set "PGPASSWORD=root"
            "%PGBIN%\psql.exe" -h 127.0.0.1 -U postgres -c "SELECT 1;" >nul 2>&1
            if !ERRORLEVEL! EQU 0 set "DB_PASS=root"
        )
    )
)

"%PGBIN%\psql.exe" -h 127.0.0.1 -U postgres -tc "SELECT 1 FROM pg_database WHERE datname = 'workplace_orb'" | findstr "1" >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo     Database workplace_orb does not exist. Creating with UTF-8 encoding...
    "%PGBIN%\psql.exe" -h 127.0.0.1 -U postgres -c "CREATE DATABASE workplace_orb ENCODING 'UTF8' TEMPLATE template0 LC_COLLATE 'C' LC_CTYPE 'C';" >nul 2>&1
    if %ERRORLEVEL% NEQ 0 (
        "%PGBIN%\psql.exe" -h 127.0.0.1 -U postgres -c "CREATE DATABASE workplace_orb ENCODING 'UTF8';" >nul 2>&1
    )
    echo     [OK] Database workplace_orb created.
) else (
    echo     [OK] Database workplace_orb exists.
)

:: [2/7] Auto-configure ORB .env (IMO auto-detection & DB password)
echo.
echo [2/7] Configuring ORB Environment (.env)...
if exist "%~dp0configure_orb_env.py" (
    "%PYTHONEXE%" "%~dp0configure_orb_env.py" %* %DB_PASS%
) else if exist "%ROOT%\setup\configure_orb_env.py" (
    "%PYTHONEXE%" "%ROOT%\setup\configure_orb_env.py" %* %DB_PASS%
)

:: [3/7] Configure Nginx routes
echo.
echo [3/7] Checking Nginx Configuration for /orb/ routes...
if exist "%~dp0configure_nginx_orb.py" (
    "%PYTHONEXE%" "%~dp0configure_nginx_orb.py"
) else if exist "%ROOT%\setup\configure_nginx_orb.py" (
    "%PYTHONEXE%" "%ROOT%\setup\configure_nginx_orb.py"
)

:: [4/7] Stop WP_ORB_Backend and apply file updates if bundled
echo.
echo [4/7] Stopping ORB service and applying updates...
"%NSSM%" stop WP_ORB_Backend >nul 2>&1

if exist "%~dp0orb_backend" (
    echo     Applying backend updates from %~dp0orb_backend...
    xcopy /E /Y "%~dp0orb_backend\*" "%ROOT%\orb_backend\" >nul
)
if exist "%~dp0html" (
    echo     Applying frontend updates from %~dp0html...
    xcopy /E /Y "%~dp0html\*" "%ROOT%\nginx\html\" >nul
)

:: [5/7] Run ORB Database Migrations
echo.
echo [5/7] Running ORB Database Migrations...
cd /d "%ROOT%\orb_backend"
"%PYTHONEXE%" run_migrations.py

:: [6/7] Install or update Windows Service WP_ORB_Backend
echo.
echo [6/7] Installing / Updating WP_ORB_Backend Windows Service...
sc query WP_ORB_Backend >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo     Installing WP_ORB_Backend service via NSSM...
    "%NSSM%" install WP_ORB_Backend "%PYTHONEXE%" "-m uvicorn app.main:app --host 127.0.0.1 --port 8007"
) else (
    echo     WP_ORB_Backend service already registered. Ensuring correct parameters...
    "%NSSM%" set WP_ORB_Backend Application "%PYTHONEXE%"
    "%NSSM%" set WP_ORB_Backend AppParameters "-m uvicorn app.main:app --host 127.0.0.1 --port 8007"
)
"%NSSM%" set WP_ORB_Backend AppDirectory "%ROOT%\orb_backend"
"%NSSM%" set WP_ORB_Backend AppEnvironmentExtra "PYTHONIOENCODING=utf-8"
"%NSSM%" set WP_ORB_Backend AppStdout "%ROOT%\logs\orb_backend.log"
"%NSSM%" set WP_ORB_Backend AppStderr "%ROOT%\logs\orb_backend.log"
"%NSSM%" set WP_ORB_Backend DependOnService WP_Postgres
"%NSSM%" set WP_Nginx DependOnService WP_ORB_Backend >nul 2>&1

:: Start ORB Service
echo     Starting WP_ORB_Backend service...
"%NSSM%" start WP_ORB_Backend

:: Reload Nginx
echo     Reloading Nginx web server...
"%ROOT%\nginx\nginx.exe" -s reload >nul 2>&1

:: [7/7] Reset sync cursors and pull all cloud records
echo.
echo [7/7] Synchronizing initial data from Cloud...
if exist "%~dp0sync_now.py" (
    "%PYTHONEXE%" "%~dp0sync_now.py"
) else if exist "%ROOT%\setup\sync_now.py" (
    "%PYTHONEXE%" "%ROOT%\setup\sync_now.py"
)

echo.
echo ========================================================
echo   ORB PLATFORM SETUP / UPDATE COMPLETE!
echo   - Backend: Running on 127.0.0.1:8007 (WP_ORB_Backend)
echo   - Nginx:   Proxying /orb/api/ and serving /orb/
echo   - URL:     http://localhost:8080/orb/
echo ========================================================
echo.
pause
