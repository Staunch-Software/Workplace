# =============================================================================
# test_pr_db.py — ALL VESSELS, deduplicated, stops when no new rows
# =============================================================================

import asyncio
import logging
import time
from playwright.sync_api import sync_playwright

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger(__name__)

PR_URL    = "https://smartpal.ozellar.com/PurchasePALApp/Purchase/RequisitionApproval"
AUTH_JSON = "app/scraper/auth.json"


def scrape_all_vessels() -> list:
    seen = {}

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(storage_state=AUTH_JSON)
        page    = context.new_page()

        page.goto(PR_URL, wait_until="domcontentloaded", timeout=30000)
        page.wait_for_selector("input[aria-owns='vesselSearchBox_listbox']", timeout=20000)
        time.sleep(1)

        # Select ALL VESSELS
        log.info("Selecting ALL VESSELS...")
        vessel_input = page.locator("input[aria-owns='vesselSearchBox_listbox']").first
        vessel_input.click()
        page.keyboard.press("Control+A")
        page.keyboard.press("Backspace")
        time.sleep(0.5)
        page.locator("ul#vesselSearchBox_listbox li").first.click()
        time.sleep(2)

        # Click All tab
        page.evaluate("""() => {
            const s = [...document.querySelectorAll('span')].find(s => s.innerText.trim() === 'All');
            if (s) { let el = s; for (let i=0;i<5;i++) { el=el.parentElement; if(el&&['A','LI','BUTTON'].includes(el.tagName)){el.click();return;} } }
        }""")
        time.sleep(2)

        # Try setting page size via Kendo widget API
        log.info("Setting page size to 500 via Kendo...")
        page.evaluate("""() => {
            const grids = $('.k-grid');
            if (grids.length > 0) {
                const grid = grids.first().data('kendoGrid');
                if (grid) { grid.dataSource.pageSize(500); return; }
            }
            // Fallback: click the select and pick 500
            const sel = document.querySelector('.k-pager-sizes select');
            if (sel) {
                const opt = [...sel.options].find(o => o.value == '500' || o.text == '500');
                if (opt) { sel.value = opt.value; $(sel).trigger('change'); }
            }
        }""")
        time.sleep(2)

        # Scrape with early stop when no new unique rows found
        page_num   = 1
        stale_pages = 0
        MAX_STALE  = 2  # stop after 2 pages with zero new rows

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

            # Stop if no new rows found
            if new_count == prev_count:
                stale_pages += 1
                log.info(f"No new rows (stale {stale_pages}/{MAX_STALE})")
                if stale_pages >= MAX_STALE:
                    log.info("Stopping — no new unique rows.")
                    break
            else:
                stale_pages = 0

            # Next page
            result = page.evaluate("""() => {
                const btn = document.querySelector('a.k-link.k-pager-nav[title="Go to the next page"]');
                if (!btn) return 'NOT_FOUND';
                if (btn.parentElement && btn.parentElement.classList.contains('k-state-disabled')) return 'DISABLED';
                btn.click();
                return 'CLICKED';
            }""")
            if result != 'CLICKED':
                log.info(f"Last page. Done.")
                break

            time.sleep(1.5)
            page_num += 1

        browser.close()

    return list(seen.values())


async def save_and_sync(rows: list):
    from app.scraper.pr_sync_service import upsert_to_cache, sync_to_pr_entries
    log.info(f"Upserting {len(rows)} rows to cache...")
    cache_summary = await upsert_to_cache(rows)
    log.info(f"Cache: {cache_summary}")
    sync_summary = await sync_to_pr_entries()
    log.info(f"Sync: {sync_summary}")


if __name__ == "__main__":
    rows = scrape_all_vessels()
    log.info(f"Total unique PRs: {len(rows)}")
    print("\nSAMPLE (first 3):")
    for r in rows[:3]:
        print(r)
    if rows:
        asyncio.run(save_and_sync(rows))
        log.info("Done. Check mariapps_pr_cache and pr_entries tables.")
    else:
        log.warning("No rows scraped.")