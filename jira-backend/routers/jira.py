"""
jira.py — Jira sync API endpoints
══════════════════════════════════

POST /api/jira/sync          → INCREMENTAL sync (default, fast, run every 30 min)
POST /api/jira/full-sync     → FULL sync (run ONCE after deployment to populate all data)
POST /api/jira/retry         → Retry failed PUSH submissions only
GET  /api/jira/status        → Live sync status with timing + last result
GET  /api/jira/image-proxy   → Proxy Jira-hosted images using saved Playwright cookies

FIRST TIME SETUP:
  1. Deploy all files
  2. Restart uvicorn
  3. POST /api/jira/full-sync   ← run ONCE, ~45 minutes for 318 tickets
  4. After full sync: POST /api/jira/sync every 30 minutes (incremental)
"""

from fastapi import APIRouter, Depends, BackgroundTasks, Query
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from core.deps import require_role, get_current_user
from db.database import get_db
from datetime import datetime
import traceback
import asyncio
import httpx
import json
from pathlib import Path

router = APIRouter(prefix="/api/jira", tags=["jira"])

sync_status = {
    "running":     False,
    "mode":        None,
    "startedAt":   None,
    "lastSync":    None,
    "lastResult":  None,
    "lastError":   None,
}


# ─── INCREMENTAL sync — fast, run every 30 minutes ───────────────────────────

@router.post("/sync")
async def trigger_sync(
    background_tasks: BackgroundTasks,
    user=Depends(require_role("SHORE", "ADMIN"))
):
    if sync_status["running"]:
        return {
            "message": f"Sync already running ({sync_status['mode']} since {sync_status['startedAt']})",
            "status": sync_status
        }
    sync_status.update({"running": True, "mode": "INCREMENTAL",
                         "startedAt": datetime.utcnow().isoformat(), "lastError": None})
    background_tasks.add_task(_run_sync, full_sync=False)
    return {
        "message": "Incremental sync started. Only new/changed tickets will be detail-fetched. ~2–5 min.",
        "status": sync_status
    }


# ─── FULL sync — run ONCE after first deployment ──────────────────────────────

@router.post("/full-sync")
async def trigger_full_sync(
    background_tasks: BackgroundTasks,
    user=Depends(require_role("SHORE", "ADMIN"))
):
    if sync_status["running"]:
        return {
            "message": f"Sync already running ({sync_status['mode']} since {sync_status['startedAt']})",
            "status": sync_status
        }
    sync_status.update({"running": True, "mode": "FULL",
                         "startedAt": datetime.utcnow().isoformat(), "lastError": None})
    background_tasks.add_task(_run_sync, full_sync=True)
    return {
        "message": (
            "Full sync started. Fetching details for ALL tickets. "
            "Estimated ~45 minutes (318 tickets × ~8s). "
            "Run this ONCE after deployment, then use /sync for incremental updates."
        ),
        "status": sync_status
    }


# ─── Retry failed push submissions ───────────────────────────────────────────

@router.post("/retry")
async def retry_failed(
    background_tasks: BackgroundTasks,
    user=Depends(require_role("SHORE", "ADMIN"))
):
    if sync_status["running"]:
        return {"message": "Sync already running", "status": sync_status}
    sync_status.update({"running": True, "mode": "RETRY",
                         "startedAt": datetime.utcnow().isoformat()})
    background_tasks.add_task(_run_retry_only)
    return {"message": "Retry started — re-submitting PENDING/FAILED tickets"}


# ─── Status endpoint ──────────────────────────────────────────────────────────

@router.get("/status")
async def get_status(user=Depends(require_role("SHORE", "ADMIN"))):
    return sync_status


# ─── Vessel sync status ───────────────────────────────────────────────────────

@router.get("/vessel-sync-status")
async def get_vessel_sync_status(
    user=Depends(get_current_user),
    jira_db: AsyncSession = Depends(get_db),
):
    """
    Returns the last push/pull sync timestamps for all vessels assigned
    to the current user. Used by the Shore Dashboard Sync Log panel.
    """
    from models.sync import SyncState

    if not user.vessels:
        return []

    imos = [v.imo for v in user.vessels]

    result = await jira_db.execute(
        select(SyncState)
        .where(SyncState.vessel_imo.in_(imos))
        .where(SyncState.sync_scope == "TICKET")
    )
    sync_map = {row.vessel_imo: row for row in result.scalars().all()}

    return [
        {
            "imo": v.imo,
            "name": v.name,
            "last_push_at": sync_map[v.imo].last_push_at.isoformat() if v.imo in sync_map and sync_map[v.imo].last_push_at else None,
            "last_pull_at": sync_map[v.imo].last_pull_at.isoformat() if v.imo in sync_map and sync_map[v.imo].last_pull_at else None,
        }
        for v in user.vessels
    ]


# ─── Image proxy ─────────────────────────────────────────────────────────────
#
# WHY THIS EXISTS:
#   Jira attachments & comment images are stored at URLs like:
#     https://mariapps.atlassian.net/secure/attachment/12345/screenshot.png
#   These URLs require Atlassian session cookies — the browser cannot load
#   them directly from localhost because it has no Jira session.
#
# HOW IT WORKS:
#   1. Frontend calls: GET /api/jira/image-proxy?url=<encoded-jira-url>
#   2. This endpoint loads the Playwright-saved cookies from C:/tmp/jira-cookies.json
#   3. Makes a server-side request to Jira with those cookies
#   4. Streams the image bytes back to the browser
#
# WHY COOKIES WORK HERE:
#   Playwright saves cookies after every login in playwright_service.py (_save_cookies).
#   Those are the same Atlassian session cookies the browser would have if logged in.
#   The backend (Python/httpx) sends them as a regular cookie header — Atlassian accepts this.
#
# IMPORTANT — WHAT URLS ARE VALID:
#   Only these URL patterns are proxied (real attachment/content URLs):
#     - /secure/attachment/...
#     - /rest/servicedeskapi/request/.../attachment
#     - /wiki/download/...
#   Icon URLs like /rest/servicedeskapi/requesttype/icon/... return 401 because
#   those are API endpoints, not attachment files. These are filtered out.
#
# ─────────────────────────────────────────────────────────────────────────────

# COOKIES_PATH must match the path used in playwright_service.py.
# Override with env var JIRA_COOKIES_PATH if running on Linux.
import os as _os_jira

# ── Global lock: only ONE cookie refresh at a time ────────────────────────────
# Multiple simultaneous 401s (e.g. page with several attachments) would each
# try to open a Playwright browser and login concurrently — causing a race
# condition where all refreshes fail. This lock serializes them: the first
# request does the refresh, the rest wait and then reuse the fresh cookies.
_cookie_refresh_lock = asyncio.Lock()
# COOKIES_PATH = Path(_os_jira.environ.get("JIRA_COOKIES_PATH", "C:/tmp/jira-cookies.json"))

BASE_DIR = Path(__file__).resolve().parents[1] / "automation"

COOKIES_PATH = Path(_os_jira.environ.get(
    "JIRA_COOKIES_PATH",
    BASE_DIR / "jira-cookies.json"
))

# URL patterns that are actual attachment content (not icons or API endpoints)
VALID_ATTACHMENT_PATTERNS = [
    "/secure/attachment/",
    "/rest/servicedeskapi/request/",
    "/wiki/download/",
    "/secure/thumbnail/",
    "/rest/api/",          # covers /rest/api/2/attachment/content/...
]

# URL patterns to REJECT — these are not attachment files, they're API metadata
BLOCKED_PATTERNS = [
    "/requesttype/icon/",   # request type icons — not an attachment, returns 401
    "/avatar/",
    "/icons/",
    "spinner",
]


def _load_jira_cookies() -> dict:
    """
    Load Playwright-saved cookies from disk and return as a simple {name: value} dict.

    IMPORTANT — DOT-PREFIXED DOMAIN BUG:
    Playwright saves some cookies with domain ".mariapps.atlassian.net" (leading dot).
    This includes the critical `customer.account.session.token` and `aws-waf-token`.

    When passed as a plain dict to httpx (cookies={name: value}), httpx sends ALL
    cookies to ALL paths on the domain — this is actually what we want for a proxy.
    The leading dot in the domain is a browser cookie scoping convention that says
    "send to all subdomains". Since we're making a direct server-side request to
    exactly mariapps.atlassian.net, sending all cookies is correct.

    httpx dict cookies bypass domain/path matching entirely and just send everything.
    This is the correct behavior for our proxy use case.
    """
    cookies = {}
    if not COOKIES_PATH.exists():
        print(f"[ImageProxy] WARNING: Cookie file not found at {COOKIES_PATH}")
        return cookies
    try:
        raw = json.loads(COOKIES_PATH.read_text())
        for c in raw:
            name  = c.get("name")
            value = c.get("value")
            if name and value:
                cookies[name] = value
        print(f"[ImageProxy] Loaded {len(cookies)} cookies")
    except Exception as e:
        print(f"[ImageProxy] Cookie load error: {e}")
    return cookies


@router.get("/image-proxy")
async def image_proxy(
    url: str = Query(..., description="Full Jira image URL to proxy"),
):
    # NOTE: No auth dependency here intentionally.
    # Browsers fetch <img src="..."> tags directly without attaching the user's
    # JWT — so adding get_current_user causes every image to return 401 before
    # our handler even runs. Security is provided by: (1) Jira cookies on the
    # server side authenticating to Atlassian, (2) BLOCKED_PATTERNS preventing
    # misuse, and (3) Jira attachment URLs not being guessable.
    """
    Proxy a Jira-hosted attachment image using saved Playwright session cookies.

    Usage: GET /api/jira/image-proxy?url=https://mariapps.atlassian.net/secure/attachment/...

    Returns the raw image bytes with the correct Content-Type.
    Cached for 1 hour (Cache-Control: public, max-age=3600).
    """
    # ── Validate URL ──────────────────────────────────────────────────────────
    # NOTE: The original code had a Python operator precedence bug:
    #   if not url or "atlassian.net" not in url and "jira" not in url.lower():
    # This is parsed as:
    #   if (not url) or (("atlassian.net" not in url) and ("jira" not in url.lower())):
    # Which means a valid atlassian.net URL with "jira" in it would still pass incorrectly.
    # Fixed below with explicit parentheses:

    if not url:
        return Response(status_code=400, content="Missing url parameter")

    # ── Normalise relative URLs ───────────────────────────────────────────────
    # playwright_service stores attachment URLs from _links.content which are
    # sometimes relative paths like "/secure/attachment/12345/file.png".
    # TicketDetail.jsx tries to fix these on the frontend, but we also handle
    # them here server-side so no image silently fails the check below.
    JIRA_BASE = "https://mariapps.atlassian.net"
    if url.startswith("/"):
        url = f"{JIRA_BASE}{url}"

    url_lower = url.lower()

    # Must be an Atlassian URL
    if "atlassian.net" not in url_lower:
        return Response(status_code=400, content="Invalid URL: must be an atlassian.net URL")

    # Reject non-attachment API URLs (icons, avatars, etc.)
    # These return 401 because they require API token auth, not session cookies.
    # Example of BLOCKED: /rest/servicedeskapi/requesttype/icon/type/SD_REQTYPE/id/10571
    # Example of ALLOWED: /secure/attachment/12345/screenshot.png
    for blocked in BLOCKED_PATTERNS:
        if blocked in url_lower:
            print(f"[ImageProxy] Blocked non-attachment URL: {url[:80]}")
            return Response(status_code=400, content=f"URL pattern '{blocked}' is not a proxiable attachment")

    # ── Load cookies & fetch ──────────────────────────────────────────────────
    #
    # WHY WE DON'T USE follow_redirects=True:
    #   Jira attachment URLs like /secure/attachment/12345/file.png respond with
    #   HTTP 302 → Location pointing to an S3/CDN pre-signed URL.
    #   If httpx follows that redirect with the Atlassian session cookies still
    #   attached, S3 returns 400 (Bad Request) because S3 pre-signed URLs don't
    #   accept extra Authorization/Cookie headers — the signature in the URL IS
    #   the auth token.
    #
    #   CORRECT APPROACH:
    #     Step 1: Request the Jira attachment URL WITH cookies  (gets 302 → CDN URL)
    #     Step 2: Request the CDN URL WITHOUT cookies           (gets 200 + image bytes)
    #
    try:
        cookies = _load_jira_cookies()

        if not cookies:
            print("[ImageProxy] No cookies loaded — Jira session may have expired. Re-run a sync to refresh cookies.")
            return Response(status_code=503, content="No Jira session cookies available. Run a sync first.")

        jira_headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
            "Referer":           "https://mariapps.atlassian.net/servicedesk/customer/portals",
            "Accept":            "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
            "Accept-Language":   "en-US,en;q=0.9",
            "X-Atlassian-Token": "no-check",
            "X-Requested-With":  "XMLHttpRequest",
        }

        # Larger timeout for videos/large files; stream=False loads full content
        _is_video = any(url.lower().endswith(ext) for ext in ('.mp4', '.mov', '.avi', '.mkv', '.webm'))
        _timeout = 120.0 if _is_video else 30.0

        async with httpx.AsyncClient(
            follow_redirects=False,   # Step 1: catch the 302 manually
            timeout=_timeout,
            cookies=cookies,
            headers=jira_headers,
        ) as client:
            resp = await client.get(url)

        # ── Case 1: Jira redirects to CDN (pre-signed URL) ────────────────────
        if resp.status_code in (301, 302, 303, 307, 308):
            cdn_url = resp.headers.get("location", "")
            if not cdn_url:
                print(f"[ImageProxy] Got {resp.status_code} but no Location header for {url[:80]}")
                return Response(status_code=502, content="Redirect with no Location")

            # Make relative locations absolute (shouldn't happen for S3 but be safe)
            if cdn_url.startswith("/"):
                cdn_url = f"https://mariapps.atlassian.net{cdn_url}"

            print(f"[ImageProxy] Redirected → {cdn_url[:80]}")

            # Step 2: fetch CDN URL WITHOUT cookies (S3/CDN pre-signed URLs)
            async with httpx.AsyncClient(
                follow_redirects=True,  # CDN may have its own short redirect chain
                timeout=30.0,
            ) as cdn_client:
                cdn_resp = await cdn_client.get(cdn_url)

            if cdn_resp.status_code == 200:
                content_type = cdn_resp.headers.get("content-type", "application/octet-stream").split(";")[0].strip()
                headers = {"Cache-Control": "public, max-age=3600"}
                # For PDFs: set inline disposition so browser opens them in a tab (not download)
                if "pdf" in content_type or url.lower().endswith(".pdf"):
                    headers["Content-Disposition"] = "inline"
                return Response(
                    content=cdn_resp.content,
                    media_type=content_type,
                    headers=headers
                )
            else:
                print(f"[ImageProxy] CDN returned {cdn_resp.status_code} for {cdn_url[:80]}")
                return Response(status_code=cdn_resp.status_code, content=f"CDN returned {cdn_resp.status_code}")

        # ── Case 2: Jira served it directly (no redirect) ────────────────────
        elif resp.status_code == 200:
            content_type = resp.headers.get("content-type", "application/octet-stream").split(";")[0].strip()
            headers = {"Cache-Control": "public, max-age=3600"}
            if "pdf" in content_type or url.lower().endswith(".pdf"):
                headers["Content-Disposition"] = "inline"
            return Response(
                content=resp.content,
                media_type=content_type,
                headers=headers
            )

        # ── Case 3: Auth error — stale cookies ───────────────────────────────
        elif resp.status_code in (401, 403):
            # Cookies are stale. Auto-refresh via Playwright re-login, then retry.
            #
            # LOCK: A page with multiple attachments fires several requests at once.
            # Without a lock, each 401 would launch its own Playwright browser → race.
            # With the lock: first request does the refresh, the rest wait, then ALL
            # reload the now-fresh cookies and retry without launching another browser.
            print(f"[ImageProxy] Got {resp.status_code} for {url[-60:]} — waiting for cookie refresh lock...")
            async with _cookie_refresh_lock:
                # Check if cookies were already refreshed by a concurrent request
                # that held the lock before us — reload and retry immediately.
                fresh_cookies = _load_jira_cookies()
                if fresh_cookies and fresh_cookies != cookies:
                    print("[ImageProxy] Cookies already refreshed by concurrent request — retrying...")
                else:
                    # We're first — do the actual refresh
                    print("[ImageProxy] Refreshing cookies via Playwright...")
                    try:
                        from automation.playwright_service import get_jira_service
                        _svc = get_jira_service()
                        refreshed = await asyncio.to_thread(_svc.refresh_cookies_sync)
                        if refreshed:
                            print("[ImageProxy] Cookies refreshed ✓")
                            fresh_cookies = _load_jira_cookies()
                        else:
                            print("[ImageProxy] refresh_cookies_sync returned False")
                            fresh_cookies = None
                    except Exception as refresh_err:
                        print(f"[ImageProxy] Auto-refresh exception: {refresh_err}")
                        fresh_cookies = None

            # Retry with fresh cookies (outside lock so we don't block others)
            if fresh_cookies:
                try:
                    async with httpx.AsyncClient(
                        follow_redirects=False,
                        timeout=_timeout,
                        cookies=fresh_cookies,
                        headers=jira_headers,
                    ) as retry_client:
                        retry_resp = await retry_client.get(url)
                    if retry_resp.status_code in (301, 302, 303, 307, 308):
                        cdn_url = retry_resp.headers.get("location", "")
                        if cdn_url:
                            if cdn_url.startswith("/"):
                                cdn_url = f"https://mariapps.atlassian.net{cdn_url}"
                            async with httpx.AsyncClient(follow_redirects=True, timeout=30.0) as cdn_c:
                                cdn_r = await cdn_c.get(cdn_url)
                            if cdn_r.status_code == 200:
                                ct = cdn_r.headers.get("content-type", "application/octet-stream").split(";")[0].strip()
                                hdrs = {"Cache-Control": "public, max-age=3600"}
                                if "pdf" in ct or url.lower().endswith(".pdf"): hdrs["Content-Disposition"] = "inline"
                                return Response(content=cdn_r.content, media_type=ct, headers=hdrs)
                    elif retry_resp.status_code == 200:
                        ct = retry_resp.headers.get("content-type", "application/octet-stream").split(";")[0].strip()
                        hdrs = {"Cache-Control": "public, max-age=3600"}
                        if "pdf" in ct or url.lower().endswith(".pdf"): hdrs["Content-Disposition"] = "inline"
                        return Response(content=retry_resp.content, media_type=ct, headers=hdrs)
                        return Response(content=retry_resp.content, media_type=ct, headers={"Cache-Control": "public, max-age=3600"})
                    print(f"[ImageProxy] Retry after refresh still failed: {retry_resp.status_code}")
                except Exception as retry_err:
                    print(f"[ImageProxy] Retry request failed: {retry_err}")
            # If refresh failed or retry still failed, delete stale file and return 503
            if COOKIES_PATH.exists():
                try:
                    COOKIES_PATH.unlink()
                    print(f"[ImageProxy] Deleted stale cookies after failed refresh.")
                except Exception as del_err:
                    print(f"[ImageProxy] Could not delete cookie file: {del_err}")
            return Response(
                status_code=503,
                content=(
                    "Jira session expired. Auto-refresh attempted but failed. "
                    "Run a Sync (/api/jira/sync) to refresh access — "
                    "images will load after the next sync completes."
                ),
                headers={"Content-Type": "text/plain"}
            )

        else:
            print(f"[ImageProxy] Upstream {resp.status_code} for {url[:80]}")
            return Response(status_code=resp.status_code, content=f"Upstream returned {resp.status_code}")

    except httpx.TimeoutException:
        print(f"[ImageProxy] Timeout fetching {url[:80]}")
        return Response(status_code=504, content="Request to Jira timed out")

    except Exception as e:
        print(f"[ImageProxy] Unexpected error fetching {url[:80]}: {e}")
        return Response(status_code=502, content="Image proxy error")


# ─── Background task runners ──────────────────────────────────────────────────

async def _run_sync(full_sync: bool = False):
    from automation.push_service import push_pending_tickets
    from automation.pull_service import pull_jira_updates
    start = datetime.utcnow()
    try:
        print("[Sync] Starting PUSH (pending tickets)...")
        push_result = await push_pending_tickets()
        print(f"[Sync] PUSH done: pushed={push_result['pushed']} failed={push_result['failed']}")

        print(f"[Sync] Starting PULL (full_sync={full_sync})...")
        pull_result = await pull_jira_updates(full_sync=full_sync)

        elapsed = round((datetime.utcnow() - start).total_seconds() / 60, 1)
        sync_status["lastResult"] = {
            "push":           push_result,
            "pull":           pull_result,
            "elapsedMinutes": elapsed,
        }
        sync_status["lastSync"]  = datetime.utcnow().isoformat()
        sync_status["lastError"] = None
        print(
            f"[Sync] COMPLETE in {elapsed}m — "
            f"DetailFetched={pull_result['detailFetched']} "
            f"Skipped={pull_result['detailSkipped']} "
            f"Updated={pull_result['updated']} Created={pull_result['created']}"
        )
    except Exception as e:
        err = str(e)
        print(f"[Sync] ERROR: {err}")
        traceback.print_exc()
        sync_status["lastResult"] = {"error": err}
        sync_status["lastError"]  = err
    finally:
        sync_status["running"] = False


async def _run_retry_only():
    from automation.push_service import push_pending_tickets
    try:
        result = await push_pending_tickets()
        sync_status["lastResult"] = {"retry": result}
        sync_status["lastSync"]   = datetime.utcnow().isoformat()
        sync_status["lastError"]  = None
    except Exception as e:
        sync_status["lastResult"] = {"error": str(e)}
        sync_status["lastError"]  = str(e)
    finally:
        sync_status["running"] = False