from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from sqlalchemy.orm import selectinload
from datetime import datetime
from pydantic import BaseModel
from app.api.deps import get_control_db
from app.core.security import verify_password, create_access_token
from app.models.control.user import User
from app.schemas.token import Token

router = APIRouter()

class LoginRequest(BaseModel):
    username: str
    password: str

@router.post("/login/access-token", response_model=Token)
async def login(
    form_data: LoginRequest,
    db: AsyncSession = Depends(get_control_db),
):
    result = await db.execute(
        select(User)
        .where(User.email == form_data.username)
        .options(selectinload(User.vessels))
    )
    user = result.scalar_one_or_none()

    if not user or not verify_password(form_data.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Incorrect email or password")

    if not user.is_active:
        raise HTTPException(status_code=400, detail="Inactive user")

    await db.execute(
        update(User).where(User.id == user.id).values(last_login=datetime.utcnow())
    )
    await db.commit()

    return Token(
        access_token=create_access_token(
            subject=str(user.id),
            role=user.role,                     # ✅ SHORE/VESSEL/ADMIN from DB
            full_name=user.full_name,
            permissions=user.permissions or {}
        ),
        id=str(user.id),
        full_name=user.full_name,
        email=user.email,
        role=user.role,
        job_title=user.job_title,
        assigned_vessels=[v.imo for v in user.vessels],
        assigned_vessel_names=[v.name for v in user.vessels],
        permissions=user.permissions,
        can_self_assign_vessels=user.can_self_assign_vessels,
    )