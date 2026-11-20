<#
.SYNOPSIS
    Monorepo-wide PostgreSQL backup script for all Workplace platform databases.
.DESCRIPTION
    Backs up:
    - workplace_control (Central users, permissions, vessels)
    - vessel_perf       (Vessel Performance telemetry & noon reports)
    - workplace_orb     (MARPOL Oil Record Book & OCR)
    - workplace_drs     (Daily Reporting System & Defects)
    - workplace_reports (Vessel reports & alerts)
    - workplace_jira    (Jira issues & tickets)
    - workplace_lubeoil (Lube oil analysis)
#>

[CmdletBinding()]
param(
    [string]$BackupBaseDir = "D:\Updated_Workplace\backups",
    [int]$RetentionDays = 7,
    [string]$DbUser = "postgres",
    [string]$DbHost = "127.0.0.1",
    [int]$DbPort = 5432,
    [string]$DbPassword = "sujil123"
)

$ErrorActionPreference = "Continue"

$Timestamp = (Get-Date).ToString("yyyyMMdd_HHmmss")
Write-Host "=========================================================="
Write-Host "Starting Full Workplace Platform Database Backup [$Timestamp]"
Write-Host "=========================================================="

# Locate pg_dump
$PgDumpPath = "C:\Program Files\PostgreSQL\18\bin\pg_dump.exe"
if (-not (Test-Path $PgDumpPath)) {
    $PgDumpPath = "C:\WORKPLACE\bin\pgsql\bin\pg_dump.exe"
}

$env:PGPASSWORD = $DbPassword

$databases = @(
    "workplace_control",
    "vessel_perf",
    "workplace_orb",
    "workplace_drs",
    "workplace_reports",
    "workplace_jira",
    "workplace_lubeoil"
)

foreach ($db in $databases) {
    $dbBackupDir = Join-Path $BackupBaseDir $db
    if (-not (Test-Path $dbBackupDir)) {
        New-Item -ItemType Directory -Path $dbBackupDir -Force | Out-Null
    }
    
    $dumpFile = Join-Path $dbBackupDir "${db}_backup_${Timestamp}.dump"
    Write-Host "[$db] Dumping to $dumpFile..."
    
    & $PgDumpPath -U $DbUser -h $DbHost -p $DbPort -d $db -Fc -f $dumpFile
    
    if ($LASTEXITCODE -eq 0) {
        $fileObj = Get-Item $dumpFile
        $sizeMB = [Math]::Round($fileObj.Length / 1MB, 2)
        Write-Host "[$db] SUCCESS ($sizeMB MB)" -ForegroundColor Green
        
        # SHA256
        Get-FileHash -Path $dumpFile -Algorithm SHA256 | Out-File -FilePath "${dumpFile}.sha256" -Encoding utf8
    } else {
        Write-Host "[$db] FAILED (Code $LASTEXITCODE)" -ForegroundColor Red
    }
}

# Retention Pruning
if ($RetentionDays -gt 0) {
    Write-Host "Cleaning backups older than $RetentionDays days..."
    $cutoff = (Get-Date).AddDays(-$RetentionDays)
    Get-ChildItem -Path $BackupBaseDir -Recurse -File -Include "*.dump", "*.sha256", "*.sql" | Where-Object {
        $_.LastWriteTime -lt $cutoff -and $_.Name -notlike "*initial_backup*"
    } | Remove-Item -Force
}

Write-Host "=========================================================="
Write-Host "All Database Backups Complete!"
Write-Host "=========================================================="
