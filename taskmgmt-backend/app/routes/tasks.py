from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.database import get_db
from app.models.task import TaskMaster
from app.schemas.task_schemas import TaskOut
from app.utils.deps import require_admin

router = APIRouter(prefix="/tasks", tags=["Tasks"])


@router.get("", response_model=list[TaskOut])
async def list_tasks(
    db: AsyncSession = Depends(get_db),
    _admin: dict = Depends(require_admin),
):
    res = await db.execute(select(TaskMaster).order_by(TaskMaster.item_no))
    return res.scalars().all()


@router.get("/{item_no}", response_model=TaskOut)
async def get_task(
    item_no: int,
    db: AsyncSession = Depends(get_db),
    # require_admin actually permits ADMIN OR anyone with the task_management permission
    # flag (see its body) — the name is historical. That's the right check for this header
    # fetch: any task-management user should be able to see a task's title/description,
    # even subtask pages gated more narrowly (e.g. 1.W.4 -> require_survey_coordinator).
    _admin: dict = Depends(require_admin),
):
    res = await db.execute(select(TaskMaster).where(TaskMaster.item_no == item_no))
    task = res.scalar_one_or_none()
    if task is None:
        raise HTTPException(status_code=404, detail=f"Task {item_no} not found")
    return task
