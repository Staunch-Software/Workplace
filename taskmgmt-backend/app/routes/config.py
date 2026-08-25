import uuid
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.database import get_db
from app.core.database_control import get_control_db
from app.models.task import VesselRoleAssignment, TaskRaciEntry
from app.models.control.user import User
from app.constants import ROLE_CODES
from app.schemas.task_schemas import (
    ConfigOut, AssignmentOut, MatrixEntryOut, AssignmentIn, MatrixEntryIn,
)
from app.utils.deps import require_admin

router = APIRouter(prefix="/config", tags=["Config"])


@router.get("", response_model=ConfigOut)
async def get_vessel_config(
    vessel_imo: str = Query(...),
    db: AsyncSession = Depends(get_db),
    control_db: AsyncSession = Depends(get_control_db),
    _admin: dict = Depends(require_admin),
):
    assign_res = await db.execute(
        select(VesselRoleAssignment).where(VesselRoleAssignment.vessel_imo == vessel_imo)
    )
    assignment_rows = assign_res.scalars().all()

    user_ids = [row.user_id for row in assignment_rows if row.user_id is not None]
    users_by_id = {}
    if user_ids:
        users_res = await control_db.execute(select(User).where(User.id.in_(user_ids)))
        users_by_id = {u.id: u for u in users_res.scalars().all()}

    by_role = {row.role_code: row for row in assignment_rows}
    assignments = []
    for role_code in ROLE_CODES:
        row = by_role.get(role_code)
        user = users_by_id.get(row.user_id) if row and row.user_id else None
        assignments.append(AssignmentOut(
            role_code=role_code,
            user_id=row.user_id if row else None,
            full_name=user.full_name if user else None,
            email=user.email if user else None,
        ))

    matrix_res = await db.execute(
        select(TaskRaciEntry).where(TaskRaciEntry.vessel_imo == vessel_imo)
    )
    matrix = [
        MatrixEntryOut(task_id=row.task_id, role_code=row.role_code, raci_values=row.raci_values or [])
        for row in matrix_res.scalars().all()
    ]

    return ConfigOut(assignments=assignments, matrix=matrix)


@router.put("/assignment", response_model=AssignmentOut)
async def upsert_assignment(
    payload: AssignmentIn,
    db: AsyncSession = Depends(get_db),
    control_db: AsyncSession = Depends(get_control_db),
    _admin: dict = Depends(require_admin),
):
    stmt = pg_insert(VesselRoleAssignment).values(
        vessel_imo=payload.vessel_imo,
        role_code=payload.role_code,
        user_id=payload.user_id,
    ).on_conflict_do_update(
        constraint="uq_vessel_role",
        set_={"user_id": payload.user_id},
    )
    await db.execute(stmt)
    await db.commit()

    user = None
    if payload.user_id:
        res = await control_db.execute(select(User).where(User.id == payload.user_id))
        user = res.scalar_one_or_none()

    return AssignmentOut(
        role_code=payload.role_code,
        user_id=payload.user_id,
        full_name=user.full_name if user else None,
        email=user.email if user else None,
    )


@router.put("/matrix-entry", response_model=MatrixEntryOut)
async def upsert_matrix_entry(
    payload: MatrixEntryIn,
    db: AsyncSession = Depends(get_db),
    _admin: dict = Depends(require_admin),
):
    stmt = pg_insert(TaskRaciEntry).values(
        vessel_imo=payload.vessel_imo,
        task_id=payload.task_id,
        role_code=payload.role_code,
        raci_values=payload.raci_values,
    ).on_conflict_do_update(
        constraint="uq_vessel_task_role",
        set_={"raci_values": payload.raci_values},
    )
    await db.execute(stmt)
    await db.commit()

    return MatrixEntryOut(
        task_id=payload.task_id,
        role_code=payload.role_code,
        raci_values=payload.raci_values,
    )
