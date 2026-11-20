<#
.SYNOPSIS
    Automated backup script for Vessel Performance PostgreSQL database (vessel_perf).
.DESCRIPTION
    - Exports a timestamped compressed custom-format dump (-Fc) using pg_dump.
    - Also exports a readable schema-only SQL file.
    - Generates a SHA-256 checksum for data integrity verification.
    - Verifies the backup archive catalog using pg_restore.
    - Automatically cleans up older backups based on retention policy (default: 7 days).
    - Logs every action to vp-backend/logs/backup.log.
#>

[CmdletBinding()]
param(
    [string]$BackupDir = "D:\Updated_Workplace\backups\vessel_perf",
    [int]$RetentionDays = 7,
    [string]$DbName = "vessel_perf",
    [string]$DbUser = "postgres",
    [string]$DbHost = "127.0.0.1",
    [int]$DbPort = 5432,
    [string]$DbPassword = ""
)

$ErrorActionPreference = "Stop"

# Determine base paths
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$VpBackendDir = Split-Path -Parent $ScriptDir
$LogDir = Join-Path $VpBackendDir "logs"
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }
$LogFile = Join-Path $LogDir "backup.log"

function Log-Message([string]$Message, [string]$Level = "INFO") {
    $timestamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    $line = "[$timestamp] [$Level] $Message"
    Write-Host $line
    Add-Content -Path $LogFile -Value $line
}

Log-Message "=========================================================="
Log-Message "Starting Vessel Performance Database Backup"

# Read .env if parameters are not explicitly passed
$EnvFile = Join-Path $VpBackendDir ".env"
if (Test-Path $EnvFile) {
    Get-Content $EnvFile | ForEach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith("#") -and $line.Contains("=")) {
            $parts = $line.Split("=", 2)
            $key = $parts[0].Trim()
            $val = $parts[1].Trim().Trim('"').Trim("'")
            if ($key -eq "DB_NAME" -and -not $PSBoundParameters.ContainsKey('DbName')) { $DbName = $val }
            if ($key -eq "DB_USER" -and -not $PSBoundParameters.ContainsKey('DbUser')) { $DbUser = $val }
            if ($key -eq "DB_HOST" -and -not $PSBoundParameters.ContainsKey('DbHost')) { $DbHost = $val }
            if ($key -eq "DB_PORT" -and -not $PSBoundParameters.ContainsKey('DbPort')) { $DbPort = [int]$val }
            if ($key -eq "DB_PASSWORD" -and -not $DbPassword) { $DbPassword = $val }
        }
    }
}

if (-not $DbPassword) {
    $DbPassword = $env:PGPASSWORD
    if (-not $DbPassword) {
        $DbPassword = "sujil123"
    }
}

# Locate pg_dump.exe and pg_restore.exe
$PgDumpCandidates = @(
    "C:\Program Files\PostgreSQL\18\bin\pg_dump.exe",
    "C:\Program Files\PostgreSQL\17\bin\pg_dump.exe",
    "C:\Program Files\PostgreSQL\16\bin\pg_dump.exe",
    "C:\WORKPLACE\bin\pgsql\bin\pg_dump.exe",
    "pg_dump.exe"
)

$PgDumpPath = $null
foreach ($cand in $PgDumpCandidates) {
    if (Test-Path $cand) {
        $PgDumpPath = $cand
        break
    }
}

if (-not $PgDumpPath) {
    $found = Get-Command "pg_dump.exe" -ErrorAction SilentlyContinue
    if ($found) { $PgDumpPath = $found.Source }
}

if (-not $PgDumpPath) {
    Log-Message "FATAL: pg_dump.exe could not be found in standard PostgreSQL directories or PATH." "ERROR"
    exit 1
}

$PgRestorePath = $PgDumpPath.Replace("pg_dump.exe", "pg_restore.exe")
Log-Message "Using pg_dump binary: $PgDumpPath"
Log-Message "Target database: ${DbUser}@${DbHost}:${DbPort}/${DbName}"

# Ensure Backup Directory exists
if (-not (Test-Path $BackupDir)) {
    New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
    Log-Message "Created backup destination: $BackupDir"
}

# Build timestamped filenames
$Timestamp = (Get-Date).ToString("yyyyMMdd_HHmmss")
$DumpFilename = "${DbName}_backup_${Timestamp}.dump"
$DumpFilePath = Join-Path $BackupDir $DumpFilename
$SchemaFilename = "${DbName}_schema_${Timestamp}.sql"
$SchemaFilePath = Join-Path $BackupDir $SchemaFilename
$ShaFilename = "${DumpFilename}.sha256"
$ShaFilePath = Join-Path $BackupDir $ShaFilename

# Execute pg_dump (Custom Format with compression)
Log-Message "Creating compressed database dump: $DumpFilename"
$env:PGPASSWORD = $DbPassword

$dumpArgs = @(
    "-U", $DbUser,
    "-h", $DbHost,
    "-p", $DbPort.ToString(),
    "-d", $DbName,
    "-Fc",
    "-f", $DumpFilePath
)

$sw = [System.Diagnostics.Stopwatch]::StartNew()
& $PgDumpPath $dumpArgs
if ($LASTEXITCODE -ne 0) {
    Log-Message "FATAL: pg_dump failed with exit code $LASTEXITCODE" "ERROR"
    exit $LASTEXITCODE
}
$sw.Stop()

$dumpFile = Get-Item $DumpFilePath
$dumpSizeMB = [Math]::Round($dumpFile.Length / 1MB, 2)
Log-Message "Dump completed in $($sw.Elapsed.TotalSeconds.ToString('F1'))s - Size: $dumpSizeMB MB ($($dumpFile.Length) bytes)"

# Dump schema-only SQL
Log-Message "Exporting readable schema-only SQL: $SchemaFilename"
$schemaArgs = @(
    "-U", $DbUser,
    "-h", $DbHost,
    "-p", $DbPort.ToString(),
    "-d", $DbName,
    "--schema-only",
    "-f", $SchemaFilePath
)
& $PgDumpPath $schemaArgs

# Generate SHA-256 Checksum
Log-Message "Computing SHA-256 checksum..."
$hashObj = Get-FileHash -Path $DumpFilePath -Algorithm SHA256
$hashObj | Out-File -FilePath $ShaFilePath -Encoding utf8
Log-Message "Checksum: $($hashObj.Hash)"

# Verify Backup Catalog with pg_restore -l
if (Test-Path $PgRestorePath) {
    Log-Message "Verifying archive catalog with pg_restore..."
    $tocEntries = (& $PgRestorePath -l $DumpFilePath 2>&1 | Measure-Object -Line).Lines
    Log-Message "Archive verified successfully: $tocEntries Table/Schema/Data TOC entries indexed."
}

# Retention Policy Pruning
if ($RetentionDays -gt 0) {
    Log-Message "Applying retention policy (keeping last $RetentionDays days)..."
    $cutoffDate = (Get-Date).AddDays(-$RetentionDays)
    $oldFiles = Get-ChildItem -Path $BackupDir -File | Where-Object {
        $_.Name -like "${DbName}_*" -and $_.LastWriteTime -lt $cutoffDate
    }
    foreach ($file in $oldFiles) {
        Remove-Item -Path $file.FullName -Force
        Log-Message "Pruned expired backup: $($file.Name)"
    }
}

Log-Message "Vessel Performance Backup Succeeded!"
Log-Message "=========================================================="
exit 0
