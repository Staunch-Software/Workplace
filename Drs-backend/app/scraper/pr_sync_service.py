# =============================================================================
# app/scraper/pr_sync_service.py
#
# Two responsibilities:
#   1. upsert_to_cache()  — takes raw scraped rows, upserts into mariapps_pr_cache
#   2. sync_to_pr_entries() — compares cache vs pr_entries, updates pr_status where diff
#
# Both are async — called from pr_scheduler.py inside the FastAPI event loop.
# =============================================================================

import logging
from datetime import datetime, timezone

from sqlalchemy import text, update as sql_update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.core.database import SessionLocal
from app.models.mariapps_pr_cache import MariappsPrCache
from app.models.defect import PrEntry

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# 1. UPSERT SCRAPED DATA INTO CACHE
# ---------------------------------------------------------------------------

async def upsert_to_cache(scraped_rows: list) -> dict:
    """
    Upserts scraped PR rows into mariapps_pr_cache.
    - If requisition_no exists → update status/stage/last_scraped_at
    - If new → insert

    Returns summary dict: { inserted, updated, total }
    """
    inserted = updated = 0

    async with SessionLocal() as db:
        try:
            for row in scraped_rows:
                req_no = row.get("requisition_no", "").strip()
                if not req_no:
                    continue

                # Check if already cached
                result = await db.execute(
                    select(MariappsPrCache).where(MariappsPrCache.requisition_no == req_no)
                )
                existing = result.scalars().first()

                if existing:
                    # Only update if something changed
                    changed = (
                        existing.status != row.get("status") or
                        existing.stage  != row.get("stage")
                    )
                    if changed:
                        existing.status         = row.get("status")
                        existing.stage          = row.get("stage")
                        existing.department     = row.get("department")
                        existing.created_by     = row.get("created_by")
                        existing.approved_date  = row.get("approved_date")
                        existing.last_scraped_at = datetime.now(timezone.utc)
                        updated += 1
                else:
                    new_cache = MariappsPrCache(
                        requisition_no = req_no,
                        vessel_name    = row.get("vessel_name", ""),
                        stage          = row.get("stage"),
                        status         = row.get("status"),
                        department     = row.get("department"),
                        created_by     = row.get("created_by"),
                        approved_date  = row.get("approved_date"),
                    )
                    db.add(new_cache)
                    inserted += 1

            await db.commit()
            log.info(f"Cache upsert complete — Inserted: {inserted} | Updated: {updated}")

        except Exception as e:
            await db.rollback()
            log.error(f"Cache upsert failed: {e}")
            raise

    return {"inserted": inserted, "updated": updated, "total": len(scraped_rows)}


# ---------------------------------------------------------------------------
# 2. SYNC CACHE → PR ENTRIES
# ---------------------------------------------------------------------------

async def sync_to_pr_entries() -> dict:
    """
    Compares mariapps_pr_cache against pr_entries.
    Updates pr_entries.pr_status where:
      - pr_entries.pr_number matches cache.requisition_no (exact)
      - AND the status differs

    Returns summary dict: { synced, no_match, already_current }
    """
    synced = no_match = already_current = 0

    async with SessionLocal() as db:
        try:
            # Fetch all cache entries that have a status
            cache_result = await db.execute(
                select(MariappsPrCache).where(MariappsPrCache.status.isnot(None))
            )
            cache_rows = cache_result.scalars().all()

            log.info(f"Syncing {len(cache_rows)} cached PRs to pr_entries...")

            for cache_row in cache_rows:
                # Find matching pr_entry by pr_number
                pr_result = await db.execute(
                    select(PrEntry).where(
                        PrEntry.pr_number == cache_row.requisition_no,
                        PrEntry.is_deleted == False
                    )
                )
                pr_entry = pr_result.scalars().first()

                if not pr_entry:
                    no_match += 1
                    log.debug(f"  No pr_entry match for: {cache_row.requisition_no}")
                    continue

                # Compare and update only if status changed
                if pr_entry.mariapps_pr_status == cache_row.status:
                    already_current += 1
                    continue

                log.info(
                    f"  Updating {cache_row.requisition_no}: "
                    f"'{pr_entry.mariapps_pr_status}' → '{cache_row.status}'"
                )
                # Use explicit SQL UPDATE (not ORM attribute) to avoid session
                # tracking other dirty objects that may have defect_id = NULL
                await db.execute(
                    sql_update(PrEntry)
                    .where(PrEntry.id == pr_entry.id)
                    .values(mariapps_pr_status=cache_row.status)
                    .execution_options(synchronize_session=False)
                )
                synced += 1

            await db.commit()
            log.info(
                f"Sync complete — Updated: {synced} | "
                f"Already current: {already_current} | "
                f"No DRS match: {no_match}"
            )

        except Exception as e:
            await db.rollback()
            log.error(f"Sync to pr_entries failed: {e}")
            raise

    return {"synced": synced, "no_match": no_match, "already_current": already_current}