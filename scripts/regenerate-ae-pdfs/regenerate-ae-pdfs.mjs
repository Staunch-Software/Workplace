#!/usr/bin/env node
/**
 * Regenerate AE analytical PDFs so each AE report gets its own Azure blob.
 *
 * WHY A BROWSER: the analytical PDF is rendered by jsPDF/html2canvas inside the
 * React page (UnifiedPerformance.jsx -> downloadPDF("cloud")). It cannot be built
 * server-side, so this script drives the real app with Playwright.
 *
 * HOW IT WORKS
 *   1. It logs in through the app's own login form. The username/password are asked
 *      at start-up (password typed hidden) and kept in memory only - never written
 *      to a file, a log or the shell history. Env vars AEPMS_USER / AEPMS_PASS are an
 *      optional shortcut. Use --manual-login to log in by hand instead (SSO / MFA).
 *   2. For every vessel/AE it asks the API which AE reports still point at the OLD
 *      shared path (aux_engine/analytical/<imo>/<month>/) instead of the new
 *      per-generator path (aux_engine/analytical/<imo>/<generator_id>/<month>/).
 *   3. For each such report it opens a FRESH page, selects vessel -> AE -> unit ->
 *      that ONE report -> ANALYZE. The /aux/history response is rewritten in the
 *      browser only (pdf_missing=true for that one report) so the app's own
 *      "build missing PDF" effect fires and uploads the PDF.
 *   4. It checks the upload request carried the right report_id and returned 200,
 *      then re-reads the report from the API and confirms the new path.
 *   5. Work is done in BATCHES (--batch-size, default 50). Between batches it
 *      re-checks the login (and logs in again if the token expired) and stops early
 *      if a batch has too many failures (--max-failures, default 5).
 *
 * SAFETY
 *   - DRY RUN is the default: it only reads from the API and prints the plan.
 *   - Nothing is deleted or nulled by this script. The backend's existing cleanup
 *     removes the replaced blob itself.
 *   - Only AE reports are touched. One report at a time. Idempotent: reports that
 *     already have the new path are skipped, so re-running is safe.
 *
 * Usage: see README.md
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

// ───────────────────────── CLI ─────────────────────────
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d = undefined) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
};

const BASE_URL = (opt("base-url", "http://localhost:5173")).replace(/\/$/, "");
// Must match the frontend's API base (VITE_API_BASE_URL). Dev default: localhost:8005,
// production default: "/aepms/api" on the same origin.
const API_BASE = (opt("api-base") ||
  (BASE_URL.includes("localhost") ? "http://localhost:8005" : `${BASE_URL}/aepms/api`)
).replace(/\/$/, "");
const EXECUTE = flag("execute");
const ONLY_IMO = opt("imo");
const ONLY_GEN = opt("generator-id");
const ONLY_REPORT = opt("report-id");
const MAX = parseInt(opt("max", "0"), 10) || Infinity;
const RETRIES = parseInt(opt("retries", "2"), 10);
const PROFILE = path.resolve(opt("profile", "./.browser-profile"));
// Console only by default. A log file is written ONLY if you pass --log <file>.
const LOG_FILE = opt("log") ? path.resolve(opt("log")) : null;
const HEADLESS = flag("headless");
const MANUAL_LOGIN = flag("manual-login"); // log in by hand in the browser (SSO / MFA accounts)
const BATCH_SIZE = Math.max(1, parseInt(opt("batch-size", "50"), 10) || 50);
const MAX_FAILURES = parseInt(opt("max-failures", "5"), 10); // stop the run if one batch fails this many
const BATCH_PAUSE_MS = (parseInt(opt("pause", "5"), 10) || 0) * 1000;
const COCKPIT = `${BASE_URL}/aepms/performance-cockpit`;
// The page itself asks /aux/history for only 24 reports per generator, so older ones
// never reach its dropdown. Both discovery and the in-browser request (see the route
// handler in regenerateOne) use this larger limit so EVERY AE report is reachable.
const UI_LIST_LIMIT = 1000;

// ───────────────────────── helpers ─────────────────────────
const log = (rec) => {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...rec });
  if (LOG_FILE) fs.appendFileSync(LOG_FILE, line + "\n");
  console.log(line);
};
const norm = (s) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Authenticated GET executed inside the page so it uses the logged-in token. */
async function apiGet(page, endpoint) {
  return page.evaluate(
    async ({ url }) => {
      const token =
        localStorage.getItem("app_token") ||
        localStorage.getItem("platform_token") ||
        sessionStorage.getItem("platform_token");
      const res = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      return res.json();
    },
    { url: `${API_BASE}${endpoint}` },
  );
}

/** Does this report's analytical PDF already live in its per-generator folder? */
function hasNewPath(detailsReport, imo, generatorId) {
  const url = detailsReport?.generated_report_view_url;
  if (!url) return false;
  let p = url;
  try {
    p = decodeURIComponent(new URL(url).pathname);
  } catch {
    /* keep raw */
  }
  return p.includes(`aux_engine/analytical/${imo}/${generatorId}/`);
}

// ───────────────────────── discovery (read-only) ─────────────────────────
async function discover(page) {
  const fleetRes = await apiGet(page, "/api/fleet/");
  const fleet = fleetRes.fleet || fleetRes || [];
  const plan = [];

  for (const ship of fleet) {
    const imo = String(ship.imo || ship.imo_number || ship.id);
    if (ONLY_IMO && imo !== String(ONLY_IMO)) continue;

    let gens = [];
    try {
      gens = await apiGet(page, `/aux/generators/${imo}`);
    } catch (e) {
      log({ level: "warn", msg: "generators fetch failed", imo, error: String(e) });
      continue;
    }

    for (const gen of gens) {
      if (ONLY_GEN && String(gen.generator_id) !== String(ONLY_GEN)) continue;

      let list = [];
      try {
        const q = new URLSearchParams({
          imo_number: imo,
          limit: String(UI_LIST_LIMIT),
          generator_id: String(gen.generator_id),
        });
        const hist = await apiGet(page, `/aux/history?${q}`);
        list = hist.monthly_performance_list || [];
      } catch (e) {
        log({ level: "warn", msg: "history fetch failed", imo, gen: gen.generator_id, error: String(e) });
        continue;
      }

      for (const r of list) {
        if (ONLY_REPORT && String(r.report_id) !== String(ONLY_REPORT)) continue;
        let details;
        try {
          details = (await apiGet(page, `/api/v1/fleet/ae-report-details/${r.report_id}`)).report;
        } catch (e) {
          log({ level: "warn", msg: "details fetch failed", report_id: r.report_id, error: String(e) });
          continue;
        }
        // Reports whose PDF is missing/stale are rebuilt by the app on view anyway,
        // but we still drive them here so the result is verified.
        const needs = !hasNewPath(details, imo, gen.generator_id);

        // Position of this report inside its year group in the dropdown
        // (same order as the API list; grouped by report_date year).
        const year = String(r.report_date || "").substring(0, 4) || "Unknown";
        const sameYear = list.filter(
          (x) => (String(x.report_date || "").substring(0, 4) || "Unknown") === year,
        );
        plan.push({
          imo,
          shipName: ship.name,
          generator_id: gen.generator_id,
          designation: gen.designation,
          report_id: r.report_id,
          report_month: r.report_month,
          year,
          indexInYear: sameYear.findIndex((x) => x.report_id === r.report_id),
          needs,
        });
      }
    }
  }
  return plan;
}

// ───────────────────────── UI driving ─────────────────────────
async function pickSingleSelect(page, fieldSelector, matcher, what) {
  const field = page.locator(fieldSelector);
  await field.locator("label + div").first().click();
  // Options render after the trigger inside the same field.
  const candidates = field.locator("div[style*='cursor: pointer']");
  await candidates.first().waitFor({ timeout: 15000 });
  const texts = await candidates.allInnerTexts();
  const idx = texts.findIndex((t) => matcher(t.trim()));
  if (idx < 0) throw new Error(`${what}: no option matched. Options: ${JSON.stringify(texts)}`);
  await candidates.nth(idx).click();
}

async function regenerateOne(context, item) {
  const page = await context.newPage();
  try {
    // Make the app treat ONLY this report as "PDF missing" (browser-side only).
    await page.route("**/aux/history*", async (route) => {
      // Browser-side only: ask for all reports instead of the page's default 24.
      const u = new URL(route.request().url());
      u.searchParams.set("limit", String(UI_LIST_LIMIT));
      const resp = await route.fetch({ url: u.toString() });
      let body;
      try {
        body = await resp.json();
      } catch {
        return route.fulfill({ response: resp });
      }
      if (Array.isArray(body.monthly_performance_list)) {
        for (const r of body.monthly_performance_list) {
          if (r.report_id === item.report_id) {
            r.pdf_missing = true;
            r.pdf_stale = false;
          }
        }
      }
      return route.fulfill({ response: resp, json: body });
    });

    await page.goto(COCKPIT, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".perf-control-bar", { timeout: 60000 });

    // 1. Vessel
    const wantShip = norm(item.shipName);
    await pickSingleSelect(
      page,
      ".perf-vessel-field",
      (t) => {
        const n = norm(t);
        return n === wantShip || n.includes(wantShip) || wantShip.includes(n);
      },
      "vessel",
    );

    // 2. AE mode
    await page.locator(".perf-engine-btn", { hasText: /^AE$/ }).click();

    // 3. Unit (generator) — the app may auto-select the first one
    await page.waitForSelector(".perf-unit-field", { timeout: 15000 });
    await sleep(1500);
    const unitTrigger = (await page.locator(".perf-unit-field label + div").first().innerText()).trim();
    if (norm(unitTrigger) !== norm(item.designation)) {
      await pickSingleSelect(
        page,
        ".perf-unit-field",
        (t) => norm(t) === norm(item.designation),
        "unit",
      );
    }

    // 4. Wait for the report list to load
    const reportsField = page.locator(".perf-select-reports-field");
    await page.waitForFunction(
      () => {
        const el = document.querySelector(".perf-select-reports-field");
        return el && /Select Reports/.test(el.innerText);
      },
      null,
      { timeout: 60000 },
    );
    await sleep(800);

    // 5. Select exactly ONE report: year tab -> n-th row in that year
    await reportsField.locator("label + div").first().click();
    await page.getByText(item.year, { exact: true }).last().click();
    const rows = reportsField.locator("input[type=checkbox]");
    await rows.first().waitFor({ timeout: 10000 });
    if (item.indexInYear < 0 || item.indexInYear >= (await rows.count())) {
      throw new Error(`report row index ${item.indexInYear} not in dropdown (list limited to ${UI_LIST_LIMIT})`);
    }
    await rows.nth(item.indexInYear).click();
    await page.keyboard.press("Escape");

    // 6. ANALYZE and wait for the app's own PDF upload
    const uploadWait = page.waitForResponse(
      (r) => r.url().includes("/api/reports/upload-generated") && r.request().method() === "POST",
      { timeout: 240000 },
    );
    await page.locator(".perf-analyze-btn").click();
    const upload = await uploadWait;

    const posted = upload.request().postData() || "";
    const m = posted.match(/name="report_id"\r?\n\r?\n(\d+)/);
    const postedId = m ? Number(m[1]) : null;
    const postedType = (posted.match(/name="report_type"\r?\n\r?\n([^\r\n]+)/) || [])[1];
    if (upload.status() !== 200) throw new Error(`upload returned HTTP ${upload.status()}`);
    if (postedId !== item.report_id) throw new Error(`uploaded report_id ${postedId} != expected ${item.report_id}`);
    if (postedType !== "auxiliaryEngine") throw new Error(`unexpected report_type ${postedType}`);

    // 7. Verify through the API
    const details = (await apiGet(page, `/api/v1/fleet/ae-report-details/${item.report_id}`)).report;
    if (!hasNewPath(details, item.imo, item.generator_id)) {
      throw new Error("after upload the report still does not point at the per-generator path");
    }
    return true;
  } finally {
    await page.close().catch(() => {});
  }
}

// ───────────────────────── login ─────────────────────────
function askVisible(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (a) => {
      rl.close();
      resolve(a.trim());
    });
  });
}

/** Password prompt: characters are not echoed. Kept in memory only. */
function askHidden(question) {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    let s = "";
    if (stdin.setRawMode) stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          if (stdin.setRawMode) stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener("data", onData);
          process.stdout.write("\n");
          return resolve(s);
        }
        if (ch === "\u0003") process.exit(130); // Ctrl+C
        if (ch === "\u007f" || ch === "\b") s = s.slice(0, -1);
        else s += ch;
      }
    };
    stdin.on("data", onData);
  });
}

let CREDS = null; // { user, pass } - memory only

async function getCredentials() {
  if (CREDS) return CREDS;
  const user = process.env.AEPMS_USER || (await askVisible("App username (email): "));
  const pass = process.env.AEPMS_PASS || (await askHidden("App password (hidden): "));
  if (!user || !pass) throw new Error("username and password are required");
  CREDS = { user, pass };
  return CREDS;
}

const hasToken = (page) =>
  page.evaluate(
    () => !!(localStorage.getItem("app_token") || localStorage.getItem("platform_token") || sessionStorage.getItem("platform_token")),
  );

/** Keep the login in localStorage so the fresh page opened per report stays logged in. */
const persistToken = (page) =>
  page.evaluate(() => {
    for (const k of ["platform_token", "platform_user"]) {
      const v = sessionStorage.getItem(k);
      if (v && !localStorage.getItem(k)) localStorage.setItem(k, v);
    }
  });

/** One login attempt (no retry loop, so a wrong password cannot lock the account). */
async function doLogin(page) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });

  if (MANUAL_LOGIN) {
    console.log("\nLog in to the app in the opened browser window. Waiting up to 10 minutes...");
    await page.waitForFunction(
      () => !!(localStorage.getItem("app_token") || localStorage.getItem("platform_token") || sessionStorage.getItem("platform_token")),
      null,
      { timeout: 600000 },
    );
    await persistToken(page);
    return;
  }

  if (await hasToken(page)) {
    await persistToken(page);
    return; // the profile still holds a login; ensureLoggedIn() verifies it works
  }

  const { user, pass } = await getCredentials();
  await page.waitForSelector("#username", { timeout: 30000 });
  await page.fill("#username", user);
  await page.fill("#password", pass);
  const remember = page.locator("form input[type=checkbox]").first();
  if (await remember.count()) await remember.check().catch(() => {});
  await page.locator("button.submit-btn").click();
  try {
    await page.waitForFunction(
      () => !!(localStorage.getItem("platform_token") || sessionStorage.getItem("platform_token")),
      null,
      { timeout: 30000 },
    );
  } catch {
    throw new Error("Login failed (wrong credentials, or the account uses SSO/MFA - try --manual-login)");
  }
  await persistToken(page);
}

/** Make sure the API accepts our token; log in (again) if not. */
async function ensureLoggedIn(page) {
  try {
    await page.goto(COCKPIT, { waitUntil: "domcontentloaded" });
    await apiGet(page, "/api/fleet/");
    return;
  } catch {
    /* not logged in or token expired */
  }
  // Drop a stale token so the login form is shown, then log in once.
  await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    for (const k of ["app_token", "platform_token", "platform_user"]) {
      localStorage.removeItem(k);
      sessionStorage.removeItem(k);
    }
  });
  await doLogin(page);
  await page.goto(COCKPIT, { waitUntil: "domcontentloaded" });
  await apiGet(page, "/api/fleet/"); // throws if the token still does not work
}

// ───────────────────────── main ─────────────────────────
(async () => {
  fs.mkdirSync(PROFILE, { recursive: true });
  const context = await chromium.launchPersistentContext(PROFILE, {
    headless: HEADLESS,
    ...(opt("channel") ? { channel: opt("channel") } : {}), // e.g. msedge / chrome (installed browser)
    viewport: { width: 1600, height: 1000 },
  });
  const page = context.pages()[0] || (await context.newPage());

  await ensureLoggedIn(page);

  console.log(`\nMode: ${EXECUTE ? "EXECUTE (will regenerate PDFs)" : "DRY RUN (read-only)"}`);
  console.log(`App: ${BASE_URL}   API: ${API_BASE}   Log file: ${LOG_FILE || "none (console only)"}\n`);

  const plan = await discover(page);
  const todo = plan.filter((p) => p.needs).slice(0, MAX);
  const batches = [];
  for (let i = 0; i < todo.length; i += BATCH_SIZE) batches.push(todo.slice(i, i + BATCH_SIZE));
  log({
    level: "info",
    msg: "plan",
    total_ae_reports: plan.length,
    need_regeneration: plan.filter((p) => p.needs).length,
    already_ok: plan.filter((p) => !p.needs).length,
    this_run: todo.length,
    batch_size: BATCH_SIZE,
    batches: batches.length,
  });
  for (const p of todo) {
    console.log(`  - ${p.shipName} | ${p.designation} (gen ${p.generator_id}) | ${p.report_month} | report ${p.report_id}`);
  }

  if (!EXECUTE) {
    console.log("\nDRY RUN complete. Nothing was changed. Re-run with --execute to regenerate.");
    await context.close();
    return;
  }

  // Per-vessel totals for this run, used to report when a vessel is finished.
  const vessels = new Map();
  for (const p of todo) {
    if (!vessels.has(p.imo)) vessels.set(p.imo, { total: 0, done: 0, ok: 0 });
    vessels.get(p.imo).total++;
  }

  let ok = 0;
  let done = 0;
  const failed = [];
  let stoppedEarly = false;

  for (const [b, batch] of batches.entries()) {
    // Token may have expired during a long run: verify before every batch.
    await ensureLoggedIn(page);
    log({ level: "info", msg: "batch start", batch: `${b + 1}/${batches.length}`, size: batch.length });

    let batchOk = 0;
    let batchFailed = 0;
    for (const item of batch) {
      done++;
      let success = false;
      for (let attempt = 1; attempt <= RETRIES + 1 && !success; attempt++) {
        try {
          await regenerateOne(context, item);
          log({ level: "info", status: "ok", n: `${done}/${todo.length}`, attempt, ...item });
          success = true;
        } catch (e) {
          log({ level: "error", status: "failed", n: `${done}/${todo.length}`, attempt, ...item, error: String(e.message || e) });
          await sleep(3000);
        }
      }
      if (success) {
        batchOk++;
        ok++;
      } else {
        batchFailed++;
        failed.push(item);
      }

      // Per-vessel progress: announce when every report of a vessel has been handled.
      const v = vessels.get(item.imo);
      v.done++;
      if (success) v.ok++;
      if (v.done === v.total) {
        console.log(
          `\n>>> Vessel ${item.shipName} completed: all ${v.total} AE reports processed ` +
            `(${v.ok} regenerated successfully, ${v.total - v.ok} failed) <<<\n`,
        );
      }
      await sleep(1500); // be gentle with backend + Azure
    }

    log({ level: "info", msg: "batch done", batch: `${b + 1}/${batches.length}`, ok: batchOk, failed: batchFailed });
    console.log(
      `\n=== Batch ${b + 1}/${batches.length} completed: ${batchOk} regenerated successfully, ${batchFailed} failed ` +
        `| Overall: ${ok} succeeded, ${failed.length} failed, ${todo.length - done} remaining ===\n`,
    );
    if (batchFailed >= MAX_FAILURES) {
      console.log(`\nStopping: batch ${b + 1} had ${batchFailed} failures (limit --max-failures ${MAX_FAILURES}). Fix the cause, then re-run: finished reports are skipped.`);
      stoppedEarly = true;
      break;
    }
    if (b < batches.length - 1 && BATCH_PAUSE_MS) await sleep(BATCH_PAUSE_MS);
  }

  log({ level: "info", msg: "finished", ok, failed: failed.length, stopped_early: stoppedEarly, remaining_not_attempted: todo.length - done });
  if (failed.length) {
    console.log("\nFailed reports (re-run to retry them, finished ones are skipped):");
    failed.forEach((f) => console.log(`  report ${f.report_id} (${f.shipName} ${f.designation} ${f.report_month})`));
  }
  await context.close();
  process.exit(failed.length || stoppedEarly ? 1 : 0);
})().catch((e) => {
  console.error("Fatal:", e.message || e);
  process.exit(1);
});
