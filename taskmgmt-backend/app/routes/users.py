from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.core.database_control import get_control_db
from app.models.control.user import User
from app.constants import ROLE_CODES
from app.schemas.task_schemas import UserOut
from app.utils.deps import require_admin

router = APIRouter(prefix="/users", tags=["Users"])


@router.get("", response_model=list[UserOut])
async def list_eligible_users(
    role_code: str = Query(..., description="One of: " + ", ".join(ROLE_CODES)),
    control_db: AsyncSession = Depends(get_control_db),
    _admin: dict = Depends(require_admin),
):
    if role_code not in ROLE_CODES:
        raise HTTPException(status_code=400, detail=f"role_code must be one of {ROLE_CODES}")

    res = await control_db.execute(
        select(User).where(
            User.role_code == role_code,
            User.is_active == True,
            User.permissions["task_management"].as_boolean() == True,
        )
    )
    return res.scalars().all()
