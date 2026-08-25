# Generic subtask endpoints. 1.W.4 (survey cycle review) is the only one with real backend
# logic so far — this file's job is to stay generic so 1.W.1–1.W.3 and 1.W.5 can register
# their own handlers here later without changing the route shape or the gating pattern.
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.task import WorkOrderTrigger
from app.schemas.task_schemas import TriggerWorkOrderIn, TriggerWorkOrderOut
from app.services.w4_survey_cycle import get_survey_cycle_review
from app.core.database_control import get_control_db
from app.utils.deps import require_survey_coordinator

router = APIRouter(prefix="/tasks", tags=["Subtasks"])

# subtask_code -> async handler(db, control_db) -> Pydantic response model.
# Each subtask's response shape is its own concern (SurveyCycleReviewOut today), so this
# endpoint deliberately has no shared response_model — add new entries here as 1.W.1–1.W.3
# and 1.W.5 get real query logic, no route changes needed.
SUBTASK_VESSEL_HANDLERS = {
    "1.W.4": get_survey_cycle_review,
}


@router.get("/{task_id}/subtasks/{subtask_code}/vessels")
async def get_subtask_vessels(
    task_id: int,
    subtask_code: str,
    db: AsyncSession = Depends(get_db),
    control_db: AsyncSession = Depends(get_control_db),
    # NOTE: every subtask registered here currently needs the Survey Coordinator role.
    # If a future subtask (e.g. one of 1.W.1–1.W.3) needs a different role, this single
    # Depends will need to become per-handler — not a concern yet with one entry.
    _user: dict = Depends(require_survey_coordinator),
):
    handler = SUBTASK_VESSEL_HANDLERS.get(subtask_code)
    if handler is None:
        raise HTTPException(status_code=404, detail=f"Subtask {subtask_code} has no vessel-review logic yet")
    return await handler(db, control_db)


@router.post("/{task_id}/subtasks/{subtask_code}/trigger-work-order", response_model=TriggerWorkOrderOut)
async def trigger_work_order(
    task_id: int,
    subtask_code: str,
    payload: TriggerWorkOrderIn,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_survey_coordinator),
):
    """Stub only — records that someone asked for a work order. No SmartPAL/MariApps work-order
    API integration yet, that's explicitly future scope."""
    row = WorkOrderTrigger(
        task_code=subtask_code,
        vessel_name=payload.vessel_name,
        survey_name=payload.survey_name,
        source=payload.source,
        triggered_by=current_user.get("email") or current_user.get("full_name") or current_user.get("sub"),
        triggered_at=datetime.now(timezone.utc),
    )
    db.add(row)
    await db.commit()
    return TriggerWorkOrderOut(success=True)
