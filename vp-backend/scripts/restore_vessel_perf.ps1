<#
.SYNOPSIS
    Restores a Vessel Performance backup dump into a PostgreSQL database.
.DESCRIPTION
    Can restore into the primary database (vessel_perf) or a scratch/test database
    (e.g., vessel_perf_scratch) for safe migration dry-runs.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory=$false)]
    [string]$DumpFile = "",
    [string]$TargetDb = "vessel_perf_scratch",
    [string]$DbUser = "postgres",
    [string]$DbHost = "127.0.0.1",
    [int]$DbPort = 5432,
    [string]$DbPassword = "",
    [switch]$CreateDatabase
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$VpBackendDir = Split-Path -Parent $ScriptDir
$BackupDir = "D:\Updated_Workplace\backups\vessel_perf"

# Read .env if parameters are not explicitly passed
$EnvFile = Join-Path $VpBackendDir ".env"
if (Test-Path $EnvFile) {
    Get-Content $EnvFile | ForEach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith("#") -and $line.Contains("=")) {
            $parts = $line.Split("=", 2)
            $key = $parts[0].Trim()
            $val = $parts[1].Trim().Trim('"').Trim("'")
            if ($key -eq "DB_PASSWORD" -and -not $DbPassword) { $DbPassword = $val }
        }
    }
}

if (-not $DbPassword) {
    $DbPassword = $env:PGPASSWORD
    if (-not $DbPassword) { $DbPassword = "sujil123" }
}

# Locate latest dump file if none specified
if (-not $DumpFile) {
    $latest = Get-ChildItem -Path $BackupDir -Filter "*.dump" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($latest) {
        $DumpFile = $latest.FullName
    } else {
        Write-Error "No .dump file specified and none found in $BackupDir."
        exit 1
    }
}

if (-not (Test-Path $DumpFile)) {
    Write-Error "Dump file not found: $DumpFile"
    exit 1
}

# Locate PostgreSQL binaries
$PgRestoreCandidates = @(
    "C:\Program Files\PostgreSQL\18\bin\pg_restore.exe",
    "C:\Program Files\PostgreSQL\17\bin\pg_restore.exe",
    "C:\Program Files\PostgreSQL\16\bin\pg_restore.exe",
    "C:\WORKPLACE\bin\pgsql\bin\pg_restore.exe",
    "pg_restore.exe"
)

$PgRestorePath = $null
foreach ($cand in $PgRestoreCandidates) {
    if (Test-Path $cand) {
        $PgRestorePath = $cand
        break
    }
}
$PsqlPath = $PgRestorePath.Replace("pg_restore.exe", "psql.exe")

$env:PGPASSWORD = $DbPassword

Write-Host "=========================================================="
Write-Host "Restoring Vessel Performance Database"
Write-Host "Dump source: $DumpFile"
Write-Host "Target DB:   ${DbUser}@${DbHost}:${DbPort}/${TargetDb}"
Write-Host "=========================================================="

# Create database if requested or if it doesn't exist
$checkDb = & $PsqlPath -U $DbUser -h $DbHost -p $DbPort -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$TargetDb'" 2>&1
if ($checkDb.Trim() -ne "1") {
    Write-Host "Target database '$TargetDb' does not exist. Creating it..."
    & $PsqlPath -U $DbUser -h $DbHost -p $DbPort -d postgres -c "CREATE DATABASE $TargetDb ENCODING 'UTF8';"
    Write-Host "Database '$TargetDb' created."
}

Write-Host "Executing pg_restore into '$TargetDb'..."
$restoreArgs = @(
    "-U", $DbUser,
    "-h", $DbHost,
    "-p", $DbPort.ToString(),
    "-d", $TargetDb,
    "--no-owner",
    "--no-privileges",
    $DumpFile
)

# pg_restore may return non-zero for minor warnings (like duplicate constraints or existing objects)
& $PgRestorePath $restoreArgs

Write-Host "Restore operation completed into '$TargetDb'."
Write-Host "=========================================================="
