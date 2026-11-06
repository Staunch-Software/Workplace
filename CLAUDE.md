# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

"Workplace" is a monorepo for a maritime fleet-management platform: one React SPA (`workplace-app`) plus several independent Python/FastAPI backends, one per module. There is no root build, no root test runner, and no shared package — each directory is run on its own. Backends are deployed to a shore VM and (for some modules) a copy runs on each vessel PC (Windows, `C:\WORKPLACE\...`, nginx in front, services like `WP_ORB_Backend`).

## Layout and dev ports

The frontend picks the backend by module; in dev (`isDev`) each axios client hard-codes a localhost port, in production it uses a path prefix routed by nginx.

| Directory | Module | Dev port | Notes |
|---|---|---|---|
| `workplace-backend` | Control plane: auth, users, vessels, permissions | 8000 (`/api/v1`) | Issues JWTs; owns the "control" DB |
| `Drs-backend` | Defect reporting (DRS) | 8001 (`/api/v1`) | Has `scraper/`, `externalwork/` |
| `lub_backend` | Lube oil analysis | 8002 | Single large `app/api.py` |
| `jira-backend` | Jira ticket integration | 8004 | Flat layout (`main.py`, `routers/`), Jira scraping via `automation/` |
| `Aepms-backend` | Engine performance (ME/AE shop trials, PDFs) | 8005 | Has `docker-compose.yml` (Postgres + API on 8000) |
| `Reports-backend` | Vessel reports / alerts | 8006 (`/api/v1`) | |
| `orb-backend` | MARPOL Oil Record Book (PDF extraction via Gemini, alerts, offline sync) | 8007 (`/api`) | Most complex backend; see below |
| `taskmgmt-backend` | Task management | — | Not wired into the frontend at the time of writing |
| `workplace-app/src/modules/{aepms,drs,jira,lubeoil,orb,reports}` | One frontend module per backend, each with its own `api/axios*.js` | | |

`venv/` folders in some backends are untracked local virtualenvs; ignore them.

## Commands

Frontend (`workplace-app/`): `npm install`, `npm run dev` (Vite, :5173), `npm run build`, `npm run lint`. Path aliases: `@` → `src`, `@drs` → `src/modules/drs`. No frontend test runner is configured.

Backends (run from inside the backend dir, with its venv + `requirements.txt` installed):

```bash
uvicorn app.main:app --port 8007 --reload      # orb-backend (use the port from the table above)
uvicorn main:app --port 8004 --reload          # jira-backend (flat layout, no app/ package)
alembic upgrade head                           # backends with alembic.ini: orb, Drs, Reports, Aepms, taskmgmt
```

`workplace-backend` has two alembic configs: `alembic_control.ini` and `alembic_drs.ini` — pass `-c <file>`. `Aepms-backend`'s entry module may be `app/api.py` or `newapi.py` rather than `app/main.py`; check before assuming. `lub_backend/app/api.py` is its app module.

Tests are sparse and mostly ad-hoc scripts: `orb-backend/tests/` (pytest-style: `pytest tests/test_sync_merge.py -k name`), `Reports-backend/tests/` (scraper tests that need live credentials), plus loose `test_*.py` scripts in `Drs-backend` and `Aepms-backend` that hit real services/DBs. Don't assume they run offline.

## Cross-cutting architecture

- **Auth is shared via a JWT secret, not a shared service call.** `workplace-backend` issues tokens; other backends (e.g. ORB) validate them locally and therefore need the *same* `SECRET_KEY`/`ALGORITHM`. Several backends also read the control DB directly (users, vessels, permissions) through a second DB connection (`CONTROL_DATABASE_URL`, `database_control.py`).
- **Two-database pattern.** Each module has its own Postgres DB (async SQLAlchemy/asyncpg, alembic migrations) plus access to the control DB for identity data.
- **Config is via `.env`** per backend (see `orb-backend/.env.example` for the fullest list: Azure Blob storage, Gemini keys, Poppler path, CORS origins). Backend CORS allow-lists are hard-coded in some `main.py` files (e.g. `workplace-backend`).
- **Files live in Azure Blob Storage** (Azurite locally/on vessels) across ORB, Aepms, Luboil, Drs.

## ORB backend: shore/vessel offline sync

One codebase, role chosen by `STORAGE_MODE` (`online` = shore VM, `offline` = vessel). Read `orb-backend/deploy/vessel/README.md` for the full runbook; the essentials:

- Extraction, uploads and alert checks run **only on the VM**; on a vessel those endpoints return 403 `shore_instance_only`.
- A vessel's background worker (`services/sync_worker.py`, `sync_processor.py`, `sync_outbox.py`, `sync_registry.py`) pushes its outbox and pulls changes from the VM's `/api/sync/*` (guarded by `SYNC_API_KEY`). DB triggers maintain `updated_at` and delete markers, so direct DB edits on the VM also sync. Adding a synced table means registering it in `sync_registry.py` and adding a migration with the triggers.
- **Time:** everything stored/synced is UTC; the vessel PC clock is never trusted — `services/clock.py` applies a measured offset against the VM (`utc_now()`, `orb_utc_now()` in DB defaults). Use `utc_now()`, not `datetime.utcnow()`. UI shows IST.
- Conflict rule: shore actions win; a vessel resolution request is applied only if the alert is still OPEN on the VM, else logged in `orb_sync_conflicts`.
- `PERFORMANCE_DATABASE_URL` is an optional read-only DB for the vessel performance pipeline. `USE_MOCK_EXTRACTION=true` avoids Gemini calls in dev.
- Extraction pipeline lives in `services/extraction.py` / `extraction_repair.py` (PDF → page images via Poppler → Gemini → structured entries → `item_rules`/`calculations`/alert services).

## Gotchas

- Repo contains stray artifacts (`dist.zip`, `data.zip`, PDFs, one-off `backfill_*`/`fix_*`/`wipe_all_data.py` scripts). The `wipe_all_data.py`-style scripts are destructive — never run them without explicit instruction.
- The `.claude/skills` dir provides `code-reviewer` (React + FastAPI review) and `git-helper` (conventional commits) skills; recent commits use `type(scope): message` (e.g. `fix(sync): ...`, `feat(orb): ...`).
