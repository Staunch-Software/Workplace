# =============================================================================
# test_pr_scraper.py — single vessel, date filtered, no DB writes
# =============================================================================

import logging
import time
from playwright.sync_api import sync_playwright

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger(__name__)

PR_URL      = "https://smartpal.ozellar.com/PurchasePALApp/Purchase/RequisitionApproval"
AUTH_JSON   = "app/scraper/auth.json"
TEST_VESSEL = "AM KIRTI"

# Narrow date range — just last 30 days for testing
FROM_DATE = "01-Mar-2026"
TO_DATE   = "01-Apr-2026"


def test_scrape():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        context = browser.new_context(storage_state=AUTH_JSON)
        page    = context.new_page()

        log.info("Navigating to PR page...")
        page.goto(PR_URL, wait_until="domcontentloaded", timeout=30000)
        page.wait_for_selector("input[aria-owns='vesselSearchBox_listbox']", timeout=20000)
        time.sleep(1)

        # ── Select vessel ──────────────────────────────────────────────
        vessel_input = page.locator("input[aria-owns='vesselSearchBox_listbox']").first
        vessel_input.click()
        page.keyboard.press("Control+A")
        page.keyboard.press("Backspace")
        vessel_input.press_sequentially(TEST_VESSEL, delay=100)
        time.sleep(0.8)
        page.locator(f"ul#vesselSearchBox_listbox li:has-text('{TEST_VESSEL}')").first.click()
        time.sleep(2)
        log.info(f"Vessel '{TEST_VESSEL}' selected.")

        # ── Enable date filter toggle ──────────────────────────────────
        log.info("Enabling date filter...")
        toggle = page.locator("input[type='checkbox'][id*='date' i], .toggle-switch, input[type='checkbox']").first
        if toggle.count() > 0:
            # Check if already enabled
            is_checked = toggle.is_checked()
            if not is_checked:
                toggle.click()
                time.sleep(1)
            log.info("Date filter toggle enabled.")
        else:
            # Try clicking the toggle label/slider
            page.evaluate("""() => {
                const labels = [...document.querySelectorAll('label, .toggle, .switch')];
                const dateLabel = labels.find(l => 
                    l.innerText.toLowerCase().includes('date') ||
                    l.className.toLowerCase().includes('date')
                );
                if (dateLabel) dateLabel.click();
            }""")
            time.sleep(1)

        # ── Inspect date input fields ──────────────────────────────────
        date_inputs = page.evaluate("""() => {
            return [...document.querySelectorAll('input[type="date"], input[id*="date" i], input[placeholder*="date" i], input[class*="date" i]')]
                .map(el => ({id: el.id, name: el.name, class: el.className, placeholder: el.placeholder, value: el.value, type: el.type}));
        }""")
        print("\n===== DATE INPUT FIELDS =====")
        for d in date_inputs:
            print(d)
        print("=============================\n")

        # ── Try to set date range ──────────────────────────────────────
        # Set via JS directly on whatever date inputs are available
        result = page.evaluate(f"""() => {{
            const inputs = [...document.querySelectorAll('input')];
            const fromInputs = inputs.filter(i => 
                i.id.toLowerCase().includes('from') || 
                i.name.toLowerCase().includes('from') ||
                i.placeholder.toLowerCase().includes('from')
            );
            const toInputs = inputs.filter(i => 
                i.id.toLowerCase().includes('to') || 
                i.name.toLowerCase().includes('to') ||
                i.placeholder.toLowerCase().includes('to')
            );
            return {{
                from_candidates: fromInputs.map(i => ({{id: i.id, name: i.name, placeholder: i.placeholder}})),
                to_candidates: toInputs.map(i => ({{id: i.id, name: i.name, placeholder: i.placeholder}}))
            }};
        }}""")
        print("\n===== DATE RANGE INPUT CANDIDATES =====")
        print(result)
        print("=======================================\n")

        # ── Click All tab ──────────────────────────────────────────────
        log.info("Clicking All tab...")
        page.evaluate("""() => {
            const spans = [...document.querySelectorAll('span')];
            const allSpan = spans.find(s => s.innerText.trim() === 'All');
            if (allSpan) {
                let el = allSpan;
                for (let i = 0; i < 5; i++) {
                    el = el.parentElement;
                    if (el && ['A','LI','BUTTON'].includes(el.tagName)) { el.click(); return; }
                }
            }
        }""")
        time.sleep(2)

        row_count = page.locator("tbody tr").count()
        log.info(f"Rows visible: {row_count}")

        # ── Extract first 5 rows ───────────────────────────────────────
        rows = page.evaluate("""() => {
            const tbodies = document.querySelectorAll('tbody');
            if (tbodies.length < 2) return [];
            const locked = [...tbodies[0].querySelectorAll('tr')];
            const scroll = [...tbodies[1].querySelectorAll('tr')];
            const results = [];
            for (let i = 0; i < Math.min(5, locked.length, scroll.length); i++) {
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
        print("\n===== SAMPLE ROWS =====")
        for r in rows:
            print(r)
        print("=======================\n")

        log.info("Browser open. Press ENTER to close.")
        input("Press ENTER to close...")
        browser.close()


if __name__ == "__main__":
    test_scrape()