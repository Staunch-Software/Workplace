# =============================================================================
# app/scraper/generate_auth.py
#
# Run this ONCE to generate auth.json for the PR scraper.
# Login manually, then press ENTER — session is saved to auth.json.
#
# Usage (from project root):
#   python app/scraper/generate_auth.py
# =============================================================================

import logging
from pathlib import Path
from playwright.sync_api import sync_playwright

logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)

PR_URL    = "https://smartpal.ozellar.com/PurchasePALApp/Purchase/RequisitionApproval"
AUTH_PATH = Path(__file__).parent / "auth.json"


def generate_session():
    log.info("Starting browser for manual login...")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        context = browser.new_context()
        page    = context.new_page()

        log.info(f"Navigating to: {PR_URL}")
        try:
            page.goto(PR_URL, wait_until="domcontentloaded", timeout=90000)
        except Exception as e:
            log.warning(f"Initial load timed out, proceeding to manual login: {e}")

        print("\n" + "=" * 50)
        print("ACTION REQUIRED:")
        print("1. Log in to Mariapps manually in the browser.")
        print("2. Complete SSO / MFA if prompted.")
        print("3. Once you see the Requisition page, press ENTER here.")
        print("=" * 50 + "\n")

        input("Press ENTER after successful login...")

        context.storage_state(path=str(AUTH_PATH))
        log.info(f"Auth session saved to: {AUTH_PATH}")
        browser.close()


if __name__ == "__main__":
    generate_session()