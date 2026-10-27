@echo off
setlocal EnableDelayedExpansion

:: Check for Administrator permissions
if "%~1"=="/no-elevate" goto :skip_elevate
net session >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo Administrator permissions required. Requesting elevation...
    powershell -Command "Start-Process cmd -ArgumentList '/c \"\"%~f0\"\"' -Verb RunAs"
    exit /b
)
:skip_elevate

set "ROOT=C:\WORKPLACE"
set "NSSM=%ROOT%\nssm\win64\nssm.exe"

set "PGBIN=%ROOT%\bin\pgsql\bin"
set "PGDATA=%ROOT%\bin\pgsql\data"
set "VCREDIST=%ROOT%\bin\VC_redist.x64.exe"
set "NODEEXE=%ROOT%\bin\node\node.exe"
set "AZURITE_JS=%ROOT%\bin\node\node_modules\azurite\dist\src\azurite.js"
set "PYTHONEXE=%ROOT%\bin\python\python.exe"

set "DB_PASS=maritime123"

echo ===================================================
echo   WORKPLACE PLATFORM - OFFLINE VESSEL INSTALLER
echo ===================================================
echo.

:: --- STEP 1: CLEAN UP ---
echo [1/8] Cleaning system processes and services...
taskkill /F /IM postgres.exe >nul 2>&1
taskkill /F /IM python.exe >nul 2>&1
taskkill /F /IM nginx.exe >nul 2>&1
taskkill /F /IM node.exe >nul 2>&1

:: Stop and Remove all Services to ensure a clean install
for %%S in (WP_Postgres WP_Azurite WP_DRS_Backend WP_Jira_Backend WP_Core_Backend WP_Lube_Backend WP_AEPMS_Backend WP_Reports_Backend WP_ORB_Backend WP_Nginx) do (
    "%NSSM%" stop %%S >nul 2>&1
    "%NSSM%" remove %%S confirm >nul 2>&1
)
timeout /t 3 /nobreak >nul

:: --- STEP 2: INSTALL C++ ---
echo [2/8] Checking C++ Redistributable...
if exist "%VCREDIST%" (
    echo     Installing VC Redist...
    "%VCREDIST%" /install /passive /norestart
)

:: --- STEP 3: INIT DB ---
echo [3/8] Initializing Database Cluster...
if exist "%PGDATA%" (
    :: FIX: Validate that the existing data directory is a real cluster before proceeding.
    :: If PG_VERSION is missing, the folder exists but is not a valid initdb output.
    if not exist "%PGDATA%\PG_VERSION" (
        echo ERROR: Data folder exists but is not a valid PostgreSQL cluster.
        echo        Delete %PGDATA% and re-run the installer to reinitialize.
        pause
        exit /b 1
    )
    echo     Data folder already exists and appears valid.
    if exist "%PGDATA%\postmaster.pid" del /f "%PGDATA%\postmaster.pid"
) else (
    mkdir "%PGDATA%"
    echo %DB_PASS%> "%ROOT%\setup\pw.txt"
    "%PGBIN%\initdb.exe" -D "%PGDATA%" -U postgres --auth=password --pwfile="%ROOT%\setup\pw.txt"
    del "%ROOT%\setup\pw.txt"
)

:: --- STEP 4: START POSTGRES SERVICE ---
echo [4/8] Securing folders and Starting PostgreSQL...
if not exist "%ROOT%\logs" mkdir "%ROOT%\logs"

:: IMPORTANT: Grant permissions to 'NetworkService' specifically.
:: Postgres refuses to run as Administrator, so it MUST use this unprivileged account.
icacls "%ROOT%" /grant "NT AUTHORITY\NetworkService":(RX) >nul 2>&1
icacls "%PGDATA%" /grant "NT AUTHORITY\NetworkService":(OI)(CI)F /T >nul 2>&1
icacls "%ROOT%\logs" /grant "NT AUTHORITY\NetworkService":(OI)(CI)F /T >nul 2>&1

"%NSSM%" install WP_Postgres "%PGBIN%\postgres.exe" "-D \"%PGDATA%\""
"%NSSM%" set WP_Postgres ObjectName "NT AUTHORITY\NetworkService" ""
"%NSSM%" set WP_Postgres AppStdout "%ROOT%\logs\postgres.log"
"%NSSM%" set WP_Postgres AppStderr "%ROOT%\logs\postgres.log"
"%NSSM%" start WP_Postgres

echo     Waiting for Database to initialize...
timeout /t 15 /nobreak >nul

:: Verify if Postgres is listening
"%PGBIN%\pg_isready.exe" -h 127.0.0.1 -p 5432
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: PostgreSQL is not accepting connections.
    echo        Check %ROOT%\logs\postgres.log for error details.
    pause
    exit /b 1
)

:: --- STEP 5: SETUP DATABASES & TABLES ---
echo [5/8] Creating Databases and Tables...
set "PGPASSWORD=%DB_PASS%"

:: Create DBs if they don't exist
"%PGBIN%\psql.exe" -h 127.0.0.1 -U postgres -c "CREATE DATABASE workplace_control;" >nul 2>&1
"%PGBIN%\psql.exe" -h 127.0.0.1 -U postgres -c "CREATE DATABASE workplace_drs;" >nul 2>&1
:: Jira requires specific encoding and collation to avoid locale issues
"%PGBIN%\psql.exe" -h 127.0.0.1 -U postgres -c "CREATE DATABASE workplace_jira ENCODING 'UTF8' TEMPLATE template0 LC_COLLATE 'C' LC_CTYPE 'C';" >nul 2>&1
"%PGBIN%\psql.exe" -h 127.0.0.1 -U postgres -c "CREATE DATABASE workplace_lubeoil;" >nul 2>&1
"%PGBIN%\psql.exe" -h 127.0.0.1 -U postgres -c "CREATE DATABASE workplace_engineperf;" >nul 2>&1
"%PGBIN%\psql.exe" -h 127.0.0.1 -U postgres -c "CREATE DATABASE workplace_reports;" >nul 2>&1
:: ORB requires UTF-8 to handle Unicode superscripts from OCR
"%PGBIN%\psql.exe" -h 127.0.0.1 -U postgres -c "CREATE DATABASE workplace_orb ENCODING 'UTF8' TEMPLATE template0 LC_COLLATE 'C' LC_CTYPE 'C';" >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    "%PGBIN%\psql.exe" -h 127.0.0.1 -U postgres -c "CREATE DATABASE workplace_orb ENCODING 'UTF8';" >nul 2>&1
)

:: Run Migrations
echo     Running Migrations: Workplace DRS...
cd /d "%ROOT%\drs_backend"
"%PYTHONEXE%" create_drs_tables.py

echo     Running Migrations: Workplace Jira...
cd /d "%ROOT%\jira-backend"
"%PYTHONEXE%" create_jira_tables.py

echo     Running Migrations: Workplace Lube...
cd /d "%ROOT%\lub_backend"
"%PYTHONEXE%" create_lub_tables.py

echo     Running Migrations: Workplace Engine Performance...
cd /d "%ROOT%\Aepms-backend"
"%PYTHONEXE%" create_tables.py

echo     Running Migrations: Workplace Reports...
cd /d "%ROOT%\reports_backend"
"%PYTHONEXE%" create_reports_tables.py

echo     Running Migrations: Workplace ORB...
cd /d "%ROOT%\orb_backend"
"%PYTHONEXE%" run_migrations.py

echo     Running Migrations: Workplace Core...
cd /d "%ROOT%\core_backend"
"%PYTHONEXE%" create_table.py
"%PYTHONEXE%" seed_admin.py

cd /d "%ROOT%"
:: FIX: Clear PGPASSWORD immediately after use so it does not linger in the environment.
set "PGPASSWORD="

:: --- STEP 6: INSTALL APP SERVICES ---
echo [6/8] Installing Application Services...

echo     - Azurite
if not exist "%ROOT%\azurite_data" mkdir "%ROOT%\azurite_data"
"%NSSM%" install WP_Azurite "%NODEEXE%" "\"%AZURITE_JS%\" --blobHost 0.0.0.0 --queueHost 0.0.0.0 --tableHost 0.0.0.0 --location \"%ROOT%\azurite_data\""
"%NSSM%" set WP_Azurite AppDirectory "%ROOT%\azurite_data"
"%NSSM%" set WP_Azurite AppStdout "%ROOT%\logs\azurite.log"
"%NSSM%" set WP_Azurite AppStderr "%ROOT%\logs\azurite.log"

echo     - Core Backend (Port 8000)
"%NSSM%" install WP_Core_Backend "%PYTHONEXE%" "-m uvicorn app.main:app --host 127.0.0.1 --port 8000"
"%NSSM%" set WP_Core_Backend AppDirectory "%ROOT%\core_backend"
"%NSSM%" set WP_Core_Backend AppEnvironmentExtra "PYTHONIOENCODING=utf-8"
"%NSSM%" set WP_Core_Backend AppStdout "%ROOT%\logs\core_backend.log"
"%NSSM%" set WP_Core_Backend AppStderr "%ROOT%\logs\core_backend.log"
"%NSSM%" set WP_Core_Backend DependOnService WP_Postgres

echo     - DRS Backend (Port 8001)
"%NSSM%" install WP_DRS_Backend "%PYTHONEXE%" "-m uvicorn app.main:app --host 127.0.0.1 --port 8001"
"%NSSM%" set WP_DRS_Backend AppDirectory "%ROOT%\drs_backend"
"%NSSM%" set WP_DRS_Backend AppEnvironmentExtra "PYTHONIOENCODING=utf-8"
"%NSSM%" set WP_DRS_Backend AppStdout "%ROOT%\logs\drs_backend.log"
"%NSSM%" set WP_DRS_Backend AppStderr "%ROOT%\logs\drs_backend.log"
:: FIX: DependOnService correctly set on WP_DRS_Backend (not WP_Core_Backend)
"%NSSM%" set WP_DRS_Backend DependOnService WP_Postgres

echo     - Jira Backend (Port 8004)
"%NSSM%" install WP_Jira_Backend "%PYTHONEXE%" "-m uvicorn main:app --host 127.0.0.1 --port 8004"
"%NSSM%" set WP_Jira_Backend AppDirectory "%ROOT%\jira-backend"
"%NSSM%" set WP_Jira_Backend AppEnvironmentExtra "PYTHONIOENCODING=utf-8"
"%NSSM%" set WP_Jira_Backend AppStdout "%ROOT%\logs\jira_backend.log"
"%NSSM%" set WP_Jira_Backend AppStderr "%ROOT%\logs\jira_backend.log"
"%NSSM%" set WP_Jira_Backend DependOnService WP_Postgres

echo     - Lube Backend (Port 8002)
"%NSSM%" install WP_Lube_Backend "%PYTHONEXE%" "-m uvicorn app.api:app --host 127.0.0.1 --port 8002"
"%NSSM%" set WP_Lube_Backend AppDirectory "%ROOT%\lub_backend"
"%NSSM%" set WP_Lube_Backend AppEnvironmentExtra "IS_VESSEL_INSTANCE=true" "PYTHONIOENCODING=utf-8"
"%NSSM%" set WP_Lube_Backend AppStdout "%ROOT%\logs\lube_backend.log"
"%NSSM%" set WP_Lube_Backend AppStderr "%ROOT%\logs\lube_backend.log"
"%NSSM%" set WP_Lube_Backend DependOnService WP_Postgres

echo     - Engine Performance Backend (Port 8003)
"%NSSM%" install WP_AEPMS_Backend "%PYTHONEXE%" "-m uvicorn app.api:app --host 127.0.0.1 --port 8003"
"%NSSM%" set WP_AEPMS_Backend AppDirectory "%ROOT%\Aepms-backend"
"%NSSM%" set WP_AEPMS_Backend AppEnvironmentExtra "IS_VESSEL_INSTANCE=true" "PYTHONIOENCODING=utf-8"
"%NSSM%" set WP_AEPMS_Backend AppStdout "%ROOT%\logs\aepms_backend.log"
"%NSSM%" set WP_AEPMS_Backend AppStderr "%ROOT%\logs\aepms_backend.log"
"%NSSM%" set WP_AEPMS_Backend DependOnService WP_Postgres

echo     - Reports Backend (Port 8005)
"%NSSM%" install WP_Reports_Backend "%PYTHONEXE%" "-m uvicorn app.main:app --host 127.0.0.1 --port 8005"
"%NSSM%" set WP_Reports_Backend AppDirectory "%ROOT%\reports_backend"
"%NSSM%" set WP_Reports_Backend AppEnvironmentExtra "PYTHONIOENCODING=utf-8"
"%NSSM%" set WP_Reports_Backend AppStdout "%ROOT%\logs\reports_backend.log"
"%NSSM%" set WP_Reports_Backend AppStderr "%ROOT%\logs\reports_backend.log"
"%NSSM%" set WP_Reports_Backend DependOnService WP_Postgres

echo     - ORB Backend (Port 8007)
"%NSSM%" install WP_ORB_Backend "%PYTHONEXE%" "-m uvicorn app.main:app --host 127.0.0.1 --port 8007"
"%NSSM%" set WP_ORB_Backend AppDirectory "%ROOT%\orb_backend"
"%NSSM%" set WP_ORB_Backend AppEnvironmentExtra "PYTHONIOENCODING=utf-8"
"%NSSM%" set WP_ORB_Backend AppStdout "%ROOT%\logs\orb_backend.log"
"%NSSM%" set WP_ORB_Backend AppStderr "%ROOT%\logs\orb_backend.log"
"%NSSM%" set WP_ORB_Backend DependOnService WP_Postgres

echo     - Nginx (Port 8080)
"%NSSM%" install WP_Nginx "%ROOT%\nginx\nginx.exe"
"%NSSM%" set WP_Nginx AppDirectory "%ROOT%\nginx"
"%NSSM%" set WP_Nginx AppStdout "%ROOT%\logs\nginx.log"
"%NSSM%" set WP_Nginx AppStderr "%ROOT%\logs\nginx.log"
:: FIX: NSSM DependOnService only accepts one argument per call — split into separate calls
"%NSSM%" set WP_Nginx DependOnService WP_Core_Backend
"%NSSM%" set WP_Nginx DependOnService WP_DRS_Backend
"%NSSM%" set WP_Nginx DependOnService WP_Jira_Backend
"%NSSM%" set WP_Nginx DependOnService WP_Lube_Backend
"%NSSM%" set WP_Nginx DependOnService WP_AEPMS_Backend
"%NSSM%" set WP_Nginx DependOnService WP_Reports_Backend
"%NSSM%" set WP_Nginx DependOnService WP_ORB_Backend

:: --- STEP 7: CONFIGURE FIREWALL ---
echo [7/8] Configuring Windows Firewall for Vessel Network...
netsh advfirewall firewall add rule name="Workplace Platform 8080" dir=in action=allow protocol=TCP localport=8080 >nul 2>&1
netsh advfirewall firewall add rule name="Azurite Blob Port 10000" dir=in action=allow protocol=TCP localport=10000 >nul 2>&1
netsh advfirewall firewall add rule name="Azurite Queue Port 10001" dir=in action=allow protocol=TCP localport=10001 >nul 2>&1
netsh advfirewall firewall add rule name="Azurite Table Port 10002" dir=in action=allow protocol=TCP localport=10002 >nul 2>&1
echo     Firewall rules added!

:: --- STEP 8: START EVERYTHING ---
echo [8/8] Starting the Vessel Platform...
"%NSSM%" start WP_Azurite
"%NSSM%" start WP_Core_Backend
"%NSSM%" start WP_DRS_Backend
"%NSSM%" start WP_Jira_Backend
"%NSSM%" start WP_Lube_Backend
"%NSSM%" start WP_AEPMS_Backend
"%NSSM%" start WP_Reports_Backend
"%NSSM%" start WP_ORB_Backend
"%NSSM%" start WP_Nginx

echo.
echo ===================================================
echo   INSTALLATION SUCCESSFUL!
echo ===================================================
echo.
echo Vessel Server IP Address(es):
ipconfig | findstr IPv4
echo.
echo ===================================================
echo Access the platform from this Server PC:
echo http://localhost:8080
echo.
echo Access from other Vessel Crew PCs:
echo http://[VESSEL_SERVER_IP]:8080  (Replace with IP above)
echo ===================================================
pause
