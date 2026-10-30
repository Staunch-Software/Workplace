"""One clock for everything that is stored or synced: UTC, corrected for a vessel PC whose clock is wrong.

A vessel's Windows clock or time zone is often wrong. The sync never trusts it. Each time the vessel reaches the VM
it measures how far its own clock is from the VM's (offset = VM time - vessel time) and keeps that number:
  * here, in memory, for Python code (utc_now());
  * in the sync_clock table, for the database function orb_utc_now() that column defaults and triggers use.
On the VM the offset is always 0. The offset survives restarts, so a vessel that is offline keeps stamping
corrected times from the last measurement. Times are only ever compared as UTC; the screens show IST.
"""
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger("orb.clock")

# India has no daylight saving, so a fixed offset is exact (and needs no tz database on the vessel PC).
IST = timezone(timedelta(hours=5, minutes=30))

_offset_seconds: float = 0.0


def get_offset() -> float:
    return _offset_seconds


def set_offset(seconds: float) -> None:
    global _offset_seconds
    _offset_seconds = float(seconds)


def utc_now() -> datetime:
    """Timezone-aware UTC "now", corrected by the last measured offset. Use this, never datetime.now(), for stored times."""
    return datetime.now(timezone.utc) + timedelta(seconds=_offset_seconds)


async def load_offset(db: AsyncSession) -> float:
    """Read the saved offset (at startup)."""
    try:
        row = (await db.execute(text("SELECT offset_seconds FROM sync_clock WHERE id = 1"))).first()
        set_offset(row[0] if row else 0.0)
    except Exception:
        logger.exception("Could not read the saved clock offset; using 0")
        await db.rollback()
    return _offset_seconds


async def save_offset(db: AsyncSession, seconds: float, measured_at: Optional[datetime] = None) -> None:
    """Remember the offset for the database function and for the next restart."""
    set_offset(seconds)
    await db.execute(text("""
        INSERT INTO sync_clock (id, offset_seconds, measured_at) VALUES (1, :s, :t)
        ON CONFLICT (id) DO UPDATE SET offset_seconds = EXCLUDED.offset_seconds, measured_at = EXCLUDED.measured_at
    """), {"s": float(seconds), "t": measured_at or utc_now()})
    await db.commit()
