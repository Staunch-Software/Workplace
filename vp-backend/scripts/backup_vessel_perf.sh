#!/usr/bin/env bash
# ==============================================================================
# Automated backup script for Vessel Performance PostgreSQL database (Linux VM)
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VP_BACKEND_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-/opt/workplace/backups/vessel_perf}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
LOG_DIR="${VP_BACKEND_DIR}/logs"
LOG_FILE="${LOG_DIR}/backup.log"

mkdir -p "${BACKUP_DIR}" "${LOG_DIR}"

log() {
    local timestamp
    timestamp="$(date '+%Y-%m-%d %H:%M:%S')"
    echo "[$timestamp] [INFO] $1" | tee -a "${LOG_FILE}"
}

error() {
    local timestamp
    timestamp="$(date '+%Y-%m-%d %H:%M:%S')"
    echo "[$timestamp] [ERROR] $1" | tee -a "${LOG_FILE}" >&2
}

log "=========================================================="
log "Starting Vessel Performance Database Backup"

# Source .env if present
if [[ -f "${VP_BACKEND_DIR}/.env" ]]; then
    export $(grep -v '^#' "${VP_BACKEND_DIR}/.env" | grep -E '^(DB_USER|DB_PASSWORD|DB_HOST|DB_PORT|DB_NAME)=' | xargs)
fi

DB_NAME="${DB_NAME:-vessel_perf}"
DB_USER="${DB_USER:-postgres}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"

if [[ -n "${DB_PASSWORD:-}" ]]; then
    export PGPASSWORD="${DB_PASSWORD}"
fi

TIMESTAMP="$(date '+%Y%m%d_%H%M%S')"
DUMP_FILE="${BACKUP_DIR}/${DB_NAME}_backup_${TIMESTAMP}.dump"
SCHEMA_FILE="${BACKUP_DIR}/${DB_NAME}_schema_${TIMESTAMP}.sql"
SHA_FILE="${DUMP_FILE}.sha256"

log "Target: ${DB_USER}@${DB_HOST}:${DB_PORT}/${DB_NAME}"
log "Creating custom format dump: ${DUMP_FILE}"

# Run pg_dump (Custom format -Fc with gzip compression)
pg_dump -U "${DB_USER}" -h "${DB_HOST}" -p "${DB_PORT}" -d "${DB_NAME}" -Fc -f "${DUMP_FILE}"

# Run schema-only export
log "Creating schema SQL: ${SCHEMA_FILE}"
pg_dump -U "${DB_USER}" -h "${DB_HOST}" -p "${DB_PORT}" -d "${DB_NAME}" --schema-only -f "${SCHEMA_FILE}"

# Generate SHA-256 Checksum
log "Calculating SHA-256 checksum..."
sha256sum "${DUMP_FILE}" > "${SHA_FILE}"

# Verify integrity
log "Verifying archive catalog with pg_restore..."
pg_restore -l "${DUMP_FILE}" > /dev/null
log "Archive catalog verification passed."

# Retention pruning
if [[ "${RETENTION_DAYS}" -gt 0 ]]; then
    log "Pruning backups older than ${RETENTION_DAYS} days..."
    find "${BACKUP_DIR}" -type f -name "${DB_NAME}_*" -mtime "+${RETENTION_DAYS}" -delete || true
fi

log "Vessel Performance Backup Succeeded!"
log "=========================================================="
