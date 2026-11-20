# Vessel Performance (VP): Backup & Disaster Recovery Runbook

This document defines the operational runbook for backing up, verifying, and restoring the Vessel Performance (`vessel_perf`) database and session state for the Workplace monorepo platform.

---

## 1. Overview & Architecture

Vessel Performance stores critical maritime vessel noon reports, telemetry, charter-party warranties, and emissions data (~2.66 GB production data, 312 tables and TOC objects).

| Component | Target | Storage Format | Backup Location |
|---|---|---|---|
| **Vessel Performance DB** | `vessel_perf` | PostgreSQL Custom Dump (`-Fc` gzip compressed) | `D:\Updated_Workplace\backups\vessel_perf\` (Win) / `/opt/workplace/backups/vessel_perf/` (Linux) |
| **Schema Only** | `vessel_perf` | Plain SQL (`--schema-only`) | `D:\Updated_Workplace\backups\vessel_perf\` |
| **Control DB** | `workplace_control` | PostgreSQL Custom Dump (`-Fc`) | `D:\Updated_Workplace\backups\workplace_control\` |
| **Session State** | `auth.json`, `.wartsila_session` | JSON & State Directory | `vp-backend/backend/mariapps_pipeline/`, `vp-backend/.wartsila_session/` |
| **Platform Config** | `.env` | Environment File | `vp-backend/.env` |

---

## 2. Backup Execution

### A. Windows (Development / Local Environment)

#### 1-Click Backup
Run `vp-backend\scripts\backup_vessel_perf.bat` directly, or execute in PowerShell:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\vp-backend\scripts\backup_vessel_perf.ps1
```

**Parameters available:**
- `-BackupDir <path>`: Custom destination folder (default: `D:\Updated_Workplace\backups\vessel_perf`).
- `-RetentionDays <int>`: Days of history to keep (default: `7`). Expired backups are automatically pruned.
- `-DbName <name>`: Target database (default: `vessel_perf`).

**Generated Files:**
1. `vessel_perf_backup_YYYYMMDD_HHMMSS.dump`: High-compression custom binary archive.
2. `vessel_perf_schema_YYYYMMDD_HHMMSS.sql`: Human-readable DDL schema.
3. `vessel_perf_backup_YYYYMMDD_HHMMSS.dump.sha256`: Cryptographic integrity hash.
4. `vp-backend\logs\backup.log`: Timestamped operation logs.

---

### B. Linux VM (Production Environment)

Run the shell script:
```bash
cd /opt/workplace/Workplace/vp-backend
chmod +x scripts/backup_vessel_perf.sh
./scripts/backup_vessel_perf.sh
```

---

## 3. Automated Scheduling

### Windows Task Scheduler (Daily at 03:00 AM)
Run in Administrator PowerShell to register a daily task:
```powershell
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File D:\Updated_Workplace\Workplace\vp-backend\scripts\backup_vessel_perf.ps1"
$trigger = New-ScheduledTaskTrigger -Daily -At 3:00AM
Register-ScheduledTask -Action $action -Trigger $trigger -TaskName "Workplace_VP_Database_Backup" -Description "Daily backup of Vessel Performance database"
```

### Linux VM Crontab (Daily at 03:00 AM)
Add to VM user crontab (`crontab -e`):
```cron
# Daily backup of Vessel Performance database at 03:00 IST
0 3 * * * /opt/workplace/Workplace/vp-backend/scripts/backup_vessel_perf.sh >> /opt/workplace/Workplace/vp-backend/logs/backup_cron.log 2>&1
```

---

## 4. Integrity Verification

Every backup automatically checks its catalog with `pg_restore -l`. To manually verify any dump file:

```powershell
# Verify TOC table catalog
pg_restore -l "D:\Updated_Workplace\backups\vessel_perf\<filename>.dump"

# Verify SHA-256 Checksum
Get-FileHash -Path "D:\Updated_Workplace\backups\vessel_perf\<filename>.dump" -Algorithm SHA256
Get-Content "D:\Updated_Workplace\backups\vessel_perf\<filename>.dump.sha256"
```

---

## 5. Restoration & Disaster Recovery

### Safe Restore to Scratch Database (Recommended Before Cutover)
Before making production migrations or schema changes, restore the dump into a scratch database to test scripts:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\vp-backend\scripts\restore_vessel_perf.ps1 -TargetDb "vessel_perf_scratch" -CreateDatabase
```

### Full Production Restore (Disaster Recovery)
In case of database failure or corrupted state:

1. Stop VP and pipeline services:
   ```bash
   sudo systemctl stop workplace-vp
   ```
2. Restore using `pg_restore`:
   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\vp-backend\scripts\restore_vessel_perf.ps1 -TargetDb "vessel_perf"
   ```
3. Restart VP service:
   ```bash
   sudo systemctl start workplace-vp
   ```

---

## 6. Monorepo Multi-Database Backup

To backup all Workplace platform databases (`workplace_control`, `vessel_perf`, `workplace_orb`, `workplace_drs`, `workplace_reports`, `workplace_jira`, `workplace_lubeoil`):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Workplace\scripts\backup_all_workplace_dbs.ps1
```
Or double-click `Workplace\scripts\backup_all_workplace_dbs.bat`.
