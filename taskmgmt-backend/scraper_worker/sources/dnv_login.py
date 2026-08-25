"""DNV Veracity login + fleet list + Class Status Report download.

Ported from a working reference implementation (TD Command Center, lib/dnv-auth.ts). Same
two-step Veracity form as before (email/username -> Continue -> password -> Log in), but the
login-completion signal changes: rather than trying to detect the OIDC callback settling on
/authentication/signin-oidc-ext (unreliable in practice — confirmed getting stuck there with
no console/page errors and nothing in storage), wait for the browser to land back on the
app's own home URL, https://maritime.dnv.com/Fleet/home. That redirect only happens once
Veracity's token exchange has actually finished server-side, so it's a reliable (if indirect)
completion signal, followed by a flat settle wait before capturing cookies.

No session persistence — fresh login every run (DNV cookies are short-lived). The browser is
closed right after login; fleet list and report download are plain cookie-authenticated httpx
calls, no more page.request/page.evaluate.
"""
import logging
import os
import time
import httpx
from decouple import config
from playwright.sync_api import sync_playwright

logger = logging.getLogger(__name__)

DNV_USERNAME = config("DNV_USERNAME")
DNV_PASSWORD = config("DNV_PASSWORD")
DNV_BASE_URL = "https://maritime.dnv.com"
HOME_URL = f"{DNV_BASE_URL}/Fleet/home"


class DnvSession:
    def __init__(self, base_url, cookie_header):
        self.base = base_url
        self.cookie_header = cookie_header


def login(headless=True) -> DnvSession:
    playwright = sync_playwright().start()
    browser = playwright.chromium.launch(headless=headless, args=["--no-sandbox"])
    context = browser.new_context()
    page = context.new_page()

    page.goto(HOME_URL, wait_until="domcontentloaded", timeout=60000)

    if "/Fleet/home" not in page.url:
        page.get_by_role("textbox", name="Email address or username").click(timeout=30000)
        page.get_by_role("textbox", name="Email address or username").fill(DNV_USERNAME)
        page.get_by_role("button", name="Continue").click()

        page.get_by_role("textbox", name="Password").click(timeout=20000)
        page.get_by_role("textbox", name="Password").fill(DNV_PASSWORD)
        page.get_by_role("button", name="Log in").click()

        page.wait_for_url("**/Fleet/home**", timeout=120000)

    # Let cookies settle after landing.
    page.wait_for_timeout(3000)

    raw = context.cookies()
    cookies = [c for c in raw if "dnv.com" in c["domain"]]
    if not cookies:
        browser.close()
        playwright.stop()
        raise RuntimeError("DNV login: logged in but captured 0 dnv.com cookies")
    cookie_header = "; ".join(f"{c['name']}={c['value']}" for c in cookies)

    logger.info("DNV login succeeded, landed on %s", page.url)
    browser.close()
    playwright.stop()
    return DnvSession(DNV_BASE_URL, cookie_header)


def get_fleet(session: DnvSession):
    """Confirmed real endpoint — returns the whole fleet with imo directly, used for
    direct-IMO resolution (vessel_resolution.resolve_dnv), no fuzzy matching needed."""
    url = f"{session.base}/Portal-VesselSelector/api/Me/Vessels"
    res = httpx.get(url, headers={"Cookie": session.cookie_header}, timeout=30, verify=False)
    if res.status_code != 200:
        raise RuntimeError(f"DNV GetFleet failed: {res.status_code} {res.text[:300]}")
    return res.json()


def download_class_status_report(session: DnvSession, dnv_vessel_id, download_dir):
    """Confirmed real endpoint: GET /FleetVessels/api/DownloadClassStatusReport/{id}/true.
    The server generates the PDF on demand, so a transient 5xx/429 is worth one retry."""
    os.makedirs(download_dir, exist_ok=True)
    url = f"{session.base}/FleetVessels/api/DownloadClassStatusReport/{dnv_vessel_id}/true"
    last_error = None
    for attempt in range(1, 4):
        try:
            res = httpx.get(url, headers={"Cookie": session.cookie_header}, timeout=60, verify=False)
            if res.status_code != 200:
                if res.status_code >= 500 or res.status_code == 429:
                    last_error = f"{res.status_code} {res.text[:200]}"
                    time.sleep(5)
                    continue
                raise RuntimeError(f"DNV report download failed for vessel {dnv_vessel_id}: {res.status_code}")
            path = os.path.join(download_dir, f"dnv_{dnv_vessel_id}_class_status_report.pdf")
            with open(path, "wb") as f:
                f.write(res.content)
            logger.info("DNV report saved to %s", path)
            return path
        except httpx.HTTPError as e:
            last_error = str(e)
            time.sleep(5)
    raise RuntimeError(f"DNV report download failed for vessel {dnv_vessel_id} after 3 attempts: {last_error}")
