# app/api/v1/endpoints/feed.py

from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from typing import List, Optional
from datetime import datetime, timedelta
from pydantic import BaseModel, ConfigDict
from uuid import UUID

from app.core.database import get_db
from app.api.deps import require_any
from app.models.report import ReportEvent

router = APIRouter(prefix="/feed", tags=["Feed"])

class ReportEventOut(BaseModel):
    id: UUID
    vessel_imo: str
    vessel_name: str
    report_id: Optional[UUID]
    event_type: str
    description: str
    source: Optional[str]
    author_name: Optional[str]
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)

@router.get("", response_model=List[ReportEventOut])
async def get_feed(
    vessel_imo: Optional[str] = None,
    event_type: Optional[str] = None,
    source: Optional[str] = None,
    days: int = 30,
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_any),
):
    """
    Get the activity feed for reports.
    """
    stmt = select(ReportEvent)
    
    # Filter by vessel imo if provided
    if vessel_imo:
        stmt = stmt.where(ReportEvent.vessel_imo == vessel_imo)
    # If the user is a VESSEL role, they can only see their own vessel's feed
    elif current_user.role == 'VESSEL':
        assigned = getattr(current_user, 'assigned_vessels', None)
        if assigned is None:
            # assigned_vessels lookup failed (see deps.get_current_user).
            # Do NOT fall through to "no filter" -- that would leak every
            # vessel's feed to this vessel user on a transient DB error.
            raise HTTPException(
                status_code=503,
                detail="Could not verify vessel assignment. Please retry.",
            )
        if assigned:
            stmt = stmt.where(ReportEvent.vessel_imo.in_(assigned))
        else:
            # Genuinely zero vessels assigned -> show nothing (previously
            # this fell through to no filter at all, leaking every vessel's
            # feed to a vessel user with no assignment).
            stmt = stmt.where(ReportEvent.vessel_imo.in_([]))

    if event_type:
        stmt = stmt.where(ReportEvent.event_type == event_type)
        
    if source:
        stmt = stmt.where(ReportEvent.source == source)

    # Date filtering
    cutoff_date = datetime.utcnow() - timedelta(days=days)
    stmt = stmt.where(ReportEvent.created_at >= cutoff_date)

    # Order by newest first
    stmt = stmt.order_by(desc(ReportEvent.created_at)).limit(limit)

    result = await db.execute(stmt)
    events = result.scalars().all()
    
    return events
