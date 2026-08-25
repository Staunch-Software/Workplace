# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository overview

This is the **Ozellar** maritime software platform: a monorepo containing one React frontend and six independent FastAPI backends, one per business module. There is no shared build tool or workspace config tying them together — each service is developed, run, and deployed independently.

| Directory | Module | Purpose |
|---|---|---|
| `workplace-app` | Frontend | React SPA — shell/hub for all modules, auth, admin |
| `workplace-backend` | Control plane | Owns users, vessels, permissions, JWT auth — the auth/authorization hub every other backend depends on |
| `Drs-backend` | DRS | Defect Reporting System |
| `jira-backend` | Jira | "Ozellar MA Ticketing Portal" — syncs with real Jira via browser-cookie automation (Playwright), not the Jira REST API |
| `Aepms-backend` | AEPMS | Auxiliary/Main Engine Performance Monitoring System — ingests shop-trial/monthly engine data (Excel/PDF), computes ISO-corrected deviations, generates reports |
| `lub_backend` | Lube Oil | Lubricating oil analysis — ingests lab report PDFs (including via automated email upload), extracts data, stores results |
| `taskmgmt-backend` | Task Management | Task/subtask assignment with vessel-role RACI tracking; its `scraper_worker/` subdirectory is a separate standalone Playwright-based scraper (own venv/requirements) that logs into class-society and vetting portals (ABS, DNV, IRS, SmartPAL) to pull survey/certificate data, independent of the FastAPI app |

### Cross-cutting architecture

- **Shared control database**: `workplace-backend` owns a Postgres "control" database (`workplace_control`) holding `users`, `vessels`, and a JSONB `permissions` map (flags per module: `drs`, `jira`, `voyage`, `lubeoil`, `engine_performance`, `task_management`). Every other backend (Drs, jira, Aepms, lub, taskmgmt) connects to this **same control database directly** — there is no internal API call between services for auth data. `taskmgmt-backend` reads it via `CONTROL_DATABASE_URL`/`app/config.py`; the others use their own `app/core/database_control.py`. When changing control-plane schema (`workplace-backend/app/models/control/`), check whether other backends read those tables directly before assuming the change is isolated. `users.role_code` (`SURVEY_COORDINATOR` | `TA` | `TSI` | `TM`) is a task-management-only refinement on top of `role` — don't assume other modules read or validate it.
- **Per-module domain databases**: each backend also owns its own Postgres database for domain data (e.g. Drs-backend → `Drs`, Aepms-backend → `aepms_db` on TimescaleDB/PostGIS, taskmgmt-backend → `TASKMGMT_DATABASE_URL` holding `task_master`/`vessel_role_assignment`/`task_raci_entry`). The `scraper_worker/` subprocess under taskmgmt-backend talks to both the taskmgmt and control DBs directly via its own plain-SQLAlchemy-Core layer (`scraper_worker/db.py`), bypassing the FastAPI app's async engine entirely.
- **Shore/vessel offline sync**: Drs-backend and jira-backend (and referenced elsewhere) support dual `STORAGE_MODE=online|offline` deployment — a vessel-side instance runs offline and syncs to a shore server via `SYNC_API_KEY`/`CLOUD_BASE_URL` when connectivity is available (see `routers/sync.py`, `services/sync_worker.py`, `services/sync_processor.py` in jira-backend). Keep this in mind when touching sync-related code — it must work correctly in both roles.
- **Roles**: `ADMIN`, `SHORE`, `VESSEL`, enforced both in backend route dependencies and in the frontend's `ProtectedRoute allowedRoles={[...]}`.
- **User roles/permissions model**: authoritative source is `workplace-backend/app/models/control/user.py` — read it before changing any role/permission-gated behavior anywhere in the stack.

### Known inconsistencies (verify before relying on them)

- **Aepms-backend has no `app/main.py`.** `docker-compose.yml` runs `uvicorn app.main:app`, but the actual FastAPI app lives in `app/api.py`. The real, working entrypoint is `app.api:app`. Treat the docker-compose command as stale until confirmed otherwise.
- `workplace-backend/alembic_drs.ini` is an empty file — dead scaffolding, not an active migration path. Drs-backend's own migrations live entirely in `Drs-backend/alembic/`.
- `Drs-backend/package.json` (root) only lists `@dnd-kit/*` deps with no scripts — it's not a real Node component; Drs-backend is pure Python/FastAPI.
- `jira-backend` has both a Postgres path (`db/database.py`) and a MongoDB driver/client (`db/mongodb.py`, `motor`/`pymongo`) alongside `migrate_mongo_to_pg.py` — this service was migrated off Mongo to Postgres; the Mongo path is likely legacy. Confirm before adding new Mongo-dependent code.
- Backend `requirements.txt` files may be saved as UTF-16 (garbled if read as UTF-8/ASCII). If editing one and it looks like `f a s t a p i = = ...`, re-save as UTF-8, don't hand-edit the raw bytes.
- `Drs-backend/alembic.ini` and `workplace-backend/seed_admin.py` contain what look like real/default credentials committed to the repo. Do not copy these patterns into new code; flag if asked to touch these files.
- `taskmgmt-backend` has no `docker-compose.yml` or Docker support at all, unlike Aepms-backend.
- `taskmgmt-backend/alembic.ini` ships a placeholder `sqlalchemy.url = driver://user:pass@localhost/taskmgmt_db` — the real URL comes from `TASKMGMT_DATABASE_URL` in `.env` via `app/config.py`, not from this file directly.

## Commands

### Frontend — `workplace-app`

```bash
npm run dev       # vite dev server
npm run build      # vite build
npm run lint        # eslint .
npm run preview      # preview production build
```

Path aliases (`vite.config.js`): `@` → `src`, `@drs` → `src/modules/drs`.

### Backends (FastAPI, run from the service's own directory)

```bash
# workplace-backend, Drs-backend, Aepms-backend*, lub_backend*: package-qualified entrypoint
uvicorn app.main:app --reload   # workplace-backend, Drs-backend
uvicorn app.api:app --reload    # Aepms-backend, lub_backend, taskmgmt-backend (no app/main.py — see above; taskmgmt-backend defaults to port 8005)

# jira-backend: unqualified imports, must run from inside jira-backend/
uvicorn main:app --reload
```

Each backend has its own `requirements.txt` and (typically) its own virtualenv — there is no shared Python environment across services. Install/activate per-service before running. `taskmgmt-backend/scraper_worker` is a further, separate Python environment (own `requirements.txt`/`venv`, Playwright-based) run standalone, not through uvicorn.

Alembic migrations are per-service and must be run from that service's directory, e.g.:
```bash
alembic upgrade head                       # Drs-backend, jira-backend, Aepms-backend, lub_backend, taskmgmt-backend
alembic -c alembic_control.ini upgrade head  # workplace-backend (control DB only — alembic_drs.ini is unused/empty)
```

Aepms-backend also has `docker-compose.yml` (Postgres/TimescaleDB + backend); no other service has Docker support.

## Frontend structure (`workplace-app/src`)

- `App.jsx` — route table; one lazy-loaded module tree per backend under `modules/` (`modules/drs`, `modules/aepms`, `modules/jira`, `modules/lubeoil`, `modules/taskmgmt`). A commented-out `/voyage` route + `modules/voyage` reference indicates a planned-but-unbuilt module. `/taskmgmt/*` is `ADMIN`-only, unlike most other module routes which also allow `SHORE`/`VESSEL`.
- `api/axios.js` — shared axios instance, baseURL `/api/v1`, JWT bearer read from `localStorage`/`sessionStorage` key `platform_token`, auto-logout interceptor on 401/403.
- `context/AuthContext.jsx` — auth/session state.
- `components/auth/ProtectedRoute` — role-gated route wrapper (`allowedRoles`).
- Data/UI stack: TanStack Query (server state), `idb` (IndexedDB, for the same offline/vessel-mode support as the backends), `recharts` (charts), `@dnd-kit/*` (drag-and-drop, e.g. Kanban boards), `jspdf`/`html2canvas` (client-side PDF export).

## Custom skills in this repo

`.claude/skills/` (not git-tracked — `.claude` is in `.gitignore`) defines project-specific conventions:
- `code-reviewer` — React/FastAPI review checklist and linters (`scripts/lint_frontend.sh`, `scripts/lint_backend.sh`); loads `references/react-standards.md` / `references/fastapi-standards.md` depending on file type.
- `git-helper` — commit message format is Conventional Commits scoped to this project: `<type>(<scope>): <summary>` with scopes `frontend`, `backend`, `api`, `auth`, `db`, `config`, `deps`. Suggests splitting a commit into two when a change spans both frontend and backend.
