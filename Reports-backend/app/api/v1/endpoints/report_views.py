# app/api/v1/endpoints/report_views.py
#
#   GET  /report-views              – ids of reports the current user has viewed
#   POST /report-views/{report_id}  – mark a report as viewed by the current user

from typing import List
from uuid import UUID
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.core.database import get_db
from app.api.deps import require_any
from app.models.report_view import ReportView

router = APIRouter(prefix="/report-views", tags=["Report Views"])


@router.get("", response_model=List[UUID])
async def list_viewed(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_any),
):
    result = await db.execute(
        select(ReportView.report_id).where(ReportView.user_id == str(current_user.id))
    )
    return [row[0] for row in result.all()]


@router.post("/{report_id}", status_code=204)
async def mark_viewed(
    report_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_any),
):
    uid = str(current_user.id)
    existing = await db.get(ReportView, (uid, report_id))
    if not existing:
        db.add(ReportView(user_id=uid, report_id=report_id))
        await db.commit()
