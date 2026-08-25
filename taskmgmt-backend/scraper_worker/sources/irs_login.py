"""IRClass portal login + fleet list + Ship Survey Status report download.

Login confirmed from a real screenshot of the live homepage: the form is NOT inline on
the page — it's a "Member Login" popup/modal that only appears after clicking a
"MEMBER LOGIN" button first (top-left banner). Once open, it's a plain form POST, not a
B2C/OAuth flow: "User Name" + "Password" + a "LOGIN" button.
    POST /umbraco/Surface/Home/MemberLogin   body: UserName=...&Password=...
    -> 302 redirect to /Dashboard/

That dashboard page embeds `UserId` and `LoginId` directly in inline JS
(`var UserId = '7137'; var LoginId = 'ozellar_marine';`), which the fleet-list call needs:
    GET /Umbraco/Api/GetShipDetails/GetShipDetailsJson?LoginId={LoginId}&UserId={UserId}&type=1
    -> [{"SHIP_NAME","IRS_IR_NUMBER","IR_NUMBER"}, ...]  — NOTE: no IMO here, hence the
       exact-then-fuzzy name match in vessel_resolution.resolve_irs, confirmed via the
       downloaded report's own IMO field.

Report download is a plain GET, no click-through needed:
    GET /umbraco/Surface/Home/GetShipSurveyStatuspdf/{IR_NUMBER}   -> application/pdf
"""
import logging
import os
import re
from decouple import config
from playwright.sync_api import sync_playwright

logger = logging.getLogger(__name__)

IRS_HOMEPAGE_URL = config("IRS_HOMEPAGE_URL", default="https://www.irclass.org/")
IRS_USERNAME = config("IRS_USERNAME")
IRS_PASSWORD = config("IRS_PASSWORD")
IRS_BASE_URL = "https://www.irclass.org"


def login(headless=True):
    playwright = sync_playwright().start()
    browser = playwright.chromium.launch(headless=headless)
    context = browser.new_context(accept_downloads=True)
    page = context.new_page()

    page.goto(IRS_HOMEPAGE_URL)
    page.wait_for_load_state("load", timeout=30000)

    # The login form lives inside a modal, not inline on the page — open it first.
    try:
        # "MEMBER LOGIN" may render as a styled <a> rather than a real <button> — try
        # button role first, fall back to link, then a plain text match as a last resort.
        opener = page.get_by_role("button", name="MEMBER LOGIN", exact=False)
        if opener.count() == 0:
            opener = page.get_by_role("link", name="MEMBER LOGIN", exact=False)
        if opener.count() == 0:
            opener = page.get_by_text("MEMBER LOGIN", exact=False)
        # The header's logo <img> visually overlaps this link and intercepts normal pointer
        # events (confirmed from a real run's actionability log — 31 retries, same overlap
        # every time) — force bypasses the hit-test since we know the link itself is present
        # and enabled, just occluded by decorative chrome.
        opener.first.click(timeout=15000, force=True)
        try:
            page.get_by_label("User Name").wait_for(timeout=5000, state="visible")
        except Exception:
            # The force-click can fire the DOM click event without the Bootstrap modal
            # plugin actually running (observed: field stayed reported as hidden for the
            # full wait) — trigger the modal directly via jQuery as a fallback.
            logger.info("MEMBER LOGIN click didn't open the modal — forcing it via jQuery")
            page.evaluate("() => { if (window.jQuery) jQuery('#loginModal').modal('show'); }")
            page.get_by_label("User Name").wait_for(timeout=10000, state="visible")
    except Exception:
        shot = os.path.join(config("DOWNLOAD_DIR", default="./downloads"), "irs_login_debug.png")
        os.makedirs(os.path.dirname(shot), exist_ok=True)
        page.screenshot(path=shot)
        logger.error("IRS 'MEMBER LOGIN' opener not found as expected — saved a screenshot to %s, landed on %s", shot, page.url)
        raise

    page.get_by_label("User Name").fill(IRS_USERNAME)
    page.get_by_label("Password").fill(IRS_PASSWORD)
    page.get_by_role("button", name="LOGIN", exact=False).click()

    page.wait_for_load_state("networkidle", timeout=30000)

    if "Dashboard" not in page.url:
        raise RuntimeError(f"IRS login did not land on /Dashboard/ (landed on {page.url})")

    logger.info("IRS login succeeded, landed on %s", page.url)
    return playwright, browser, context, page


def close_session(playwright, browser, context):
    """Full teardown to match login()'s full setup. Callers that only closed `context`
    (e.g. an earlier version of irs_extract.py's per-vessel loop) leaked the browser process
    and the Playwright driver — calling login() again in that state crashed with
    "Playwright Sync API inside the asyncio loop" because a second sync_playwright().start()
    can't coexist with one that was never stopped."""
    try:
        context.close()
    finally:
        try:
            browser.close()
        finally:
            playwright.stop()


def get_session_ids(page):
    """UserId/LoginId are embedded in inline JS on the post-login dashboard page —
    confirmed real values look like: var UserId = '7137'; var LoginId = 'ozellar_marine';"""
    content = page.content()
    user_id_match = re.search(r"var\s+UserId\s*=\s*'([^']+)'", content)
    login_id_match = re.search(r"var\s+LoginId\s*=\s*'([^']+)'", content)
    if not user_id_match or not login_id_match:
        raise RuntimeError("Could not find UserId/LoginId in the IRS dashboard page — page structure may have changed")
    return login_id_match.group(1), user_id_match.group(1)


def get_fleet(page):
    """Confirmed real endpoint. No IMO in the response — see vessel_resolution.resolve_irs
    for the exact-then-fuzzy name match + IMO-confirmation-via-PDF this requires."""
    login_id, user_id = get_session_ids(page)
    url = f"{IRS_BASE_URL}/Umbraco/Api/GetShipDetails/GetShipDetailsJson"
    res = page.request.get(url, params={"LoginId": login_id, "UserId": user_id, "type": "1"})
    if res.status != 200:
        raise RuntimeError(f"IRS GetShipDetailsJson failed: {res.status} {res.text()[:300]}")
    return res.json().get("ShipDetailresult", [])


def download_survey_status_report(page, ir_number, download_dir):
    """Confirmed real endpoint: GET /umbraco/Surface/Home/GetShipSurveyStatuspdf/{IR_NUMBER}.

    IMPORTANT — confirmed live across THREE separate full-fleet runs, the last one with a
    completely fresh login (new browser context, new session) per vessel: the exact same 3
    IR_NUMBERs (46276, 63974, 63973) 500 every single time, and the exact same 1 IR_NUMBER
    (70903) succeeds every single time — regardless of session freshness, wait time between
    attempts (tried up to 90s), or warm navigation before the request. That rules out timing,
    session state, and server load entirely: this is a deterministic, per-vessel server-side
    report-generation failure on IRS's own end (most likely something in those 3 ships' data
    that their report generator chokes on), not anything fixable from the client side. The
    short retry below is just a safety net for a genuine one-off network blip — don't extend
    it further expecting it to fix these specific vessels; it won't. If this needs resolving,
    it likely requires contacting IRS about those 3 IR_NUMBERs, or checking the report in
    their own portal UI to see if it fails there too."""
    os.makedirs(download_dir, exist_ok=True)
    url = f"{IRS_BASE_URL}/umbraco/Surface/Home/GetShipSurveyStatuspdf/{ir_number}"
    last_error = None
    for attempt in range(1, 3):
        try:
            res = page.request.get(url, timeout=60000)
        except Exception as e:
            # Network-level failure (e.g. a client-side timeout) — worth one quick retry.
            last_error = str(e)
            logger.warning("IRS report download attempt %d for IR_NUMBER %s failed (%s) — retrying in 10s",
                            attempt, ir_number, last_error)
            page.wait_for_timeout(10000)
            continue

        if res.status == 200:
            path = os.path.join(download_dir, f"irs_{ir_number}_survey_status_report.pdf")
            with open(path, "wb") as f:
                f.write(res.body())
            logger.info("IRS report saved to %s", path)
            return path

        last_error = f"{res.status} {res.text()[:200]}"
        if res.status < 500:
            # A real client error (4xx) — retrying won't help, fail immediately.
            raise RuntimeError(f"IRS report download failed for IR_NUMBER {ir_number}: {last_error}")
        logger.warning("IRS report download attempt %d for IR_NUMBER %s got %s — retrying in 10s",
                        attempt, ir_number, last_error)
        page.wait_for_timeout(10000)

    raise RuntimeError(f"IRS report download failed for IR_NUMBER {ir_number} after 2 attempts: {last_error}")
