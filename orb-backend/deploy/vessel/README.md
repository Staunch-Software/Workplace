# ORB offline sync: runbook

One codebase; `STORAGE_MODE` decides the role.

| | VM (shore) | Vessel (`C:\WORKPLACE\orb_backend`) |
|---|---|---|
| `STORAGE_MODE` | `online` (default) | `offline` |
| Extraction / uploads / alert checks | yes | no (403, `shore_instance_only`) |
| Sync | serves `/api/sync/*` (needs `SYNC_API_KEY`) | worker pushes outbox, then pulls, every `SYNC_INTERVAL_SECONDS` |
| Needs | `alembic upgrade head` | `alembic upgrade head`, Azurite, `CLOUD_STORAGE_CONNECTION_STRING` |

## Where the vessel copy lives
`C:\WORKPLACE\orb_backend` (code copy, `.env`, `run_migrations.py`) runs as service `WP_ORB_Backend` on port 8007 with the
bundled `C:\WORKPLACE\bin\python` (Python 3.10, every dependency already present). `C:\WORKPLACE\setup\install_workplace.bat`
creates the `workplace_orb` database, runs the migrations and registers the service; nginx routes `/orb/` to it.
To ship a newer ORB: copy `app/` and `alembic/` over `orb_backend`, then run `setup\update_orb_backend.bat`.

## Roll-out order
1. VM: `alembic upgrade head` (adds 017: outbox tables, `updated_at` columns, triggers), set `SYNC_API_KEY`, restart.
2. Vessel: install as usual with `install_workplace.bat` (it now includes ORB), or on a running vessel copy the new `orb_backend`, run `update_orb_backend.bat` and restart nginx for the `/orb/` route.
3. First start pulls everything for that vessel only; watch `C:\WORKPLACE\logs\orb_backend.log`.

## What is synced
- VM to vessel: vessel, tanks, uploads, entries, quantities, alerts, public chat (incl. system lines), attachments, notifications and feed of the vessel's own users. Original PDFs, tank documents and chat files are copied into local Azurite.
- Vessel to VM: chat messages and files, alert resolution requests (as commands), read marks (chat, notifications, feed).
- Never synced: raw extraction (`orb_upload_raw`), `fuel_consumption`, internal shore notes, shore-only feed events.

## Rules worth knowing
- A vessel's resolution request is applied on the VM only if the alert is still OPEN there; otherwise it is logged in `orb_sync_conflicts` (VM) and the vessel pulls the VM's state. Shore actions always win.
- Notifications are created by the VM when a vessel's message or request arrives, so vessel users see replies after the next sync, not while offline.
- Edits and deletes made directly in pgAdmin on the VM sync too (database triggers keep `updated_at` and delete markers).
- Failed items (`sync_queue.status='FAILED'`) show in the Vessel Status page through the heartbeat; set a failed row back to `PENDING` to retry it.

## Time: UTC for sync, IST on screen
- Everything stored and synced is UTC. A vessel PC's clock or time zone is never trusted: every sync cycle the vessel asks the VM
  (`/health` returns `server_time`) and measures how far its own clock is off (`clock_offset_seconds` in the heartbeat). That offset is
  kept in `sync_clock` and applied by `orb_utc_now()` (database defaults, triggers) and `utc_now()` (Python), so messages, read marks
  and resolution requests carry corrected UTC even when the PC is hours out. After a restart the last measured offset is reused while offline.
- Pull cursors use the VM's clock only. Retry timers ignore a retry time that is more than 2 h away (a clock that jumped).
- The VM refuses a vessel time that is in the future (it stamps the VM's time instead).
- The ORB screens show IST (Asia/Kolkata) whatever the PC's zone is, and "5m ago" / "days open" use the server's time (`/api/time`),
  not the browser's. Rebuild and redeploy the frontend for this.
- Limit: a vessel that has never reached the VM since its clock went wrong has no offset yet; its first messages carry the PC time
  until the first sync, except that future times are corrected by the VM.
