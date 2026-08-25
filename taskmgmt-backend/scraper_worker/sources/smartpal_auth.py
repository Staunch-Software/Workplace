"""SmartPAL login + session capture.

Ported from a working reference implementation (TD Command Center, lib/smartpal-auth.ts),
with one deliberate deviation: that reference logs in via Microsoft SSO (#winuseritem ->
Azure AD form). Ozellar's own account is NOT federated that way — a live screenshot of
smartpal.ozellar.com's homepage confirmed it only has a plain "OTHER USERS" username/password
form for this account (no working Microsoft-tile path), which is what login() below uses.
Everything downstream matches the reference:

- No session persistence. Fresh login every run — SmartPAL sessions expire in ~20 min
  (window.formsAuthenticationTimeOut on the page), so there's nothing worth caching.
- Sub-app entry is a plain page.goto() to that app's landing URL followed by a flat sleep —
  that goto+sleep IS the handshake that gets the per-app session cookie set server-side,
  there's no separate confirmation call. (This replaces an earlier, wrong assumption that
  window.userSessionId needed re-polling per app — a real HAR showed that value is actually
  set once at login and one specific sub-app, MDMPALApp, needs its own warm-nav for a
  different reason: the per-app session cookie, not the s_key value.)
- CertificationPALApp (CER) is confirmed cookie-only: a hardcoded s_key "0" works identically
  to a real session key (verified live in the reference, same counts across every category).
- The browser is closed right after login; everything after that is a plain httpx call
  carrying the captured Cookie header (see smartpal_client.py) — no further Playwright use.
"""
import logging
from decouple import config
from playwright.sync_api import sync_playwright

logger = logging.getLogger(__name__)

SMARTPAL_BASE_URL = config("SMARTPAL_BASE_URL", default="https://smartpal.ozellar.com")
SMARTPAL_USERNAME = config("SMARTPAL_USERNAME")
SMARTPAL_PASSWORD = config("SMARTPAL_PASSWORD")

# Static per-company headers, confirmed from HAR captures (Ozellar Marine's SmartPAL account)
COMPANY_HEADERS = {
    "v_cmpid": "966741",
    "v_coid": "966741",
    "v_coname": "OZM",
    "iscompanyfilteractive": "false",
}

# app_code -> s_key. CER is confirmed cookie-only: hardcoded "0" works regardless. MDM has
# 401'd on every combination tried so far (hardcoded "0", navigation-based warm, and a real
# session value — which turned out to be empty on this account's Home page anyway). Keeping
# "0" here since it's at least equally valid to any of the others tried.
S_KEY_BY_APP = {
    "CER": "0",
    "MDM": "0",
}

# The reference implementation warms MaintenancePALApp/Maintenance/JobOverview
# UNCONDITIONALLY right after login, every run — not just when PMS data is needed — "so the
# ServiceRouter accepts PMS calls". We'd skipped this since we don't need Maintenance data,
# but it may be establishing session-wide server state other sub-apps' guards (MDM's
# included) depend on. Doing exactly what the reference does, in the order it does it, before
# assuming MDM needs something else entirely.
UNCONDITIONAL_WARM_PATH = "MaintenancePALApp/Maintenance/JobOverview"

# Sub-apps that need their OWN additional goto+sleep warm-nav beyond the unconditional one
# above. Empty for now — direct navigation into MDMPALApp itself only ever made things worse
# (bare root 500s, its real Vessel Register page 401-redirects back to login).
WARM_PATHS = {}


class SmartPalSession:
    def __init__(self, base_url, cookie_header, real_s_key):
        self.base = base_url
        self.cookie_header = cookie_header
        self.real_s_key = real_s_key

    def enter_app(self, app_code: str):
        s_key = S_KEY_BY_APP.get(app_code)
        if s_key is None:
            s_key = self.real_s_key
        return {**COMPANY_HEADERS, "app_code": app_code, "s_key": s_key}


def login(headless=True) -> SmartPalSession:
    playwright = sync_playwright().start()
    browser = playwright.chromium.launch(headless=headless, args=["--no-sandbox"])
    context = browser.new_context()
    page = context.new_page()

    page.goto(f"{SMARTPAL_BASE_URL}/Home", wait_until="domcontentloaded", timeout=60000)
    page.wait_for_load_state("networkidle")

    # "OTHER USERS" block on the homepage — plain username/password form, distinct from
    # the Microsoft SSO tile above it. Fields are identified by placeholder text, not
    # <label>, per the real screenshot.
    page.get_by_placeholder("Email address or Username").fill(SMARTPAL_USERNAME)
    page.get_by_placeholder("Password").fill(SMARTPAL_PASSWORD)
    # exact=True: the Microsoft SSO tile above also renders "SIGN IN" as its heading text
    # (with "Login with your Microsoft account" as a subtitle inside the same link), so a
    # loose match would hit two elements.
    page.get_by_role("button", name="SIGN IN", exact=True).click()
    page.wait_for_load_state("networkidle")

    if "smartpal.ozellar.com" not in page.url:
        browser.close()
        playwright.stop()
        raise RuntimeError(f"SmartPAL login did not land back on the app (landed on {page.url}) — check credentials/selectors")

    logger.info("SmartPAL login succeeded, landed on %s", page.url)

    real_s_key = str(page.evaluate("window.userSessionId") or "")
    logger.info("SmartPAL real s_key=%r (unused for now — came back empty on this account)", real_s_key)

    # Unconditional warm, matching the reference exactly — every run, not just when
    # Maintenance data is needed.
    page.goto(f"{SMARTPAL_BASE_URL}/{UNCONDITIONAL_WARM_PATH}", wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(4000)
    logger.info("Unconditional warm (%s), landed on %s", UNCONDITIONAL_WARM_PATH, page.url)

    # Warm every sub-app that needs its own per-app session cookie before the ServiceRouter
    # trusts requests to it. The goto + flat sleep IS the handshake — no separate call.
    for app_code, app_path in WARM_PATHS.items():
        page.goto(f"{SMARTPAL_BASE_URL}/{app_path}", wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(4000)
        logger.info("Warmed %s (%s), landed on %s", app_code, app_path, page.url)

    raw_cookies = context.cookies()
    cookies = [c for c in raw_cookies if "ozellar.com" in c["domain"]]
    if not cookies:
        browser.close()
        playwright.stop()
        raise RuntimeError("SmartPAL login: logged in but captured 0 ozellar.com cookies")
    cookie_header = "; ".join(f"{c['name']}={c['value']}" for c in cookies)

    browser.close()
    playwright.stop()
    return SmartPalSession(SMARTPAL_BASE_URL, cookie_header, real_s_key)
