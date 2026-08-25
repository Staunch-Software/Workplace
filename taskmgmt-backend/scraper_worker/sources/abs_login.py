"""ABS MyFreedom / Eagle portal login + fleet list + Vessel Status Report download.

Ported from a working reference implementation (TD Command Center, lib/abs-auth.ts), with one
deliberate deviation: instead of navigating straight to a hardcoded B2C authorize URL with a
static code_challenge, this keeps our own already-confirmed-working approach of going to
{ABS_BASE_URL}/portal/ and letting the app build its own PKCE redirect — that was verified
live to reach the real login form (the hardcoded-URL approach is unverified against this
account and reuses a PKCE challenge captured from a different session).

This account's B2C policy (b2c_1a_abs_signin_mfa) is genuinely MFA-gated — there is no MFA-free
service account, and no way to solve an OTP challenge programmatically. The fix is avoiding the
MFA prompt entirely via B2C's own trusted-device mechanism: persisting the browser's
storage_state() (which carries the trusted-device SSO cookie) lets B2C silently skip the MFA
step on later logins, as long as that state isn't stale. The FIRST run must be done with
--headed so a human can complete the MFA challenge once and establish that trusted-device
cookie; every run after that reuses the persisted state file. Username/password are still
submitted fresh every run — only the MFA-skip cookie is persisted, not a full session.

Auth for API calls is a Bearer token (MSAL.js SPA), not a cookie — sniffed off the page's own
outgoing requests during login, with a sessionStorage/localStorage scan as a fallback. The
browser is closed right after login; fleet list and report download are plain Bearer-authed
httpx calls, no more page.request.
"""
import json
import logging
import os
import time
import httpx
from decouple import config
from playwright.sync_api import sync_playwright

logger = logging.getLogger(__name__)

ABS_USERNAME = config("ABS_USERNAME")
ABS_PASSWORD = config("ABS_PASSWORD")
ABS_BASE_URL = "https://www.eagle.org"

STATE_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "abs_browser_state.json")

FLEET_LIST_URL = (
    f"{ABS_BASE_URL}/portalproxy/mxacmproxy/os/ABSAPIPRTLVSLSTATCNT"
    "?lean=1&_dropnulls=0&&collectioncount=1&ignorecollectionref=1&oslc.select=*"
    "&pageno=1&oslc.pageSize=50&oslc.where=portfolio_id=0&oslc.orderBy=%2Bvessel_name&_lang=en-EN"
)

MFA_HINTS = [
    "verification code", "we've sent", "we have sent", "authenticator",
    "enter the code", "two-factor", "one-time pass",
]


class AbsMfaRequiredError(RuntimeError):
    pass


class AbsSession:
    def __init__(self, base_url, token):
        self.base = base_url
        self.token = token


def check_abs_session_state():
    """Pre-flight check callers can use to warn before attempting a headless run."""
    if not os.path.exists(STATE_FILE):
        return {"ok": False, "present": False, "age_hours": None,
                "message": "ABS trusted-device session file missing — run with --headed once to establish it."}
    age_hours = (time.time() - os.path.getmtime(STATE_FILE)) / 3600
    ok = age_hours < 30 * 24  # trusted-device cookies are long-lived but not forever
    return {"ok": ok, "present": True, "age_hours": age_hours,
            "message": None if ok else "ABS trusted-device session is stale — re-authenticate with --headed."}


def _extract_token_from_storage(page, retries=2):
    # A stray client-side redirect can destroy the execution context mid-evaluate (confirmed
    # from a real run) — retry rather than letting that crash the whole login.
    for attempt in range(retries + 1):
        try:
            return _extract_token_from_storage_once(page)
        except Exception as e:
            if attempt == retries:
                logger.warning("Token extraction failed after retries: %s", e)
                return None
            page.wait_for_timeout(1500)


def _extract_token_from_storage_once(page):
    return page.evaluate("""() => {
        for (const store of [window.sessionStorage, window.localStorage]) {
            for (let i = 0; i < store.length; i++) {
                const key = store.key(i) || "";
                if (!/idtoken|accesstoken/i.test(key)) continue;
                try {
                    const val = JSON.parse(store.getItem(key));
                    if (val && val.secret && val.secret.length > 100) return val.secret;
                } catch (e) {}
            }
        }
        return null;
    }""")


def _page_has_mfa_prompt(page):
    body_text = (page.inner_text("body") or "").lower()
    return any(hint in body_text for hint in MFA_HINTS)


def _wait_out_mfa_interactively(page, timeout_seconds=180):
    """Give a human up to `timeout_seconds` to actually complete the MFA challenge on screen
    (only meaningful when headless=False) instead of detecting it and immediately aborting —
    that was a real bug: --headed still raised the instant MFA was detected, before a human
    had any chance to act on it. Polls for either the URL reaching /portal/ or the MFA text
    disappearing from the page."""
    logger.warning(
        "ABS is showing an MFA/OTP prompt — complete it in the browser window now. "
        "Waiting up to %ds...", timeout_seconds
    )
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        page.wait_for_timeout(2000)
        if "/portal/" in page.url or not _page_has_mfa_prompt(page):
            logger.info("MFA challenge appears resolved, continuing")
            return True
    return False


def login(headless=True) -> AbsSession:
    playwright = sync_playwright().start()
    browser = playwright.chromium.launch(headless=headless, args=["--no-sandbox"])
    context = browser.new_context(
        storage_state=STATE_FILE if os.path.exists(STATE_FILE) else None,
    )
    page = context.new_page()

    token_holder = {"token": None}

    def on_request(req):
        auth = req.headers.get("authorization", "")
        if not token_holder["token"] and auth.startswith("Bearer ") and len(auth) > 120:
            token_holder["token"] = auth[7:]

    page.on("request", on_request)
    page.on("console", lambda msg: print(f"ABS CONSOLE: {msg.text}"))
    page.on("pageerror", lambda err: print(f"ABS PAGEERROR: {err}"))

    # Same PKCE issue DNV had — a bare authorize URL is missing the code_challenge a SPA
    # generates client-side. Go to the app root and let it build the redirect itself
    # (confirmed live: this reaches the real login form with a valid code_challenge).
    page.goto(f"{ABS_BASE_URL}/portal/", wait_until="domcontentloaded", timeout=60000)
    try:
        # networkidle is inherently unreliable here — the portal opens a persistent
        # LaunchDarkly SSE stream (clientstream.launchdarkly.com) that never closes,
        # confirmed live to sometimes prevent networkidle from firing at all within any
        # timeout. "load" (confirmed firing quickly and reliably) plus the flat 4s settle
        # wait just below carries the actual burden of letting the shell app finish booting.
        page.wait_for_load_state("networkidle", timeout=30000)
    except Exception:
        pass

    # The shell app doesn't redirect to B2C login immediately — it loads first (1MB+ of JS,
    # confirmed via a real run), then decides client-side whether to redirect, a few seconds
    # after networkidle already fired. Checking page.url right away is a race: it still reads
    # /portal/ even though the app is about to navigate away. Give it a moment and re-check,
    # since acting on the stale URL crashed a later page.evaluate() with "Execution context
    # was destroyed" mid-navigation.
    page.wait_for_timeout(4000)
    try:
        page.wait_for_load_state("networkidle", timeout=15000)
    except Exception:
        pass
    logger.info("ABS: after settling, url=%s, body length=%d", page.url, len(page.content() or ""))

    if "/portal/" not in page.url:
        if _page_has_mfa_prompt(page):
            if not headless and _wait_out_mfa_interactively(page):
                pass
            else:
                browser.close()
                playwright.stop()
                raise AbsMfaRequiredError(
                    "ABS trusted-device session expired — B2C is requesting MFA. Run with "
                    "--headed and complete the MFA challenge once within 3 minutes; the "
                    "resulting trusted-device state will be persisted so future runs skip it."
                )

        # Confirmed real ids from a live DOM inspection: input#signInName (Username) and a
        # plain password input, plus a second, unrelated "LOG IN WITH SMART CARD" button
        # whose accessible name also contains "LOG IN" — exact=True avoids matching both.
        # (Only fill these if we're not already past login — the interactive MFA wait above
        # can land us straight on /portal/, in which case there's no username/password step
        # left to do.)
        if "/portal/" not in page.url:
            page.locator("#signInName").wait_for(timeout=20000)
            page.locator("#signInName").fill(ABS_USERNAME)
            page.locator('input[type="password"]').first.fill(ABS_PASSWORD)
            page.get_by_role("button", name="LOG IN", exact=True).click()

            page.wait_for_timeout(8000)

        if _page_has_mfa_prompt(page):
            if headless or not _wait_out_mfa_interactively(page):
                browser.close()
                playwright.stop()
                raise AbsMfaRequiredError(
                    "ABS is requesting MFA/OTP — this can't be solved programmatically in "
                    "headless mode. Run with --headed and complete it manually within 3 "
                    "minutes; the trusted-device cookie will then be persisted so future "
                    "runs skip it."
                )

    if not token_holder["token"]:
        token_holder["token"] = _extract_token_from_storage(page)
    # Poll rather than a single fixed wait — the trusted-device path (skips the interactive
    # form entirely, confirmed live) lands straight on the OAuth callback URL with the code
    # still unexchanged in the fragment, and MSAL's background token exchange takes a
    # variable amount of time from there; a single fixed 3s wait tuned for the interactive
    # path's timing wasn't enough for this one.
    attempts = 0
    while not token_holder["token"] and attempts < 10:
        page.wait_for_timeout(1500)
        token_holder["token"] = _extract_token_from_storage(page)
        attempts += 1

    if not token_holder["token"]:
        debug_dir = os.getenv("DOWNLOAD_DIR", "./downloads")
        os.makedirs(debug_dir, exist_ok=True)
        shot = os.path.join(debug_dir, "abs_no_token_debug.png")
        try:
            page.screenshot(path=shot, full_page=True)
        except Exception:
            pass
        browser.close()
        playwright.stop()
        raise RuntimeError(
            f"ABS login: could not obtain a Bearer token from requests or storage "
            f"(landed on {page.url}) — see {shot}"
        )

    try:
        with open(STATE_FILE, "w") as f:
            json.dump(context.storage_state(), f, indent=2)
    except Exception:
        logger.warning("Could not persist ABS trusted-device state — MFA may be required again next run")

    logger.info("ABS login succeeded, landed on %s", page.url)
    browser.close()
    playwright.stop()
    return AbsSession(ABS_BASE_URL, token_holder["token"])


def get_fleet(session: AbsSession):
    """Confirmed real endpoint — an IBM Maximo/OSLC API. Returns imo_num + assetnum
    directly, used for direct-IMO resolution (vessel_resolution.resolve_abs), no fuzzy
    matching needed."""
    res = httpx.get(FLEET_LIST_URL, headers={"Authorization": f"Bearer {session.token}"}, timeout=30, verify=False)
    if res.status_code != 200:
        raise RuntimeError(f"ABS GetFleet failed: {res.status_code} {res.text[:300]}")
    return res.json().get("member", [])


def download_vessel_status_report(session: AbsSession, assetnum, download_dir):
    """Confirmed real endpoint: POST /portalproxy/reports/pdf?report=Vessel Status Report/Owner&...
    (query params kept as originally confirmed from a real Ozellar HAR — a reference
    implementation for a different account uses slightly different param values, e.g.
    AssetSelection=With Asset vs our confirmed Without Asset, which may just reflect a
    different report variant). The server generates the PDF on demand and can return a 200
    with an HTML/error payload mid-generation, so validate the response is actually a PDF
    before accepting it."""
    os.makedirs(download_dir, exist_ok=True)
    params = {
        "report": "Vessel Status Report/Owner",
        "VesselAssetNumFilter": assetnum,
        "AssetSelection": "Without Asset",
        "CompartmentSelection": "1",
        "Memoranda": "Owner",
        "IsRelationship": "0",
        "VAR": "1",
    }
    url = f"{session.base}/portalproxy/reports/pdf"
    last_error = None
    for attempt in range(1, 4):
        try:
            res = httpx.post(url, params=params, headers={"Authorization": f"Bearer {session.token}"},
                              content=b"", timeout=150, verify=False)
            buf = res.content
            if res.status_code == 200 and len(buf) >= 1000 and buf[:4] == b"%PDF":
                path = os.path.join(download_dir, f"abs_{assetnum}_vessel_status_report.pdf")
                with open(path, "wb") as f:
                    f.write(buf)
                logger.info("ABS report saved to %s", path)
                return path
            last_error = f"status={res.status_code} bytes={len(buf)}"
            logger.warning("ABS report download attempt %d for %s not a valid PDF yet (%s) — retrying",
                            attempt, assetnum, last_error)
            time.sleep(5)
        except httpx.HTTPError as e:
            last_error = str(e)
            time.sleep(5)
    raise RuntimeError(f"ABS report download failed for asset {assetnum} after 3 attempts: {last_error}")
