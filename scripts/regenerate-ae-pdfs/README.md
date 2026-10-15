# Regenerate AE analytical PDFs

Rebuilds the analytical PDF of existing AE reports so each one is stored at its own
Azure path `aux_engine/analytical/<imo>/<generator_id>/<month>/`.
Run it **only after** the path fix is deployed to the environment you point it at.

## Before you run
1. Deploy the backend + frontend path fix.
2. Back up current URLs:
   `SELECT report_id, generator_id, report_month, generated_report_url FROM generator_monthly_report_header;`
3. Do not change `PDF_RULESET_VERSION` while the script runs.

## Setup (once)
```bash
cd scripts/regenerate-ae-pdfs
npm install
npx playwright install chromium
```
If the bundled Chromium does not start, use the installed Edge/Chrome with `--channel msedge`
(or `--channel chrome`).

## Run
The script runs on **your PC** and talks to the app at `--base-url`; nothing is installed on the server.

```bash
# smoke test: 20 reports
node regenerate-ae-pdfs.mjs --base-url https://<app-host> --max 20 --execute

# everything, in batches of 50 (default), logging in automatically
node regenerate-ae-pdfs.mjs --base-url https://<app-host> --execute
```

**Login:** at start-up it asks for the username and the password (typed hidden). They are kept
in memory only: not written to any file, log or shell history. It logs in through the app's own
login form, and logs in again before a batch if the token expired. Optional shortcut: set
`AEPMS_USER` / `AEPMS_PASS` in your terminal session. For SSO/MFA accounts use `--manual-login`.
Use an account that can see all vessels. The login is kept in `./.browser-profile`: delete that
folder when you are done.

**Batches:** the list of reports still on the old path is built once, then processed in batches
of `--batch-size` (default 50). Between batches it re-checks the login and pauses `--pause`
seconds (default 5). If one batch has `--max-failures` failures (default 5) or more, it stops so a
systematic problem does not run through every report. Re-running is always safe: reports that
already have the new path are skipped, so an interrupted or stopped run just continues.

Preview only (read-only, changes nothing):
```bash
node regenerate-ae-pdfs.mjs --base-url https://<app-host>
```

Options: `--base-url`, `--api-base` (default `<base-url>/aepms/api`, or `http://localhost:8005`
for localhost), `--batch-size`, `--max-failures`, `--pause`, `--max N` (total cap), `--imo`,
`--generator-id`, `--report-id`, `--retries N`, `--channel`, `--manual-login`, `--headless`, `--ignore-https-errors`,
`--profile DIR`, `--log FILE`.

## What it does / does not do
- Opens a fresh page per report, selects vessel -> AE -> unit -> that single report -> ANALYZE.
- Rewrites the `/aux/history` request/response **in the browser only** (limit raised from 24,
  that one report marked PDF-missing) so the app's own "PDF missing" effect builds and uploads
  the PDF. No app or backend code is changed.
- Verifies the upload (HTTP 200, correct `report_id`, `auxiliaryEngine`) and re-reads the report
  to confirm the new per-generator path.
- Never deletes or nulls anything itself. The backend removes the replaced blob.
- Prints progress and results to the console only. No log file is created unless you pass `--log FILE`.

## Known limits
- It relies on UI structure (`.perf-*` classes, `#username`, `#password`, `button.submit-btn`).
  If the pages change, adjust the selectors.
- Failed reports are listed at the end; re-run to retry them.
- Delete the generated logs and `.browser-profile` before committing.
