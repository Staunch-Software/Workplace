# app/scraper/smartpal_scraper.py
#
# SmartPAL PDF Report Scraper using Playwright.
#
# FLOW PER VESSEL PER REPORT:
#   1. Login to SmartPAL (Microsoft SSO bypass)
#   2. Navigate via Menu -> Maintenance -> Reports -> Job Overview (new tab)
#   3. Select vessel in the vessel dropdown
#   4. Search the equipment tree for the report code, click the node
#   5. Click Show button to populate the job grid
#   6. Click Equipment Name link -> opens Equipment Details tab
#   7. Equipment Details: Job Plan tab -> click Job Title link
#   8. In the same page: click Job History tab
#   9. Find first COMPLETED row, extract Job Order No, click its link -> new tab
#  10. In Job Order tab: click Attachments tab, download the PDF
#  11. Upload PDF to Azure Blob Storage, save record to DB

import asyncio
import logging
import os
from datetime import datetime
from uuid import uuid4

from playwright.async_api import async_playwright, TimeoutError as PlaywrightTimeout
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.blob_storage import upload_pdf_to_blob
from app.models.report import Report, ScrapeStatus, VerifyStatus, ReportConfig, ReportAttachment

logger = logging.getLogger("scraper")

# SmartPAL loads the Attachments tab's file list asynchronously after the
# tab click -- Knockout renders either the real row list or the genuine
# "No Attachments Found" empty state only once that call resolves. Waiting
# on this selector (instead of a fixed sleep) means we only ever read the
# DOM once one of those two states has actually appeared.
_ATTACHMENT_READY_SELECTOR = (
    "#Attachments .attachment-grid table tbody tr, "
    "#Attachments .no-attachment, "
    "#Attachments .k-grid tbody tr, "
    "#Attachments table.rgMasterTable tr.rgRow, "
    "#Attachments .rgMasterTable tr.rgRow"
)


async def _click_attachments_tab_and_wait(page, timeout: int = 15000):
    """Click the Attachments tab and wait for it to actually finish loading.

    Replaces the old fixed `wait_for_timeout(3000)` pattern, which raced
    SmartPAL's async attachment-list fetch: on a slow response the scraper
    would read the DOM before either the file list or the empty state had
    rendered, silently recording 0 attachments on jobs that genuinely had
    files attached.
    """
    await page.evaluate('''() => {
        const tab = document.querySelector('a[href="#Attachments"]');
        if (tab) tab.click();
        else {
            const links = Array.from(document.querySelectorAll("a, span, div"));
            const fallback = links.find(el => el.innerText && (el.innerText.includes("Attachments") || el.innerText.includes("Files") || el.innerText.includes("Documents")));
            if (fallback) fallback.click();
        }
    }''')
    try:
        await page.wait_for_selector(_ATTACHMENT_READY_SELECTOR, timeout=timeout)
        await page.wait_for_timeout(800)  # let Knockout finish re-rendering before we start reading
    except PlaywrightTimeout:
        logger.warning(f"Attachments panel did not signal ready within {timeout}ms -- proceeding anyway (may miss attachments).")
        await page.wait_for_timeout(1500)


# A long-running scrape reusing one login/tab the whole way through was
# observed to degrade abruptly rather than gradually, on TWO separate real
# runs, at TWO DIFFERENT report counts:
#   - a 38-report attachment backfill: 100% success through report 15,
#     100% failure (equipment search) from report 16 onward.
#   - a fresh vessel's --full scrape: 100% success through report 6,
#     then a few reports failing at Job History before collapsing into
#     100% equipment-search failure from report 13 onward.
# The cutover is NOT a fixed report count or a fixed duration -- it moved
# from ~16 to ~7 between two runs, presumably depending on MariApps' own
# session/server load at the time. That means there is no safe fixed
# threshold to sit just under; the margin has to assume the WORST case
# seen so far, not the average. Refreshing the entire browser session (new
# context, fresh login, fresh Job Overview tab) this often keeps a long
# run comfortably under even the earliest cutover observed so far (~6-7).
# If a future run collapses again before hitting a multiple of this
# number, lower it further -- the pattern is empirical, not derived from
# a known timeout value.
SESSION_REFRESH_EVERY = 5


async def _fresh_session(browser):
    """New browser context + fresh login + fresh Job Overview tab. Returns
    (context, page, overview_page) or None if login/navigation fails."""
    context = await browser.new_context(accept_downloads=True, ignore_https_errors=True)
    context.set_default_timeout(60000)
    page = await context.new_page()

    if not await _login(page):
        try:
            await context.close()
        except Exception:
            pass
        return None

    overview_page = await _open_job_overview(context, page)
    if not overview_page:
        try:
            await context.close()
        except Exception:
            pass
        return None

    return context, page, overview_page


# ---------------------------------------------------------------------------
# Main Scraper Entry Point
# ---------------------------------------------------------------------------

async def run_scraper(db: AsyncSession, target_frequency: str = None, target_reports: str = None, target_vessel: str = None, smart_cron: bool = False):
    logger.info("--- REPORT TRACKER BACKEND STARTING (SHORE MODE) ---")
    
    stmt = select(ReportConfig)
    if target_frequency:
        stmt = stmt.where(ReportConfig.frequency.ilike(f"%{target_frequency}%"))
    if target_vessel:
        stmt = stmt.where(
            (ReportConfig.vessel_name.ilike(f"%{target_vessel}%")) |
            (ReportConfig.vessel_imo == target_vessel)
        )
        
    result = await db.execute(stmt)
    db_configs = result.scalars().all()

    if target_reports:
        if isinstance(target_reports, list):
            target_reports = ",".join(target_reports)
        allowed = [r.strip().lower() for r in target_reports.split(",")]
        filtered = []
        for c in db_configs:
            if any(a in c.report_code.lower() or (c.report_name and a in c.report_name.lower()) for a in allowed):
                filtered.append(c)
        db_configs = filtered

    if smart_cron:
        from app.models.report import Report
        
        filtered_smart = []
        now_date = datetime.utcnow().date()
        
        for c in db_configs:
            stmt_latest = select(Report).where(
                Report.vessel_imo == c.vessel_imo,
                Report.report_code == c.report_code
            ).order_by(Report.created_at.desc())
            
            res_latest = await db.execute(stmt_latest)
            latest_report = res_latest.scalars().first()
            
            should_scrape = False
            target_job_no = None
            
            target_due_date = None
            if not latest_report:
                should_scrape = True
            else:
                if latest_report.job_status == "PENDING":
                    should_scrape = True
                    target_job_no = latest_report.job_order_no
                    target_due_date = latest_report.due_date
                else:
                    if latest_report.next_due_date:
                        if latest_report.next_due_date.date() <= now_date:
                            should_scrape = True
                            target_job_no = latest_report.job_order_no
                            target_due_date = latest_report.next_due_date
                    else:
                        should_scrape = True
            
            if should_scrape:
                c._target_job_no = target_job_no
                c._target_due_date = target_due_date
                filtered_smart.append(c)
                
        db_configs = filtered_smart
        logger.info(f"Smart Cron mode: {len(db_configs)} configs are due for scraping.")

    # Detach into simple dicts to prevent lazy-loading crashes after db.commit() in the loop
    config_entries = [
        {
            "vessel_imo": c.vessel_imo,
            "vessel_name": c.vessel_name,
            "report_code": c.report_code,
            "report_name": c.report_name,
            "department": c.department,
            "frequency": c.frequency,
            "target_job_order_no": getattr(c, "_target_job_no", None),
            "target_due_date": getattr(c, "_target_due_date", None)
        }
        for c in db_configs
    ]
    
    if not config_entries:
        logger.warning("No config entries found in DB. Scraper exiting.")
        return

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(accept_downloads=True, ignore_https_errors=True)
        context.set_default_timeout(60000)  # 60s global timeout for all actions
        page = await context.new_page()

        logged_in = await _login(page)
        if not logged_in:
            logger.error("Login failed. Aborting scraper run.")
            await browser.close()
            return

        overview_page = await _open_job_overview(context, page)
        if not overview_page:
            logger.error("Could not open Job Overview. Aborting.")
            await browser.close()
            return

        # Sequential scraping — one report at a time to avoid page-closed conflicts
        total = len(config_entries)
        for idx, entry in enumerate(config_entries):
            # The SmartPAL session was observed to degrade abruptly during a
            # long run that reuses one login/tab the whole way through: a
            # real 38-job backfill run succeeded on every single one of the
            # first 15 reports, then the equipment-search step failed on
            # every single one of the remaining 19 with zero exceptions --
            # not an intermittent slowdown, a hard cutover partway through
            # (roughly the 13-minute / 15-16th report mark, consistent with
            # a MariApps session/token timeout). Forcing an entirely fresh
            # browser context + login well before that point, periodically
            # through a long run, keeps every report on the safe side of
            # whatever that cutover is instead of silently failing en masse
            # once it's crossed.
            if idx > 0 and idx % SESSION_REFRESH_EVERY == 0:
                logger.info(f"[{idx}/{total}] Refreshing SmartPAL session (login + Job Overview) "
                            f"to avoid long-run session degradation observed after ~15 reports...")
                fresh = await _fresh_session(browser)
                if fresh:
                    old_context = context
                    context, page, overview_page = fresh
                    try:
                        await old_context.close()
                    except Exception:
                        pass
                else:
                    logger.warning("Session refresh failed -- continuing with the existing "
                                    "(possibly degraded) session; remaining reports may fail.")

            vessel_imo  = entry["vessel_imo"].strip()
            vessel_name = entry["vessel_name"].strip()
            report_code = entry["report_code"].strip()
            report_name = entry["report_name"].strip() if entry["report_name"] else report_code
            department  = entry["department"].strip() if entry["department"] else ""
            frequency   = entry["frequency"]

            logger.info(f"[{idx+1}/{total}] Scraping: {vessel_name} [{vessel_imo}] -> {report_code}")

            fail_reason = {}
            try:
                result = await _scrape_report(
                    context, overview_page,
                    vessel_imo, vessel_name,
                    report_code, report_name, department, frequency,
                    entry.get("target_job_order_no"),
                    entry.get("target_due_date"),
                    fail_reason=fail_reason,
                )
                if result:
                    result["is_smart_scrape"] = smart_cron
                    await _save_report(db, result)
                else:
                    # _scrape_report returning None used to mean this config
                    # vanished with zero trace -- no row, no FAILED marker,
                    # nothing distinguishing "genuinely not due yet" from
                    # "the scraper couldn't find it". Every attempt now
                    # leaves a row so a full re-scrape can be audited
                    # config-by-config afterwards.
                    reason = fail_reason.get("msg", "Scrape returned no data for an unlogged reason.")
                    logger.warning(f"No data captured for {vessel_name}/{report_code}: {reason}")
                    await _mark_failed(db, vessel_imo, report_code, reason,
                                       vessel_name=vessel_name, report_name=report_name)
            except Exception as e:
                logger.error(f"Error scraping {vessel_name}/{report_code}: {e}")
                await _mark_failed(db, vessel_imo, report_code, str(e),
                                   vessel_name=vessel_name, report_name=report_name)

        await browser.close()
        logger.info("Scraper run complete.")


# ---------------------------------------------------------------------------
# Step 1: Login
# ---------------------------------------------------------------------------

async def _login(page) -> bool:
    try:
        logger.info("Navigating to SmartPAL...")
        await page.goto(settings.SMARTPAL_BASE_URL, timeout=120000)

        await page.get_by_text("Login with your Microsoft account").click(timeout=15000)
        await page.wait_for_url("**/login.microsoftonline.com/**", timeout=15000)

        await page.locator("input[type='email']").fill(settings.SMARTPAL_EMAIL)
        await page.get_by_role("button", name="Next").click()
        await page.wait_for_timeout(1500)

        await page.locator("input[type='password']").fill(settings.SMARTPAL_PASSWORD)
        await page.get_by_role("button", name="Sign in").click()

        try:
            await page.get_by_role("button", name="Yes").click(timeout=5000)
        except PlaywrightTimeout:
            pass

        import re
        await page.wait_for_url(re.compile(r".*ozellar\.com.*(Dashboard|Home|Landing).*"), timeout=60000)
        logger.info("Login successful.")
        return True

    except Exception as e:
        logger.error(f"Login error: {e}")
        return False


# ---------------------------------------------------------------------------
# Step 2: Open Job Overview (once per session)
# ---------------------------------------------------------------------------

async def _open_job_overview(context, landing_page):
    try:
        # Click the grid/menu icon in the header
        await landing_page.evaluate('''() => {
            const candidates = Array.from(document.querySelectorAll(
                "#mainmenu-btn, #btnAppMenu, .fa-th, .fa-th-large, .module-menu, [class*=menu-btn], [class*=nav-btn]"
            ));
            if (candidates.length > 0) { candidates[0].click(); return true; }
            const fallback = Array.from(document.querySelectorAll("header i, header span")).find(
                e => /fa-th|menu|grid/i.test(e.className)
            );
            if (fallback) { fallback.click(); return true; }
            return false;
        }''')
        await landing_page.wait_for_timeout(1500)

        # Click Maintenance
        await landing_page.evaluate('''() => {
            const elements = Array.from(document.querySelectorAll("a, span.menu-label"));
            const maint = elements.find(s => s.innerText && s.innerText.trim() === "Maintenance");
            if (maint) maint.click();
        }''')
        await landing_page.wait_for_timeout(1000)

        # Click Reports
        await landing_page.evaluate('''() => {
            const elements = Array.from(document.querySelectorAll("a, span.menu-label"));
            const report = elements.find(l => l.innerText && l.innerText.trim() === "Reports");
            if (report) report.click();
        }''')
        await landing_page.wait_for_timeout(1000)

        # Open Job Overview in a new tab manually to avoid popup interception issues
        url_path = await landing_page.evaluate('''() => {
            const elements = Array.from(document.querySelectorAll("a"));
            const jobOverview = elements.find(l => l.innerText && l.innerText.trim() === "Job Overview");
            return jobOverview ? jobOverview.getAttribute("href") : "/MaintenancePALApp/Maintenance/JobOverview";
        }''')
        
        import urllib.parse
        parsed = urllib.parse.urlparse(settings.SMARTPAL_BASE_URL)
        root_url = f"{parsed.scheme}://{parsed.netloc}"
        
        if url_path and not url_path.startswith("http"):
            overview_url = root_url + "/" + url_path.lstrip('/')
        else:
            overview_url = url_path or (root_url + "/MaintenancePALApp/Maintenance/JobOverview")
            
        overview_page = await context.new_page()
        await overview_page.goto(overview_url, timeout=60000)
        await overview_page.wait_for_load_state("networkidle")
        logger.info("Job Overview page opened successfully.")
        return overview_page

    except Exception as e:
        logger.error(f"Failed to open Job Overview: {e}")
        return None


# ---------------------------------------------------------------------------
# Steps 3-11: Scrape one report for one vessel
# ---------------------------------------------------------------------------

async def _scrape_report(context, overview_page, vessel_imo, vessel_name, report_code, report_name, department, frequency, target_job_order_no=None, target_due_date=None, fail_reason=None):
    """`fail_reason`, if given, is a dict this function fills in with a
    human-readable explanation before every early `return None` -- so a run
    that finds nothing for a report still tells the caller WHY (equipment
    not found in the tree, no completed job yet, attachments tab empty,
    etc.) instead of the report simply vanishing with no trace. See
    run_scraper, which uses this to always write a FAILED row with a reason
    rather than silently skipping the config."""
    def _fail(msg):
        if fail_reason is not None:
            fail_reason["msg"] = msg
        return None

    eq_page = None
    job_page = None
    job_order_page = None

    try:
        # Step 3: Select vessel via Kendo dropdown
        await overview_page.evaluate(f'''(vesselName) => {{
            const inputs = Array.from(document.querySelectorAll("input"));
            const vesselInput = inputs.find(i =>
                (i.placeholder && /vessel|ship|select/i.test(i.placeholder)) ||
                (i.id && /vessel/i.test(i.id))
            );
            if (vesselInput) {{
                vesselInput.focus();
                vesselInput.value = vesselName;
                vesselInput.dispatchEvent(new Event("input", {{ bubbles: true }}));
                vesselInput.dispatchEvent(new KeyboardEvent("keyup", {{ bubbles: true }}));
            }}
        }}''', vessel_name)
        await overview_page.wait_for_timeout(1500)

        # Click matching item in Kendo dropdown popup
        await overview_page.evaluate(f'''(vesselName) => {{
            const items = Array.from(document.querySelectorAll(
                "ul.k-list li, .k-popup li, [class*=k-item]"
            ));
            const match = items.find(i => i.innerText.trim().includes(vesselName));
            if (match) {{ match.click(); return true; }}
            return false;
        }}''', vessel_name)
        await overview_page.wait_for_timeout(2000)

        # Step 4: Manually navigate equipment tree (Search is unreliable)
        # Flow: Equipment -> Report -> Weekly/Monthly/Quarterly based on prefix
        async def expand_node_by_text(text: str):
            await overview_page.evaluate(f'''(textToFind) => {{
                const spans = Array.from(document.querySelectorAll(".k-treeview span.k-in, .k-treeview .k-item > div > span"));
                const node = spans.find(s => s.innerText && s.innerText.toLowerCase().includes(textToFind.toLowerCase()));
                if (node) {{
                    const item = node.closest("li");
                    if (item) {{
                        const icon = item.querySelector(".k-icon.k-plus, .k-i-expand, .k-i-plus");
                        if (icon && icon.offsetWidth > 0) {{ icon.click(); }}
                    }}
                }}
            }}''', text)
            await overview_page.wait_for_timeout(1000)

        logger.info(f"Finding equipment tree node for: {report_code}")
        # Handle any pre-existing modals or toasts
        await overview_page.evaluate('''() => {
            document.querySelectorAll(".message-container, .message-overlay, .toast, .modal, .modal-backdrop").forEach(t => t.remove());
        }''')

        import re

        # ==================================================================
        # Step 4: Find the correct equipment node using TWO strategies
        # ==================================================================
        # Strategy 1: Type into the AutoComplete search box and CLICK the
        #             first dropdown item directly (most reliable when it works).
        # Strategy 2: If autocomplete returns nothing, expand the full tree
        #             and do a fuzzy text match on the visible tree nodes.
        # ==================================================================

        clean_report_name = re.sub(r'^\d+[\.\s-]+', '', report_name).strip()

        # Build a list of keyword tokens to search with
        search_terms = []
        if clean_report_name:
            search_terms.append(clean_report_name)

        code_match = re.search(r'(TECH|OPR|SAF|WK|MO|QT|HY|YR)[\s-]*(\d+[A-Z]?)', clean_report_name.upper())
        if code_match:
            # Also add the exact name WITHOUT the prefix (e.g. "AE-2 CRANKWEB DEFLECTION REPORT")
            prefix_str = code_match.group(0)
            idx = clean_report_name.upper().find(prefix_str)
            if idx != -1:
                name_without_prefix = clean_report_name[idx + len(prefix_str):].strip()
                name_without_prefix = re.sub(r'^[\s-]+', '', name_without_prefix)
                if len(name_without_prefix) > 3:
                    search_terms.append(name_without_prefix)

        # Some reports are labelled with a DIFFERENT numbering scheme on
        # different vessels' SmartPAL trees (e.g. one vessel shows
        # "OPT - BCR - 11 - TANK SOUNDING REPORT", another shows
        # "MONTHLY - 10 - TANK SOUNDING REPORT" for the same report), so a
        # literal full-name search only ever matches whichever vessel
        # happens to use our config's exact wording. As a last-resort
        # fallback term, strip everything up to and including the last
        # "<code/word> - <number> - " segment, leaving just the descriptive
        # title (e.g. "TANK SOUNDING REPORT"), which is shared across the
        # differently-numbered variants and is specific enough to still
        # uniquely identify the report in the portal's search.
        desc_match = re.search(r'-\s*\d+[A-Z]?\s*-\s*(.+)$', clean_report_name)
        if desc_match:
            desc_term = desc_match.group(1).strip()
            if len(desc_term) > 3:
                search_terms.append(desc_term)

        search_terms = list(dict.fromkeys(t for t in search_terms if t))

        # --- Locate the search input ---
        search_input_handle = await overview_page.evaluate_handle('''() => {
            const inputs = Array.from(document.querySelectorAll("input"));
            return inputs.find(i => i.placeholder && i.placeholder.includes("Search Equipment"));
        }''')
        is_element = await search_input_handle.evaluate("el => el instanceof HTMLElement")
        if not is_element:
            logger.warning("Could not find 'Search Equipment' input box!")
            return _fail("Could not find the 'Search Equipment' input box on the Job Overview page.")

        clicked_node = False

        # ---- Strategy 1: AutoComplete → click dropdown item directly ----
        for term in search_terms:
            if not term:
                continue
            logger.info(f"AutoComplete search: '{term}'")
            await search_input_handle.click(force=True)
            await search_input_handle.fill("")
            await search_input_handle.type(term, delay=50)
            await overview_page.wait_for_timeout(5000)  # wait for AJAX

            # Check if any dropdown items appeared
            found = await overview_page.evaluate('''() => {
                const items = Array.from(document.querySelectorAll(
                    ".k-animation-container li, .k-list-container li, ul.k-list li, .k-popup li"
                ));
                return items.filter(i => i.offsetWidth > 0 && i.offsetHeight > 0).length;
            }''')

            if found > 0:
                # Click the FIRST dropdown item — this selects the node and loads the grid
                logger.info(f"AutoComplete returned {found} item(s). Clicking first result...")
                clicked_node = await overview_page.evaluate(r'''(code) => {
                    const items = Array.from(document.querySelectorAll(
                        ".k-animation-container li, .k-list-container li, ul.k-list li, .k-popup li"
                    ));
                    const visible = items.filter(i => i.offsetWidth > 0 && i.offsetHeight > 0);
                    if (visible.length === 0) return false;
                    
                    let bestNode = visible[0];

                    // Report codes are built from titles like "TECH - 57 - ..." where
                    // spaces around the separator become underscores (e.g. "TECH_-_57"),
                    // which broke plain substring checks like code.includes('TECH-57').
                    // Collapse any run of space/underscore/hyphen into a single '-' so
                    // matching is independent of the exact separator style.
                    const codeNorm = code.replace(/[\s_-]+/g, '-');

                    // --- Custom overrides as requested by user ---
                    if (codeNorm.includes('TECH-15') || codeNorm.includes('TECH-12') || codeNorm.includes('TECH-57') || codeNorm.includes('TECH-16')) {
                        for (const item of visible) {
                            const text = (item.innerText || "").toUpperCase();
                            if (codeNorm.includes('AE-1') && text.includes('AE-1')) { bestNode = item; break; }
                            if (codeNorm.includes('AE-2') && text.includes('AE-2')) { bestNode = item; break; }
                            if (codeNorm.includes('AE-3') && text.includes('AE-3')) { bestNode = item; break; }
                            if (codeNorm.includes('ME-') && text.includes('ME ')) { bestNode = item; break; }
                            if (codeNorm.includes('TECH-57') && text.includes('57')) { bestNode = item; break; }
                            if (codeNorm.includes('TECH-16') && text.includes('16')) { bestNode = item; break; }
                        }
                    }
                    
                    bestNode.click();
                    return true;
                }''', report_code.upper())
                if clicked_node:
                    logger.info(f"Strategy 1 SUCCESS: Clicked autocomplete item for '{term}'")
                    break

        if not clicked_node:
            logger.warning(f"AutoComplete strategy failed for '{report_name}'. Skipping report.")
            return _fail(f"Equipment search found no match for any of {search_terms!r} -- the "
                         f"report's title in this vessel's equipment tree may use different wording "
                         f"than report_configs.report_name.")
            
        await overview_page.wait_for_timeout(1500)

        # Step 6: Click Show button and wait for grid to load
        await overview_page.locator("#jobOverviewShowBtn").click(force=True)
        # Wait for the loading overlay to disappear before proceeding
        try:
            await overview_page.wait_for_selector(".k-loading-mask", state="hidden", timeout=20000)
        except Exception:
            pass
        # Also wait for the equipment link to actually appear in the grid
        try:
            await overview_page.wait_for_selector("a.cellEqpNameLink", timeout=15000)
        except Exception:
            pass
        await overview_page.wait_for_timeout(1000)

        # Step 6.5: Click Equipment Name link -> new tab
        link_count = await overview_page.locator("a.cellEqpNameLink").count()
        if link_count == 0:
            logger.warning(f"No equipment links in grid for: {report_code}")
            return _fail("Equipment was found in the tree/search, but clicking Show produced an "
                         "empty grid (no equipment link) -- the vessel may have no job plan "
                         "configured for this equipment code.")

        logger.info("Opening Job Order details...")
        # Remove overlay before clicking to prevent pointer-event interception
        await overview_page.evaluate('''() => {
            document.querySelectorAll(".k-loading-mask, .k-loading-color").forEach(e => e.remove());
        }''')
        
        eq_page = None
        for attempt in range(3):
            try:
                async with context.expect_page(timeout=15000) as eq_page_info:
                    # Use JS click which is more reliable than Playwright's force=True if element is obscured
                    await overview_page.evaluate('''() => {
                        const link = document.querySelector("a.cellEqpNameLink");
                        if (link) link.click();
                    }''')
                eq_page = await eq_page_info.value
                break
            except Exception as e:
                logger.warning(f"Attempt {attempt+1} to open equipment page failed: timed out waiting for new tab.")
                await overview_page.wait_for_timeout(3000)
                
        if not eq_page:
            logger.error(f"Failed to open equipment link for {report_code} after 3 attempts. Skipping.")
            return _fail("Clicking the equipment link never opened a new tab after 3 attempts "
                         "(SmartPAL popup/navigation timing issue).")
            
        try:
            await eq_page.wait_for_load_state("domcontentloaded", timeout=30000)
        except Exception:
            pass
        await eq_page.wait_for_timeout(2000)
        
        logger.info("Clicking 'Job Plan' tab...")
        await eq_page.evaluate('''() => {
            const links = Array.from(document.querySelectorAll("a, span, div"));
            const tab = links.find(el => el.innerText && el.innerText.trim() === "Job Plan");
            if (tab) tab.click();
        }''')
        try:
            await eq_page.wait_for_selector(".k-loading-mask", state="hidden", timeout=15000)
        except Exception:
            pass
        # Increased wait to 5s because k-loading-mask sometimes appears late
        await eq_page.wait_for_timeout(5000)

        # Step 7.5: Click the Job Title link in the Job Plan grid to open Job Order page
        logger.info("Clicking Job Title link in Job Plan grid...")

        # Check first if a job title link exists — BEFORE entering expect_page
        #
        # This single unguarded read was a THIRD instance of the same
        # Kendo-grid rendering race already found and fixed for the Job
        # History grid and the Attachments grid: a real run showed WK-02 and
        # WK-04 finding the link fine while WK-03/WK-05/WK-06 -- processed
        # moments apart in the same session -- found nothing here and fell
        # back to a path that then (correctly, given the fallback's own
        # narrower view) found 0 job history rows. The fixed 5s wait above
        # is not always enough; poll for the link a few more times before
        # accepting "not found" and giving up on the primary path.
        has_job_link = False
        for _ in range(8):
            has_job_link = await eq_page.evaluate('''() => {
                const grids = Array.from(document.querySelectorAll(".k-grid"));
                const visibleGrids = grids.filter(g => g.offsetWidth > 0);
                for (const g of visibleGrids) {
                    if (g.querySelector("tbody tr td a")) return true;
                }
                return false;
            }''')
            if has_job_link:
                break
            await eq_page.wait_for_timeout(2000)

        if not has_job_link:
            logger.warning(f"Could not find Job Title link in Job Plan grid. Trying 'History' tab on Equipment Page as fallback...")
            job_order_page = eq_page
            await job_order_page.evaluate('''() => {
                const tab = document.querySelector('a[href="#History"]');
                if (tab) tab.click();
                else {
                    const links = Array.from(document.querySelectorAll("a, span, div"));
                    const fallback = links.find(el => el.innerText && (el.innerText.includes("Job History") || el.innerText.trim() === "History"));
                    if (fallback) fallback.click();
                }
            }''')
            try:
                await job_order_page.wait_for_selector("#History .k-loading-mask", state="hidden", timeout=15000)
            except Exception:
                pass
            # Poll until the History grid's row count stabilizes, same
            # pattern used for the primary path's Job History scan below --
            # a single fixed wait here inherited the exact same Kendo
            # rendering race with no retry, so a slow render on this
            # fallback path silently produced "0 rows" even when completed
            # jobs genuinely existed (confirmed: WK-04-ELECTRICAL found a
            # COMPLETED job on one run and found nothing on a later run of
            # the identical report, with no data change on SmartPAL's side).
            _prev = -1
            _stable = 0
            for _ in range(6):
                _count = await job_order_page.evaluate('''() => {
                    const grids = Array.from(document.querySelectorAll(".k-grid"));
                    const visibleGrids = grids.filter(g => g.offsetWidth > 0);
                    for (const g of visibleGrids) {
                        const rows = g.querySelectorAll("tbody tr");
                        if (rows.length > 0) return rows.length;
                    }
                    return 0;
                }''')
                if _count == _prev and _count > 0:
                    _stable += 1
                    if _stable >= 2:
                        break
                else:
                    _stable = 0
                _prev = _count
                await job_order_page.wait_for_timeout(1500)
        else:
            async with context.expect_page(timeout=120000) as jo_page_info:
                await eq_page.evaluate('''() => {
                    const grids = Array.from(document.querySelectorAll(".k-grid"));
                    const visibleGrids = grids.filter(g => g.offsetWidth > 0);
                    for (const g of visibleGrids) {
                        const link = g.querySelector("tbody tr td a");
                        if (link) { link.click(); return; }
                    }
                }''')
                    
            job_order_page = await jo_page_info.value
            try:
                await job_order_page.wait_for_load_state("domcontentloaded", timeout=30000)
            except Exception:
                pass
            await job_order_page.wait_for_timeout(3000)
            
            # Step 8: On Job Order page, click Job History tab
            logger.info("Clicking 'Job History' tab on Job Order page...")
            await job_order_page.evaluate('''() => {
                const tab = document.querySelector('a[href="#History"]');
                if (tab) tab.click();
                else {
                    // Fallback to text matching just in case
                    const links = Array.from(document.querySelectorAll("a, span, div"));
                    const fallback = links.find(el => el.innerText && el.innerText.includes("Job History"));
                    if (fallback) fallback.click();
                }
            }''')
            try:
                await job_order_page.wait_for_selector("#History .k-loading-mask", state="hidden", timeout=15000)
            except Exception:
                pass
            await job_order_page.wait_for_timeout(5000)

        # Step 9: Find latest COMPLETED job in Job History grid and open it
        logger.info("Scanning Job History for a COMPLETED job...")

        # Get column indices robustly (without using :visible which is invalid in native querySelectorAll)
        async def _read_col_indices():
            return await job_order_page.evaluate('''() => {
                const grids = Array.from(document.querySelectorAll(".k-grid"));
                const visibleGrids = grids.filter(g => g.offsetWidth > 0);
                const map = {};
                if (visibleGrids.length > 0) {
                    const ths = Array.from(visibleGrids[0].querySelectorAll("thead th"));
                    ths.forEach((th, i) => {
                        const text = th.innerText.trim();
                        if (text.includes("Job Order No")) map['jobOrderNo'] = i;
                        if (text.includes("Job Status")) map['status'] = i;
                        if (text.includes("Job End")) map['endDate'] = i;
                        if (text.includes("Approved By")) map['approvedBy'] = i;
                        if (text.includes("Due Date")) map['dueDate'] = i;
                        if (text.includes("Job Start")) map['startDate'] = i;
                        if (text.includes("Job Type")) map['jobType'] = i;
                        if (text.includes("Job Category")) map['jobCategory'] = i;
                    });
                }
                return map;
            }''')

        # The Job History grid can render INCREMENTALLY -- a read taken right
        # after the tab click was observed returning 2 rows for a job that
        # genuinely has 4 (2 COMPLETED), because Kendo hadn't finished
        # appending the rest yet. A simple "retry while count == 0" check
        # does NOT catch this: 2 is not zero. Instead, poll until the row
        # count stops changing between two consecutive reads (or we give up),
        # which catches both "still empty" and "partially populated".
        rows = await job_order_page.locator(".k-grid:visible tbody tr").all()
        prev_count = -1
        stable_reads = 0
        for _ in range(6):
            if len(rows) == prev_count and len(rows) > 0:
                stable_reads += 1
                if stable_reads >= 2:
                    break
            else:
                stable_reads = 0
            prev_count = len(rows)
            await job_order_page.wait_for_timeout(1500)
            rows = await job_order_page.locator(".k-grid:visible tbody tr").all()
        if prev_count not in (-1, len(rows)):
            logger.info(f"Job History row count changed from {prev_count} to {len(rows)} while waiting for it to settle.")

        col_indices = await _read_col_indices()
        idx_no = col_indices.get("jobOrderNo", 6)
        idx_status = col_indices.get("status", 10)
        idx_end = col_indices.get("endDate", 12)
        idx_app = col_indices.get("approvedBy", 15)

        idx_due = col_indices.get("dueDate", -1)
        idx_start = col_indices.get("startDate", -1)
        idx_type = col_indices.get("jobType", -1)
        idx_cat = col_indices.get("jobCategory", -1)

        found_job = False
        
        job_order_no = "UNKNOWN"
        approved_by = None
        job_date = None
        due_date = None
        next_due_date = None
        job_start_date = None
        job_end_date = None
        job_type = None
        job_category = None

        found_completed = False
        found_pending = False
        pend_details = {}

        for row in rows:
            cells = await row.locator("td").all()
            if len(cells) > max(idx_no, idx_status):
                status_text = await cells[idx_status].inner_text()
                row_job_no = (await cells[idx_no].inner_text()).strip()
                
                row_due_date = None
                if 0 <= idx_due < len(cells):
                    due_text = (await cells[idx_due].inner_text()).strip()
                    if due_text:
                        try: row_due_date = datetime.strptime(due_text, "%d-%b-%Y")
                        except: pass
                
                # If target_due_date is provided, we MUST only process the row that matches this due date for our strict check.
                # However, we still want to grab pend_details if we see a PENDING row, so we let the first PENDING row set pend_details.
                
                if "PENDING" in status_text.upper() and not found_pending:
                    pend_details["job_order_no"] = row_job_no
                    pend_details["due_date"] = row_due_date
                    if next_due_date is None:
                        next_due_date = pend_details.get("due_date")
                    found_pending = True
                    
                    # If this pending row exactly matches our target due date, then the cycle is truly still pending. Fast exit but FIRST SCRAPE ATTACHMENTS!
                    if target_due_date and row_due_date and row_due_date.date() == target_due_date.date():
                        logger.info(f"Smart Scrape: Target cycle {target_due_date.date()} is still PENDING. Extracting pending attachments before exit...")
                        
                        # We must click into the pending job (which opens a popup from the main Job Plan grid)
                        # The pending jobs are NOT in the History tab, they are right here in the Job Plan.
                        async with context.expect_page() as pending_page_info:
                            await cells[idx_no].locator("a").click(force=True)
                        pending_details_page = await pending_page_info.value
                        
                        try:
                            await pending_details_page.wait_for_load_state("domcontentloaded", timeout=30000)
                        except:
                            pass
                        await pending_details_page.wait_for_timeout(3000)
                        
                        # Click Attachments tab in pending job
                        await _click_attachments_tab_and_wait(pending_details_page)

                        # Fallback dump for diagnostics
                        html_content = await pending_details_page.content()
                        with open(f"attachments_dump_pending_{vessel_imo}.html", "w", encoding="utf-8") as f:
                            f.write(html_content)
                            
                        # Poll until the row count stops changing rather than
                        # trusting the first nonzero read -- see the identical
                        # comment on the COMPLETED-job attachment read below,
                        # which documents two real jobs this exact race
                        # dropped attachments for.
                        async def _read_pending_row_count():
                            return await pending_details_page.evaluate('''() => {
                                const grids = Array.from(document.querySelectorAll("#Attachments .k-grid, #Attachments table, .attachment-grid, .k-grid, table.rgMasterTable"));
                                const visibleGrid = grids.find(g => g && g.offsetWidth > 0);
                                if (!visibleGrid) return 0;
                                return visibleGrid.querySelectorAll("tbody tr").length;
                            }''')

                        async def _pending_no_attachment_present():
                            return await pending_details_page.evaluate('''() => {
                                const el = document.querySelector("#Attachments .no-attachment");
                                return !!(el && el.offsetWidth > 0);
                            }''')

                        row_count = await _read_pending_row_count()
                        _prev_count = -1
                        _stable_reads = 0
                        _empty_confirms = 0
                        for _ in range(10):
                            if await _pending_no_attachment_present():
                                _empty_confirms += 1
                                if _empty_confirms >= 2:
                                    row_count = 0
                                    break
                                row_count = 0
                                await pending_details_page.wait_for_timeout(1500)
                                continue
                            else:
                                _empty_confirms = 0

                            if row_count == _prev_count and row_count > 0:
                                _stable_reads += 1
                                if _stable_reads >= 2:
                                    break
                            else:
                                _stable_reads = 0
                            _prev_count = row_count
                            await pending_details_page.wait_for_timeout(1500)
                            row_count = await _read_pending_row_count()

                        pdf_files = []
                        seen_urls = set()
                        
                        row_names = await pending_details_page.evaluate('''() => {
                            const grids = Array.from(document.querySelectorAll("#Attachments .k-grid, #Attachments table, .attachment-grid, .k-grid, table.rgMasterTable"));
                            const visibleGrid = grids.find(g => g && g.offsetWidth > 0);
                            if (!visibleGrid) return [];
                            return Array.from(visibleGrid.querySelectorAll("tbody tr")).map(r => {
                                const cells = r.querySelectorAll("td");
                                if (cells.length >= 2) {
                                    const link = cells[1].querySelector("a");
                                    if (link) return link.innerText.trim();
                                    return cells[1].innerText.trim().split("\\n")[0].trim();
                                }
                                return r.innerText.trim().split("\\n")[0].trim();
                            });
                        }''')
                        
                        if row_count > 0:
                            for row_idx in range(row_count):
                                captured_url = None
                                captured_fname = row_names[row_idx] if row_idx < len(row_names) else ""
                                
                                async def pending_handle_request(request):
                                    nonlocal captured_url
                                    url = request.url
                                    if any(kw in url for kw in ["GetViewAttachment", "Attachment", "attachment", "GetFile", "Download", "download", "DocumentDownloader"]):
                                        if url.startswith("http") and url not in seen_urls:
                                            captured_url = url
                                
                                pending_details_page.context.on("request", pending_handle_request)
                                # try/finally, NOT a bare statement after the try/except below --
                                # if wait_for_timeout (or anything else in here) throws because
                                # the tab crashed/closed under a long-running --full scrape, a
                                # plain post-try statement would never run and this listener
                                # leaks onto `context` for the rest of the ENTIRE run (the same
                                # browser context is reused across all ~40 reports). A handful of
                                # leaked listeners accumulating over a long run was the working
                                # theory for attachments intermittently failing to capture later
                                # in a run despite MariApps itself responding fine when checked
                                # in isolation -- confirmed real jobs (TECH-15 AE-3, Weekly Bunker
                                # Report) with real attachments on MariApps came back with 0
                                # attachments captured, inconsistently between adjacent reports
                                # processed seconds apart in the same run.
                                try:
                                    try:
                                        async with pending_details_page.expect_download(timeout=3000) as download_info:
                                            await pending_details_page.evaluate(f'''(idx) => {{
                                                const grids = Array.from(document.querySelectorAll("#Attachments .k-grid, #Attachments table, .attachment-grid, .k-grid, table.rgMasterTable"));
                                                const visibleGrid = grids.find(g => g && g.offsetWidth > 0);
                                                if (visibleGrid) {{
                                                    const rows = visibleGrid.querySelectorAll("tbody tr");
                                                    if (rows[idx]) {{
                                                        const clickables = Array.from(rows[idx].querySelectorAll('a, button'));
                                                        let dl = clickables.find(a =>
                                                            (a.innerText && a.innerText.toLowerCase().includes('download')) ||
                                                            (a.title && a.title.toLowerCase().includes('download')) ||
                                                            (a.className && typeof a.className === 'string' && a.className.toLowerCase().includes('download')) ||
                                                            (a.querySelector && a.querySelector('[class*="download"]'))
                                                        );
                                                        if (dl) dl.click();
                                                        else if (clickables.length > 0) clickables[0].click();
                                                    }}
                                                }}
                                            }}''', row_idx)
                                        download = await download_info.value
                                        if not captured_url: captured_url = download.url
                                    except:
                                        pass
                                    await pending_details_page.wait_for_timeout(1500)
                                finally:
                                    pending_details_page.context.remove_listener("request", pending_handle_request)

                                try:
                                    await pending_details_page.evaluate('''() => {
                                        const closeBtns = document.querySelectorAll(".k-window-action .k-i-close, .ui-dialog-titlebar-close, [aria-label='Close'], button.close");
                                        closeBtns.forEach(b => { if (b.offsetWidth > 0 || b.offsetHeight > 0) b.click(); });
                                    }''')
                                    await pending_details_page.keyboard.press("Escape")
                                    await pending_details_page.wait_for_timeout(500)
                                except:
                                    pass
                                    
                                if captured_url and captured_url not in seen_urls:
                                    seen_urls.add(captured_url)
                                    fname = captured_fname or f"attachment_{row_idx+1}"
                                    pdf_files.append({"url": captured_url, "filename": fname})
                                else:
                                    iframe_src = await pending_details_page.evaluate('''() => {
                                        let iframe = document.querySelector('iframe[src*="GetViewAttachment"]')
                                                  || document.querySelector('iframe[src*="Attachment"]')
                                                  || document.querySelector('iframe[src*="blob"]')
                                                  || document.querySelector('iframe[src*="pdf"]');
                                        if (!iframe) {
                                            const all = Array.from(document.querySelectorAll("iframe"));
                                            iframe = all.find(f => f.src && f.src.startsWith("http"));
                                        }
                                        return iframe ? iframe.src : null;
                                    }''')
                                    if iframe_src and iframe_src not in seen_urls:
                                        seen_urls.add(iframe_src)
                                        fname = captured_fname or f"attachment_{row_idx+1}"
                                        pdf_files.append({"url": iframe_src, "filename": fname})
                                    else:
                                        fname = captured_fname or f"attachment_{row_idx+1}"
                                        pdf_files.append({"url": "MISSING", "filename": fname})
                                        
                        # Download attachments logic
                        attachments = []
                        report_date, report_date_source = None, None
                        if pdf_files:
                            from urllib.parse import urlparse
                            from app.utils.report_date import extract_report_period
                            parsed_base = urlparse(pending_details_page.url)
                            base_url = f"{parsed_base.scheme}://{parsed_base.netloc}"

                            for index, pdf_data in enumerate(pdf_files):
                                pdf_url = pdf_data["url"]
                                pdf_filename = pdf_data["filename"]
                                if pdf_url == "MISSING":
                                    attachments.append({"file_name": pdf_filename, "blob_path": f"MISSING:{pdf_filename}"})
                                    continue
                                if not pdf_url.startswith("http"):
                                    pdf_url = base_url + "/" + pdf_url.lstrip('/')

                                try:
                                    response = await pending_details_page.context.request.get(
                                        pdf_url, timeout=300000,
                                        headers={"Referer": pending_details_page.url}
                                    )
                                    # A 200 response with an empty body (SmartPAL occasionally
                                    # returns this) must NOT be stored as a real attachment --
                                    # it silently produced files nobody could ever open.
                                    if response.ok:
                                        pdf_bytes = await response.body()
                                    else:
                                        pdf_bytes = b""
                                    if response.ok and pdf_bytes:
                                        date_str = datetime.utcnow().strftime("%Y-%m-%d")
                                        safe_fname = re.sub(r'[^a-zA-Z0-9_\-\. ]', '', pdf_filename).strip() or f"attachment_{index+1}"
                                        blob_name = f"reports/{vessel_imo}/{report_code}/{date_str}_{index}_{safe_fname}"
                                        upload_pdf_to_blob(pdf_bytes, blob_name)
                                        attachments.append({"file_name": pdf_filename, "blob_path": blob_name})
                                        if report_date is None:
                                            try:
                                                found = await asyncio.to_thread(extract_report_period, pdf_bytes, pdf_filename)
                                                if found:
                                                    report_date, report_date_source = found
                                            except Exception as e:
                                                logger.warning(f"Report-date extraction failed for '{pdf_filename}': {e}")
                                    else:
                                        attachments.append({"file_name": pdf_filename, "blob_path": f"MISSING:{pdf_filename}"})
                                except:
                                    attachments.append({"file_name": pdf_filename, "blob_path": f"MISSING:{pdf_filename}"})

                        try: await pending_details_page.close()
                        except: pass
                        try: await job_order_page.close()
                        except: pass

                        return {
                            "vessel_imo": vessel_imo, "vessel_name": vessel_name,
                            "report_code": report_code, "report_name": report_name,
                            "department": department, "frequency": frequency,
                            "job_order_no": pend_details.get("job_order_no", f"PEND-{report_code}"),
                            "job_status": "PENDING",
                            "due_date": pend_details.get("due_date"),
                            "attachments": attachments,
                            "report_date": report_date,
                            "report_date_source": report_date_source,
                        }

                if "COMPLETED" in status_text.upper() and not found_completed:
                    # Strict validation: If we are tracking a specific cycle via smart_cron
                    if target_job_order_no and target_due_date:
                        # SmartPAL reuses the same job_order_no across a due-date cycle's
                        # PENDING -> COMPLETED lifecycle (it doesn't mint a new number on
                        # completion), so row_job_no == target_job_order_no is exactly the
                        # completion we're watching for, not "nothing new". Only the due
                        # date tells us whether this row belongs to the cycle we're tracking.
                        is_target_cycle = (row_due_date and row_due_date.date() == target_due_date.date())

                        if not is_target_cycle:
                            # It is a different job, but its due date doesn't match our expected next cycle.
                            # We can just ignore it or assume it's out of order. For strictness, we skip.
                            continue
                    
                    job_order_no = row_job_no
                    if 0 <= idx_app < len(cells):
                        approved_by = (await cells[idx_app].inner_text()).strip()
                        
                    if 0 <= idx_end < len(cells):
                        end_text = (await cells[idx_end].inner_text()).strip()
                        if end_text:
                            try:
                                job_end_date = datetime.strptime(end_text, "%d-%b-%Y")
                                job_date = job_end_date
                            except Exception:
                                pass
                                
                    if 0 <= idx_due < len(cells):
                        due_text = (await cells[idx_due].inner_text()).strip()
                        if due_text:
                            try: due_date = datetime.strptime(due_text, "%d-%b-%Y")
                            except: pass
                            
                    if 0 <= idx_start < len(cells):
                        start_text = (await cells[idx_start].inner_text()).strip()
                        if start_text:
                            try: job_start_date = datetime.strptime(start_text, "%d-%b-%Y")
                            except: pass
                            
                    if 0 <= idx_type < len(cells):
                        job_type = (await cells[idx_type].inner_text()).strip()
                        
                    if 0 <= idx_cat < len(cells):
                        job_category = (await cells[idx_cat].inner_text()).strip()

                    logger.info(f"Found COMPLETED job: {job_order_no} (Approved by: {approved_by})")
                    async with context.expect_page() as history_page_info:
                        await cells[idx_no].locator("a").click(force=True)
                    history_details_page = await history_page_info.value
                    found_job = True
                    found_completed = True
                    
            if found_completed and found_pending:
                break

        if not found_job:
            logger.warning(f"No COMPLETED job history found for {report_code}")
            try: await job_order_page.close()
            except: pass
            if job_order_page != eq_page:
                try: await eq_page.close()
                except: pass
            if target_job_order_no and target_due_date:
                reason = (f"Job History has {len(rows)} row(s) but none is a COMPLETED row matching "
                          f"the tracked due date {target_due_date.date()} -- still pending, or the "
                          f"vessel is on a different cycle than expected.")
            else:
                reason = f"Job History has {len(rows)} row(s) but none is COMPLETED yet."
            return _fail(reason)
            
        # We rename 'history_details_page' to 'job_page' to match the rest of the script below
        job_page = history_details_page
        try:
            await job_page.wait_for_load_state("domcontentloaded", timeout=30000)
        except Exception:
            pass  # Continue even if page takes too long
        await job_page.wait_for_timeout(3000)

        # Step 10: Click Attachments tab and wait for content to render
        logger.info("Clicking 'Attachments' tab...")
        await _click_attachments_tab_and_wait(job_page)

        # Step 11: Use NETWORK REQUEST INTERCEPTION to capture all attachment URLs
        # When each row is clicked, SmartPAL fires a GET request to load the file.
        # We listen to these requests directly — no iframe polling needed.
        logger.info("Using network interception to capture attachment URLs...")

        # Dump HTML of completed job attachment page for debugging missing selectors
        html_content = await job_page.content()
        with open(f"attachments_dump_completed_{vessel_imo}.html", "w", encoding="utf-8") as f:
            f.write(html_content)

        # Get row count first - added table.rgMasterTable for older Telerik grids
        #
        # _click_attachments_tab_and_wait only waits for ONE of "a row exists"
        # / "the no-attachment empty state exists" to appear, then returns
        # immediately -- it does not guarantee every row has finished
        # rendering by that instant, and (confirmed against real MariApps
        # data during the AM KIRTI/AM TARANG audit) the grid can also render
        # INCREMENTALLY, so a naive "retry only while it reads 0" check can
        # still stop short of the true count. Two real jobs (OPR-06 Monthly
        # Paint Consumption V-AMKI002581/26, TECH-49 MGPS Log V-AMKI002962/26)
        # were confirmed via direct MariApps inspection to have 1 and 2
        # attachments respectively, yet this scraper recorded 0 for both --
        # not a MariApps gap, a scraper-side race. Poll until the count
        # stops changing between two consecutive reads (same pattern as the
        # Job History grid above) instead of stopping at the first nonzero
        # read, unless SmartPAL's own "No Attachments Found" message is
        # genuinely showing.
        async def _read_attachment_row_count():
            return await job_page.evaluate('''() => {
                const grids = Array.from(document.querySelectorAll("#Attachments .k-grid, #Attachments table, .attachment-grid, .k-grid, table.rgMasterTable, .rgMasterTable"));
                const visibleGrid = grids.find(g => g && g.offsetWidth > 0);
                if (!visibleGrid) return 0;
                return visibleGrid.querySelectorAll("tbody tr, tr.rgRow, tr.rgAltRow").length;
            }''')

        async def _no_attachment_message_present():
            return await job_page.evaluate('''() => {
                const el = document.querySelector("#Attachments .no-attachment");
                return !!(el && el.offsetWidth > 0);
            }''')

        row_count = await _read_attachment_row_count()
        prev_count = -1
        stable_reads = 0
        empty_confirms = 0
        for _ in range(10):
            if await _no_attachment_message_present():
                empty_confirms += 1
                if empty_confirms >= 2:
                    row_count = 0
                    break
                row_count = 0
                await job_page.wait_for_timeout(1500)
                continue
            else:
                empty_confirms = 0

            if row_count == prev_count and row_count > 0:
                stable_reads += 1
                if stable_reads >= 2:
                    break
            else:
                stable_reads = 0
            prev_count = row_count
            await job_page.wait_for_timeout(1500)
            row_count = await _read_attachment_row_count()
        if prev_count not in (-1, row_count):
            logger.info(f"Attachment row count changed from {prev_count} to {row_count} while waiting for it to settle.")

        pdf_files = []
        seen_urls = set()

        # Also get the filename from each row — use the File Name cell (column index 1)
        row_names = await job_page.evaluate('''() => {
            const grids = Array.from(document.querySelectorAll("#Attachments .k-grid, #Attachments table, .attachment-grid, .k-grid, table.rgMasterTable, .rgMasterTable"));
            const visibleGrid = grids.find(g => g && g.offsetWidth > 0);
            if (!visibleGrid) return [];
            return Array.from(visibleGrid.querySelectorAll("tbody tr, tr.rgRow, tr.rgAltRow")).map(r => {
                const cells = r.querySelectorAll("td");
                if (cells.length >= 2) {
                    const link = cells[1].querySelector("a");
                    if (link) return link.innerText.trim();
                    return cells[1].innerText.trim().split("\\n")[0].trim();
                }
                return r.innerText.trim().split("\\n")[0].trim();
            });
        }''');

        logger.info(f"Found {row_count} attachment row(s). Using network interception...")

        if row_count > 0:
            for row_idx in range(row_count):
                captured_url = None
                captured_fname = row_names[row_idx] if row_idx < len(row_names) else ""
                
                async def handle_request(request):
                    nonlocal captured_url
                    url = request.url
                    # Capture any request that looks like an attachment fetch (across all tabs)
                    if any(kw in url for kw in ["GetViewAttachment", "Attachment", "attachment", "GetFile", "Download", "download", "DocumentDownloader"]):
                        if url.startswith("http") and url not in seen_urls:
                            captured_url = url
                            logger.info(f"  Network intercepted: {url[:100]}...")

                context = job_page.context
                context.on("request", handle_request)

                # try/finally, NOT a bare statement after the try/except below -- if
                # wait_for_timeout (or anything else in here) throws because the tab
                # crashed/closed under a long-running --full scrape, a plain
                # post-try statement would never run and this listener leaks onto
                # `context` for the rest of the ENTIRE run (the same browser
                # context is reused across all ~40 reports). A handful of leaked
                # listeners accumulating over a long run was the working theory
                # for attachments intermittently failing to capture later in a
                # run despite MariApps itself responding fine when checked in
                # isolation -- confirmed real jobs (TECH-15 AE-3, Weekly Bunker
                # Report) with real attachments on MariApps came back with 0
                # attachments captured, inconsistently between adjacent reports
                # processed seconds apart in the same run.
                try:
                    try:
                        async with job_page.expect_download(timeout=3000) as download_info:
                            await job_page.evaluate(f'''(idx) => {{
                                const grids = Array.from(document.querySelectorAll("#Attachments .k-grid, #Attachments table, .attachment-grid, .k-grid, table.rgMasterTable, .rgMasterTable"));
                                const visibleGrid = grids.find(g => g && g.offsetWidth > 0);
                                if (visibleGrid) {{
                                    const rows = visibleGrid.querySelectorAll("tbody tr, tr.rgRow, tr.rgAltRow");
                                    if (rows[idx]) {{
                                        const clickables = Array.from(rows[idx].querySelectorAll('a, button'));
                                        let dl = clickables.find(a =>
                                            (a.innerText && a.innerText.toLowerCase().includes('download')) ||
                                            (a.title && a.title.toLowerCase().includes('download')) ||
                                            (a.className && typeof a.className === 'string' && a.className.toLowerCase().includes('download')) ||
                                            (a.querySelector && a.querySelector('[class*="download"]'))
                                        );
                                        if (dl) dl.click();
                                        else if (clickables.length > 0) clickables[0].click();
                                    }}
                                }}
                            }}''', row_idx)
                        download = await download_info.value
                        if not captured_url:
                            captured_url = download.url
                        logger.info(f"  Download event intercepted: {download.url[:100]}")
                    except Exception:
                        # No download event occurred. Proceed with request interception fallback.
                        pass

                    # Wait slightly for popups to trigger their requests
                    await job_page.wait_for_timeout(1500)
                finally:
                    context.remove_listener("request", handle_request)

                # Close any open document viewer modal that might block clicking the next row
                try:
                    await job_page.evaluate('''() => {
                        const closeBtns = document.querySelectorAll(".k-window-action .k-i-close, .ui-dialog-titlebar-close, [aria-label='Close'], button.close");
                        closeBtns.forEach(b => {
                            if (b.offsetWidth > 0 || b.offsetHeight > 0) b.click();
                        });
                    }''')
                    await job_page.keyboard.press("Escape")
                    await job_page.wait_for_timeout(500)
                except Exception:
                    pass

                if captured_url and captured_url not in seen_urls:
                    seen_urls.add(captured_url)
                    # Clean up the filename
                    fname = captured_fname or f"attachment_{row_idx+1}"
                    pdf_files.append({"url": captured_url, "filename": fname})
                    logger.info(f"  Row {row_idx+1}: captured '{fname}'")
                else:
                    # Network interception missed — fall back to reading current iframe src
                    logger.warning(f"  Row {row_idx+1}: no network request captured, trying iframe fallback...")
                    iframe_src = await job_page.evaluate('''() => {
                        let iframe = document.querySelector('iframe[src*="GetViewAttachment"]')
                                  || document.querySelector('iframe[src*="Attachment"]')
                                  || document.querySelector('iframe[src*="blob"]')
                                  || document.querySelector('iframe[src*="pdf"]');
                        if (!iframe) {
                            const all = Array.from(document.querySelectorAll("iframe"));
                            iframe = all.find(f => f.src && f.src.startsWith("http"));
                        }
                        return iframe ? iframe.src : null;
                    }''')
                    if iframe_src and iframe_src not in seen_urls:
                        seen_urls.add(iframe_src)
                        fname = captured_fname or f"attachment_{row_idx+1}"
                        pdf_files.append({"url": iframe_src, "filename": fname})
                        logger.info(f"  Row {row_idx+1}: iframe fallback captured '{fname}'")
                    else:
                        fname = captured_fname or f"attachment_{row_idx+1}"
                        pdf_files.append({"url": "MISSING", "filename": fname})
                        logger.warning(f"  Row {row_idx+1}: both methods failed, appending MISSING marker for UI")
        else:
            logger.info("No attachment rows found in the grid. Proceeding with 0 attachments.")




        logger.info(f"Found {len(pdf_files)} attachments to download.")

        from app.utils.report_date import extract_report_period

        attachments = []
        report_date, report_date_source = None, None
        for index, pdf_data in enumerate(pdf_files):
            pdf_url = pdf_data["url"]
            pdf_filename = pdf_data["filename"]

            if pdf_url == "MISSING":
                logger.warning(f"Skipping download for missing attachment: {pdf_filename}")
                attachments.append({"file_name": pdf_filename, "blob_path": f"MISSING:{pdf_filename}"})
                continue

            if not pdf_url.startswith("http"):
                base_url = settings.SMARTPAL_BASE_URL.rstrip('/')
                pdf_url = base_url + "/" + pdf_url.lstrip('/')

            logger.info(f"Downloading Attachment {index+1}/{len(pdf_files)}: {pdf_filename}")
            response = await context.request.get(
                pdf_url, timeout=300000,
                headers={"Referer": job_page.url}
            )

            if not response.ok:
                logger.error(f"Failed to download {pdf_filename}. Status: {response.status}")
                attachments.append({"file_name": pdf_filename, "blob_path": f"MISSING:{pdf_filename}"})
                continue

            pdf_bytes = await response.body()

            # A 200 response with an empty body must NOT be recorded as a real
            # attachment -- SmartPAL occasionally returns exactly this, and
            # without this guard the row was stored as a "successful" download
            # (not MISSING:) pointing at a zero-byte blob nobody could open.
            if not pdf_bytes:
                logger.error(f"Downloaded 0 bytes for {pdf_filename} -- treating as missing.")
                attachments.append({"file_name": pdf_filename, "blob_path": f"MISSING:{pdf_filename}"})
                continue

            # Try to get the real filename from Content-Disposition header
            import re
            content_disp = response.headers.get("content-disposition", "")
            if content_disp:
                cd_match = re.search(r'filename[^;=\n]*=["\']?([^;"\']+)["\']?', content_disp, re.IGNORECASE)
                if cd_match:
                    real_fname = cd_match.group(1).strip().strip('"').strip("'")
                    if real_fname:
                        pdf_filename = real_fname
                        logger.info(f"  Real filename from Content-Disposition: '{pdf_filename}'")

            # Step 12: Upload to Azure Blob with original SmartPAL filename
            date_str = datetime.utcnow().strftime("%Y-%m-%d")
            safe_fname = re.sub(r'[^a-zA-Z0-9_\-\. ]', '', pdf_filename).strip() or f"attachment_{index+1}"
            blob_name = f"reports/{vessel_imo}/{report_code}/{date_str}_{index}_{safe_fname}"

            upload_pdf_to_blob(pdf_bytes, blob_name)
            attachments.append({"file_name": pdf_filename, "blob_path": blob_name})

            # The report's real period lives inside the file, not in any
            # SmartPAL date -- see app/utils/report_date.py. First
            # attachment to yield one wins; later ones (e.g. a scanned
            # signature page) rarely carry a cleaner answer.
            if report_date is None:
                try:
                    found = await asyncio.to_thread(extract_report_period, pdf_bytes, pdf_filename)
                    if found:
                        report_date, report_date_source = found
                except Exception as e:
                    logger.warning(f"Report-date extraction failed for '{pdf_filename}': {e}")

        if not attachments:
            logger.warning(f"No attachments were downloaded for job: {job_order_no} (Saving record with 0 attachments)")
            
        logger.info(f"Successfully uploaded {len(attachments)} blobs for job {job_order_no}.")

        await eq_page.close()
        await job_page.close()
        await job_order_page.close()

        return {
            "vessel_imo":   vessel_imo,
            "vessel_name":  vessel_name,
            "report_code":  report_code,
            "report_name":  report_name,
            "department":   department,
            "frequency":    frequency,
            "job_order_no": job_order_no,
            "attachments":  attachments,
            "job_status":   "COMPLETED",
            "approved_by":  approved_by,
            "job_date":     job_date,
            "due_date":     due_date,
            "next_due_date": next_due_date,
            "job_start_date": job_start_date,
            "job_end_date": job_end_date,
            "job_type":     job_type,
            "job_category": job_category,
            "report_date":  report_date,
            "report_date_source": report_date_source,
        }

    except PlaywrightTimeout as e:
        logger.error(f"Timeout scraping {vessel_name}/{report_code}: {e}")
        _fail(f"Timed out during scraping: {e}")
    except Exception as e:
        logger.error(f"Error scraping {vessel_name}/{report_code}: {e}")
        _fail(f"Unhandled error during scraping: {e}")
    finally:
        if eq_page:
            try: await eq_page.close()
            except: pass
        if job_page:
            try: await job_page.close()
            except: pass
        if job_order_page:
            try: await job_order_page.close()
            except: pass
    return None


# ---------------------------------------------------------------------------
# DB Helpers
# ---------------------------------------------------------------------------

async def _save_report(db: AsyncSession, data: dict):
    try:
        stmt = select(Report).where(
            Report.vessel_imo == data["vessel_imo"],
            Report.report_code == data["report_code"],
            Report.job_order_no == data["job_order_no"]
        ).options(selectinload(Report.attachments))
        result = await db.execute(stmt)
        existing = result.scalars().first()

        if existing:
            # We already have this exact Job Order in the DB. Update it.
            existing.attachments.clear()
            for att in data.get("attachments", []):
                existing.attachments.append(ReportAttachment(
                    id=uuid4(),
                    file_name=att["file_name"],
                    blob_path=att["blob_path"]
                ))

            existing.report_name   = data["report_name"]
            existing.department    = data["department"]
            existing.frequency     = data["frequency"]
            existing.job_status    = data.get("job_status")
            existing.approved_by   = data.get("approved_by")
            existing.due_date      = data.get("due_date")
            existing.next_due_date = data.get("next_due_date")
            existing.job_start_date = data.get("job_start_date")
            existing.job_end_date  = data.get("job_end_date")
            existing.job_type      = data.get("job_type")
            existing.job_category  = data.get("job_category")
            # Only overwrite a previously-recovered report_date if this scrape
            # actually found one -- a re-scrape that fails to extract a date
            # (e.g. a transient parse error) must not blank out a good value
            # from an earlier run.
            if data.get("report_date") is not None:
                existing.report_date        = data.get("report_date")
                existing.report_date_source = data.get("report_date_source")

            existing.scrape_status = ScrapeStatus.SCRAPED
            existing.scrape_error  = None
            existing.updated_at    = datetime.utcnow()
            existing.verify_status = VerifyStatus.UNVERIFIED
            logger.info(f"Updated DB (existing job): {data['vessel_imo']}/{data['report_code']} -> {data['job_order_no']}")

        else:
            # This is a NEW job order (or pending row) for this report! Add a new row on top.
            new_report = Report(
                id=uuid4(),
                vessel_imo=data["vessel_imo"],
                vessel_name=data["vessel_name"],
                job_order_no=data["job_order_no"],
                report_code=data["report_code"],
                report_name=data["report_name"],
                department=data["department"],
                frequency=data["frequency"],
                job_status=data.get("job_status"),
                approved_by=data.get("approved_by"),
                due_date=data.get("due_date"),
                next_due_date=data.get("next_due_date"),
                job_start_date=data.get("job_start_date"),
                job_end_date=data.get("job_end_date"),
                job_type=data.get("job_type"),
                job_category=data.get("job_category"),
                report_date=data.get("report_date"),
                report_date_source=data.get("report_date_source"),
                scrape_status=ScrapeStatus.SCRAPED,
                verify_status=VerifyStatus.UNVERIFIED,
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow()
            )
            
            for att in data.get("attachments", []):
                new_report.attachments.append(ReportAttachment(
                    id=uuid4(),
                    file_name=att["file_name"],
                    blob_path=att["blob_path"]
                ))
            
            db.add(new_report)
            logger.info(f"Inserted NEW DB row: {data['vessel_imo']}/{data['report_code']} -> {data['job_order_no']}")

            # A prior failed scrape attempt for this vessel/report leaves a
            # placeholder row behind (job_order_no="N/A", scrape_status=FAILED --
            # see _mark_failed). It is matched on vessel_imo+report_code only,
            # never on job_order_no, so a later successful scrape (this branch)
            # was never able to find/update it -- it only ever matches by the
            # EXACT job_order_no, which the placeholder never has. That left a
            # stale FAILED row sitting in the inbox forever, sorted ABOVE the
            # new correctly-SCRAPED row (FAILED rows are surfaced first), even
            # though the report had genuinely succeeded on a re-run. Clean it
            # up now that we have real data for this vessel/report. .all()
            # (not .first()) because the pre-fix version of _mark_failed
            # could already have created more than one of these for the
            # same vessel/report before this fix went in -- clean up every
            # leftover, not just one.
            stmt_placeholder = select(Report).where(
                Report.vessel_imo == data["vessel_imo"],
                Report.report_code == data["report_code"],
                Report.job_order_no == "N/A",
            )
            placeholder_result = await db.execute(stmt_placeholder)
            placeholders = placeholder_result.scalars().all()
            for placeholder in placeholders:
                await db.delete(placeholder)
            if placeholders:
                logger.info(f"Removed {len(placeholders)} stale FAILED placeholder(s) for {data['vessel_imo']}/{data['report_code']}")

            # Activity Feed Event
            if data.get("is_smart_scrape", False):
                try:
                    from app.models.report import ReportEvent
                    
                    event_type = "NEW_REPORT"
                    desc = f"{data['report_name']} has a new completed submission ({data['job_order_no']})"
                    
                    if data.get("job_status") == "PENDING":
                        due_d = data.get("due_date")
                        if due_d and due_d < datetime.utcnow():
                            event_type = "MISSING_REPORT"
                            desc = f"{data['report_name']} is missing (overdue since {due_d.strftime('%d %b %Y')})"
                        else:
                            event_type = "PENDING_REPORT"
                            desc = f"{data['report_name']} is now pending submission"
                            
                    event = ReportEvent(
                        id=uuid4(),
                        vessel_imo=data["vessel_imo"],
                        vessel_name=data.get("vessel_name", data["vessel_imo"]),
                        report_id=new_report.id,
                        event_type=event_type,
                        description=desc,
                        source="SYSTEM",
                        author_name="System",
                        created_at=datetime.utcnow()
                    )
                    db.add(event)
                    logger.info(f"Created {event_type} feed event for vessel {data['vessel_imo']}")

                    # A MISSING_REPORT event also pings the bell/Notifications
                    # Feed for whoever is actually responsible for this vessel's
                    # reports, not just the passive Activity Feed. SHORE/Admin
                    # already see missing reports surfaced at the top of their
                    # main inbox (sorted by scrape_status=FAILED), so this is
                    # scoped to the vessel's own crew.
                    if event_type == "MISSING_REPORT":
                        try:
                            from app.core.database_control import ControlSession
                            from app.models.notification import Notification
                            from sqlalchemy import text as sql_text

                            async with ControlSession() as ctrl_db:
                                users_res = await ctrl_db.execute(
                                    sql_text(
                                        "SELECT u.id FROM users u "
                                        "JOIN user_vessel_link uvl ON uvl.user_id = u.id "
                                        "WHERE uvl.vessel_imo = :imo AND u.is_active = true"
                                    ),
                                    {"imo": data["vessel_imo"]}
                                )
                                recipient_ids = [row[0] for row in users_res.fetchall()]

                            for uid in recipient_ids:
                                db.add(Notification(
                                    id=uuid4(),
                                    user_id=str(uid),
                                    type="missing_report",
                                    title=f"Missing report — {data.get('vessel_name', data['vessel_imo'])}",
                                    body=desc,
                                    report_id=new_report.id,
                                    thread_id=None,
                                    is_read=False,
                                    created_at=datetime.utcnow(),
                                ))
                            if recipient_ids:
                                logger.info(f"Created {len(recipient_ids)} missing-report notification(s) for vessel {data['vessel_imo']}")
                        except Exception as e:
                            logger.warning(f"Failed to create missing-report notifications: {e}")
                except Exception as e:
                    logger.warning(f"Failed to create feed event: {e}")

        await db.commit()
    except Exception as e:
        await db.rollback()
        logger.error(f"DB save failed: {e}")


async def _mark_failed(db: AsyncSession, vessel_imo: str, report_code: str, error: str,
                        vessel_name: str = None, report_name: str = None):
    try:
        # Match ONLY our own placeholder row (job_order_no == "N/A"), never
        # any row for this vessel/report -- the old vessel_imo+report_code-only
        # match had no job_order_no filter and no ordering, so once a real
        # SCRAPED row existed alongside a leftover placeholder it could grab
        # either one, risking flipping an already-successful, real completed
        # report's status to FAILED just because a later unrelated attempt
        # failed. Only the placeholder should ever be touched here.
        stmt = select(Report).where(
            Report.vessel_imo == vessel_imo,
            Report.report_code == report_code,
            Report.job_order_no == "N/A",
        )
        result = await db.execute(stmt)
        existing = result.scalars().first()

        if existing:
            existing.scrape_status = ScrapeStatus.FAILED
            existing.scrape_error  = error
            existing.updated_at = datetime.utcnow()
        else:
            db.add(Report(
                id=uuid4(),
                vessel_imo=vessel_imo,
                vessel_name=vessel_name or vessel_imo,
                report_code=report_code,
                report_name=report_name or report_code,
                job_order_no="N/A",
                scrape_status=ScrapeStatus.FAILED,
                scrape_error=error,
                verify_status=VerifyStatus.UNVERIFIED,
            ))
        await db.commit()
    except Exception as e:
        await db.rollback()
        logger.error(f"Could not mark FAILED: {vessel_imo}/{report_code}: {e}")


if __name__ == "__main__":
    import argparse
    import asyncio
    import sys
    import os
    
    # Ensure project root is in PYTHONPATH
    sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")))
    
    import logging
    logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(levelname)-8s %(message)s")
    
    from app.core.database import SessionLocal
    
    parser = argparse.ArgumentParser(description="SmartPAL Scraper")
    parser.add_argument("--full", action="store_true", help="Run a full scrape for all configured reports")
    parser.add_argument("--vessel", type=str, default=None, help="Target a specific vessel (by name or IMO)")
    parser.add_argument("--reports", type=str, default=None, help="Comma separated report codes to target")
    
    args = parser.parse_args()
    
    async def main():
        if args.full or args.vessel or args.reports:
            async with SessionLocal() as db:
                await run_scraper(
                    db,
                    smart_cron=not args.full, # If --full is passed, disable smart_cron (run deep scrape)
                    target_vessel=args.vessel,
                    target_reports=args.reports
                )
        else:
            parser.print_help()
            
    asyncio.run(main())

