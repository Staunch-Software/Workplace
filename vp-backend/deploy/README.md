# Vessel Performance: deployment (shore VM)

Vessel Performance is a workplace module like ORB: the dashboard lives in `workplace-app/src/modules/vp`
(opens at `/vp`), this folder is the API and the data pipeline (scrapers, schedulers, calculators).
Users, roles and the `vessel_performance` permission come from the workplace control database.

| Part | Where |
|---|---|
| API (FastAPI, 1 worker) | systemd `workplace-vp`, `127.0.0.1:8009`, nginx `/vp/api/` -> `/api/` |
| Dashboard | the workplace-app build, `/vp` (and `/vp-render` for the PDF renderer) |
| Pipeline | cron lines in `scripts/CRON_SETUP.md` + two background jobs inside the API process |
| Database | the existing Vessel Performance database (unchanged name and data) |

Port 8009 is the default here; check it is free on the VM (`ss -ltn | grep 8009`) and change it in the unit,
nginx and `workplace-app/src/modules/vp/api/vesselApi.js` (dev URL only) if it is not.

## 1. Before touching production

1. `pg_dump` the Vessel Performance database and keep the file.
2. Restore the dump into a scratch database and run steps 3 to 6 against it first
   (set `DB_NAME` in a scratch `.env`). Review the output of both scripts in step 6 with the owners of the
   accounts they list.
3. Rotate the Wartsila password: an earlier copy of the code carried it in plain text.

## 2. Install

```bash
cd /opt/workplace/Workplace && git pull
cd vp-backend
python3 -m venv venv && venv/bin/pip install -r requirements.txt
venv/bin/playwright install chromium            # scrapers and the voyage PDF renderer
cp .env.example .env                            # then fill it in (next section)
```

Copy by hand the session state that is not in git, from the old install:
`backend/mariapps_pipeline/auth.json` and the `.wartsila_session/` folder.

## 3. Read-only login access to the control database

Run once on the control database as an admin (use a real password):

```sql
CREATE ROLE vp_ctl_ro LOGIN PASSWORD '<password>';
GRANT CONNECT ON DATABASE workplace_control TO vp_ctl_ro;
GRANT USAGE ON SCHEMA public TO vp_ctl_ro;
GRANT SELECT (id, full_name, email, role, is_active, permissions) ON users TO vp_ctl_ro;
GRANT SELECT (imo, name) ON vessels TO vp_ctl_ro;      -- only for scripts/check_vessel_links.py
```

`.env` (see `.env.example` for everything): `DB_*` as in the old install, `CONTROL_DATABASE_URL` for
`vp_ctl_ro`, `SECRET_KEY` = the same value as the workplace backend, `CORS_ORIGINS` = the workplace address,
and the scraper and mail credentials. For the parallel run keep both schedulers off:

```
FLEET_STATUS_INTERVAL_MINUTES=0
EMAIL_SCRAPER_INTERVAL_MINUTES=0
```

## 4. Service and nginx

`/etc/systemd/system/workplace-vp.service` (same user and style as `workplace-orb`):

```ini
[Unit]
Description=Workplace Vessel Performance API
After=network.target postgresql.service

[Service]
WorkingDirectory=/opt/workplace/Workplace/vp-backend
ExecStart=/opt/workplace/Workplace/vp-backend/venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8009 --workers 1
Restart=always

[Install]
WantedBy=multi-user.target
```

Keep **one worker**: the in-process jobs pick their leader by binding loopback ports 65432 to 65434.

nginx, next to the ORB block (the workplace-app build already answers `/vp` and `/vp-render` through its SPA
fallback):

```nginx
location /vp/api/ {
    proxy_pass http://127.0.0.1:8009/api/;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 300s;        # ISO 19030 runs and large exports
    client_max_body_size 50m;       # Excel uploads
}
```

Rebuild and publish the workplace-app (`npm install && npm run build`), then
`sudo systemctl daemon-reload && sudo systemctl enable --now workplace-vp`.

On first start the API adds two columns (`user_column_preferences.user_uuid`, `data_quality_threads.author_uuid`)
and relaxes one NOT NULL. Nothing is dropped or rewritten; the old app keeps working next to it.

## 5. Grant access

In the workplace admin, give each person who used the old dashboard a **SHORE** (or ADMIN) account with the
**Vessel Performance** permission. People who need to change column defaults or the column configuration must
be ADMIN.

## 6. Keep the old users' data (column layouts, discussion posts)

Both scripts run from `vp-backend/` and change nothing unless told to.

```bash
venv/bin/python scripts/check_vessel_links.py          # vessels by IMO: Vessel Performance vs workplace
venv/bin/python scripts/backfill_user_uuids.py         # dry run: who matches whom (by email), row counts
venv/bin/python scripts/backfill_user_uuids.py --apply # link the matched users' rows
```

Users the dry run lists as not matched: create their workplace account (step 5) and run it again. Their
rows are never deleted or reassigned. A shared old login (for example `admin`) can be given to a named person
with `--map admin=person@ozellar.com`; discussion posts keep the author's name as text, so a user who only
wrote posts does not need an account for them to stay visible. The old integer columns and the old `users` table stay as they are.

## 6b. AMNS vessel IMOs (at cutover, not before)

AMNS POLAR, AMNSI MAXIMUS and AMNSI STALLION carry different IMOs here (9961609, 9942768, 9942770) than in the
workplace (9521813, 9628893, 9628910), so they cannot be linked and ORB finds no pipeline data for them.
`scripts/correct_amns_imos.py` moves this database to the workplace numbers in one transaction, across every
column named `vessel_imo` / `imo` (including tables without a foreign key). The Wartsila scraper in this folder
already uses the workplace numbers; the old install's scraper still writes the old ones, so run it only when
the old API and the old cron jobs are stopped:

```bash
venv/bin/python scripts/correct_amns_imos.py           # dry run, per table
venv/bin/python scripts/correct_amns_imos.py --apply
venv/bin/python scripts/check_vessel_links.py          # all 15 vessels should match
```

## 7. Parallel run, then cutover

1. Leave every cron line and the old API on the old path. Open `/vp` and compare with the old dashboard.
2. Cutover, in this order: stop the old API service (`vessel-api`); change the four cron lines to
   `/opt/workplace/Workplace/vp-backend/scripts/...` (`scripts/CRON_SETUP.md`); set both scheduler variables
   in `.env` back to `30` and `15` and restart `workplace-vp`; run `backfill_user_uuids.py --apply` once more;
   run `scripts/correct_amns_imos.py` (step 6b); point the old address at `/vp`.
3. After a normal cron cycle check `logs/*_cron.log`, the Fleet Status page and one voyage-completion mail.
4. Keep the old install stopped but intact for a week. Then the old `users` table and the legacy
   `user_column_preferences.user_id` / `data_quality_threads.author_user_id` columns can be dropped.

Rollback before step 4: stop `workplace-vp`, start the old API, restore the old cron lines.

ORB is not affected: its `PERFORMANCE_DATABASE_URL` keeps pointing at the same database.

## Tests

```bash
cd vp-backend && venv/bin/python -m pytest tests
```

`test_auth.py` needs no data. `test_backfill.py` and `test_user_writes.py` write throwaway rows to the
database in `.env` and remove them; run them against a scratch copy, not production.
