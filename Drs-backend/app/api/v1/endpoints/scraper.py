# =============================================================================
# app/routers/scraper.py
#
# Admin-only endpoints for Mariapps PR scraper management.
#
# Endpoints:
#   POST /api/v1/scraper/pr-sync   — trigger manual sync
#   GET  /api/v1/scraper/pr-status — get last sync status
# =============================================================================

import logging
import asyncio
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.core.database import get_db
from app.api.deps import get_current_user
from app.models.user import User
from app.models.enums import UserRole
from app.models.mariapps_pr_cache import MariappsPrCache
from app.scraper.pr_sync_service import upsert_to_cache, sync_to_pr_entries

router = APIRouter(redirect_slashes=False)
log = logging.getLogger(__name__)

# Single thread executor for Playwright (sync)
_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="pr_manual_sync")

# Track last sync result in memory
_last_sync_result = {
    "status": "never_run",
    "last_run_at": None,
    "total_scraped": 0,
    "total_synced": 0,
    "error": None,
}


# ---------------------------------------------------------------------------
# POST /pr-sync — trigger manual scrape + sync
# ---------------------------------------------------------------------------

@router.post("/pr-sync")
async def trigger_pr_sync(
    current_user: User = Depends(get_current_user),
):
    """
    Manually triggers a full Mariapps PR scrape + sync.
    SHORE and ADMIN only.
    """
    if current_user.role not in [UserRole.SHORE, UserRole.ADMIN]:
        raise HTTPException(status_code=403, detail="Shore or Admin access required.")

    log.info(f"[MANUAL SYNC] Triggered by user: {current_user.id}")

    try:
        from app.scraper.pr_scraper import run_pr_scraper

        # Run Playwright scraper in thread (it's sync)
        loop = asyncio.get_event_loop()
        scraped_rows = await loop.run_in_executor(_executor, run_pr_scraper)

        # Session expired detection
        if scraped_rows is None or len(scraped_rows) == 0:
            _last_sync_result.update({
                "status": "session_expired",
                "last_run_at": datetime.now(timezone.utc).isoformat(),
                "total_scraped": 0,
                "total_synced": 0,
                "error": "Session expired or no data returned. Please regenerate auth.json on the server.",
            })
            raise HTTPException(
                status_code=503,
                detail="Mariapps session expired. Please run: python app/scraper/generate_auth.py on the server."
            )

        # Upsert to cache
        cache_summary = await upsert_to_cache(scraped_rows)

        # Sync to pr_entries
        sync_summary = await sync_to_pr_entries()

        _last_sync_result.update({
            "status": "success",
            "last_run_at": datetime.now(timezone.utc).isoformat(),
            "total_scraped": len(scraped_rows),
            "total_synced": sync_summary.get("synced", 0),
            "error": None,
        })

        log.info(f"[MANUAL SYNC] Complete — scraped: {len(scraped_rows)}, synced: {sync_summary}")
        return {
            "success": True,
            "total_scraped": len(scraped_rows),
            "cache": cache_summary,
            "sync": sync_summary,
        }

    except HTTPException:
        raise
    except Exception as e:
        _last_sync_result.update({
            "status": "error",
            "last_run_at": datetime.now(timezone.utc).isoformat(),
            "error": str(e),
        })
        log.error(f"[MANUAL SYNC] Failed: {e}")
        raise HTTPException(status_code=500, detail=f"Sync failed: {str(e)}")


# ---------------------------------------------------------------------------
# GET /pr-status — last sync info + session health
# ---------------------------------------------------------------------------

@router.get("/pr-status")
async def get_pr_sync_status(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Returns last sync result and cache stats.
    SHORE and ADMIN only.
    """
    if current_user.role not in [UserRole.SHORE, UserRole.ADMIN]:
        raise HTTPException(status_code=403, detail="Shore or Admin access required.")

    # Count cache rows and get latest scrape time
    result = await db.execute(select(MariappsPrCache).order_by(MariappsPrCache.last_scraped_at.desc()).limit(1))
    latest = result.scalars().first()

    cache_count = await db.execute(select(MariappsPrCache))
    total_cached = len(cache_count.scalars().all())

    return {
        **_last_sync_result,
        "total_cached": total_cached,
        "latest_scraped_at": latest.last_scraped_at.isoformat() if latest else None,
    }