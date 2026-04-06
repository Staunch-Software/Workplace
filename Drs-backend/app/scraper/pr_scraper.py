# =============================================================================
# app/scraper/pr_scraper.py
#
# Scrapes ALL vessels PR data from Mariapps in a single pass.
# Selects "ALL VESSELS" from dropdown — no per-vessel looping.
# Uses 500 items/page and stops when no new unique rows found.
#
# Called by: pr_scheduler.py every 6 hours
# =============================================================================

import os
import logging
import time
from playwright.sync_api import sync_playwright

log = logging.getLogger(__name__)

PR_URL    = "https://smartpal.ozellar.com/PurchasePALApp/Purchase/RequisitionApproval"
AUTH_JSON = os.getenv("MARIAPPS_AUTH_JSON_PATH", "app/scraper/auth.json")


SSO_CHALLENGE_URL = "https://SmartPAL.ozellar.com/AzureADAuth/Authenticate/Challenge"


def _handle_sso_signin(page, context):
    """
    Detects if Mariapps redirected to its own login page (PAL login needed).
    When this happens, navigates directly to the Azure AD SSO challenge URL.
    With Microsoft "Stay Signed In", this completes without credentials and
    lands at /Home/Landing. Then we navigate back to the PR page.
    Saves the refreshed session to auth.json so the next run works too.
    """
    try:
        time.sleep(1.5)

        # Check if we're on the PAL login page (not the PR app)
        sso_link = page.locator("a#winuseritem, a[href*='AzureADAuth']").first
        if not sso_link.count():
            return  # Already on the app, no sign-in needed

        log.info("[SSO] PAL login page detected. Triggering Azure AD SSO challenge...")
        page.goto(SSO_CHALLENGE_URL, wait_until="domcontentloaded", timeout=30000)

        # With "Stay Signed In", Microsoft redirects back to /Home/Landing automatically
        page.wait_for_url("**/Home/Landing**", timeout=60000)
        log.info("[SSO] SSO redirect complete. Landed at Home/Landing.")

        # Navigate back to the PR page now that the session is active
        page.goto(PR_URL, wait_until="domcontentloaded", timeout=30000)

        # Save the refreshed session so the next scheduled run works too
        context.storage_state(path=AUTH_JSON)
        log.info("[SSO] Session refreshed and saved to auth.json.")

    except Exception as e:
        # Truly expired (Microsoft session also gone) — outer wait_for_selector will handle it
        log.debug(f"[SSO] _handle_sso_signin: {e}")


def run_pr_scraper() -> list:
    """
    Entry point called by pr_scheduler.py.
    Scrapes all PRs for all vessels in one pass.
    Returns list of PR dicts.
    """
    seen = {}  # requisition_no → row (dedup)

    log.info("=" * 60)
    log.info("  Mariapps PR Scraper — Starting")
    log.info("=" * 60)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            context = browser.new_context(storage_state=AUTH_JSON)
            page    = context.new_page()

            # Navigate and handle SSO "Stay Signed In" click-through if needed
            page.goto(PR_URL, wait_until="domcontentloaded", timeout=30000)
            _handle_sso_signin(page, context)
            page.wait_for_selector("input[aria-owns='vesselSearchBox_listbox']", timeout=60000)
            time.sleep(1)

            # ── Select ALL VESSELS ─────────────────────────────────────
            log.info("Selecting ALL VESSELS...")
            vessel_input = page.locator("input[aria-owns='vesselSearchBox_listbox']").first
            vessel_input.click()
            page.keyboard.press("Control+A")
            page.keyboard.press("Backspace")
            time.sleep(0.5)
            page.locator("ul#vesselSearchBox_listbox li").first.click()
            time.sleep(2)
            log.info("ALL VESSELS selected.")

            # ── Click All tab ──────────────────────────────────────────
            page.evaluate("""() => {
                const s = [...document.querySelectorAll('span')].find(s => s.innerText.trim() === 'All');
                if (s) {
                    let el = s;
                    for (let i = 0; i < 5; i++) {
                        el = el.parentElement;
                        if (el && ['A','LI','BUTTON'].includes(el.tagName)) { el.click(); return; }
                    }
                }
            }""")
            time.sleep(2)

            # ── Set page size to 500 ───────────────────────────────────
            log.info("Setting page size to 500...")
            page.evaluate("""() => {
                const grids = $('.k-grid');
                if (grids.length > 0) {
                    const grid = grids.first().data('kendoGrid');
                    if (grid) { grid.dataSource.pageSize(500); return; }
                }
                const sel = document.querySelector('.k-pager-sizes select');
                if (sel) {
                    const opt = [...sel.options].find(o => o.value == '500' || o.text == '500');
                    if (opt) { sel.value = opt.value; $(sel).trigger('change'); }
                }
            }""")
            time.sleep(2)

            # ── Paginate and collect ───────────────────────────────────
            page_num    = 1
            stale_pages = 0
            MAX_STALE   = 2

            while True:
                prev_count = len(seen)
                log.info(f"Page {page_num} (unique so far: {prev_count})...")

                page_rows = page.evaluate("""() => {
                    const tbodies = document.querySelectorAll('tbody');
                    if (tbodies.length < 2) return [];
                    const locked = [...tbodies[0].querySelectorAll('tr')];
                    const scroll = [...tbodies[1].querySelectorAll('tr')];
                    const results = [];
                    for (let i = 0; i < Math.min(locked.length, scroll.length); i++) {
                        const lc = [...locked[i].querySelectorAll('td')].map(td => td.innerText.trim());
                        const sc = [...scroll[i].querySelectorAll('td')].map(td => td.innerText.trim());
                        const reqNo = lc[10] || '';
                        if (!reqNo || !reqNo.includes('/')) continue;
                        results.push({
                            requisition_no: reqNo,
                            vessel_name:    sc[0]  || '',
                            approved_date:  sc[5]  || '',
                            created_by:     sc[16] || '',
                            stage:          sc[19] || '',
                            status:         sc[21] || '',
                        });
                    }
                    return results;
                }""")

                for r in page_rows:
                    req = r.get("requisition_no", "")
                    if req and req not in seen:
                        seen[req] = r

                new_count = len(seen)
                log.info(f"Page {page_num}: {len(page_rows)} rows, {new_count} unique total.")

                if new_count == prev_count:
                    stale_pages += 1
                    log.info(f"No new rows (stale {stale_pages}/{MAX_STALE})")
                    if stale_pages >= MAX_STALE:
                        log.info("Stopping — all rows collected.")
                        break
                else:
                    stale_pages = 0

                result = page.evaluate("""() => {
                    const btn = document.querySelector('a.k-link.k-pager-nav[title="Go to the next page"]');
                    if (!btn) return 'NOT_FOUND';
                    if (btn.parentElement && btn.parentElement.classList.contains('k-state-disabled')) return 'DISABLED';
                    btn.click();
                    return 'CLICKED';
                }""")
                if result != 'CLICKED':
                    log.info("Last page reached.")
                    break

                time.sleep(1.5)
                page_num += 1

        except Exception as e:
            log.error(f"Scraper error: {e}", exc_info=True)
        finally:
            browser.close()
            log.info("[BROWSER] Closed.")

    results = list(seen.values())
    log.info(f"Scrape complete. Total unique PRs: {len(results)}")
    log.info("=" * 60)
    return results