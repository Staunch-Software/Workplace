from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from datetime import datetime
from app.api.deps import get_control_db, get_current_admin, get_current_user
from app.core.email import send_welcome_email
from app.core.security import hash_password
from app.models.control.user import User
from app.models.control.vessel import Vessel
from app.schemas.user import UserCreate, UserUpdate, UserOut, UserDetail
import uuid
from pydantic import BaseModel
from app.core.security import verify_password
from typing import Optional

router = APIRouter()

import logging
logger = logging.getLogger(__name__)

@router.get("/users", response_model=list[UserDetail])
async def list_users(
    db: AsyncSession = Depends(get_control_db),
    admin: User = Depends(get_current_admin),
):
    result = await db.execute(
        select(User).options(selectinload(User.vessels))
    )
    users = result.scalars().all()
    return [
        UserDetail(
            id=u.id,
            full_name=u.full_name,
            email=u.email,
            job_title=u.job_title,
            role=u.role,
            is_active=u.is_active,
            can_self_assign_vessels=u.can_self_assign_vessels,
            permissions=u.permissions,
            assigned_vessels=[{"imo": v.imo, "name": v.name} for v in u.vessels],
            last_login=u.last_login,
        )
        for u in users
    ]

# ADD this new endpoint after the list_users endpoint:

@router.post("/users/{user_id}/resend-welcome")
async def resend_welcome_email(
    user_id: uuid.UUID,
    db: AsyncSession = Depends(get_control_db),
    admin: User = Depends(get_current_admin),
):
    result = await db.execute(
        select(User).where(User.id == user_id).options(selectinload(User.vessels))
    )
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Reset password to default
    default_password = "Ozellar@123"
    user.password_hash = hash_password(default_password)
    user.updated_at = datetime.utcnow()
    await db.commit()

    try:
        await send_welcome_email(
            to_email=user.email,
            full_name=user.full_name,
            password=default_password,
            role=user.role,
            assigned_vessels=[v.name for v in user.vessels],
            permissions=user.permissions,
            created_by=admin.full_name,
        )
    except Exception as e:
        logger.error(f"Resend welcome email failed: {e}")
        raise HTTPException(status_code=500, detail="Failed to send email")

    return {"message": "Password reset and welcome email sent successfully"}

@router.post("/users", response_model=UserOut)
async def create_user(
    payload: UserCreate,
    db: AsyncSession = Depends(get_control_db),
    admin: User = Depends(get_current_admin),
):
    result = await db.execute(select(User).where(User.email == payload.email))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email already registered")

    user = User(
        full_name=payload.full_name,
        email=payload.email,
        password_hash=hash_password(payload.password),
        job_title=payload.job_title,
        role=payload.role,
        permissions=payload.permissions,
        can_self_assign_vessels=payload.can_self_assign_vessels,
        created_by=admin.id,
        updated_at=datetime.utcnow(),  # ← ADD
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


@router.patch("/users/{user_id}", response_model=UserOut)
async def update_user(
    user_id: uuid.UUID,
    payload: UserUpdate,
    db: AsyncSession = Depends(get_control_db),
    admin: User = Depends(get_current_admin),
):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    for field, value in payload.model_dump(exclude_unset=True).items():
        if field == "password":
            user.password_hash = hash_password(value)
        else:
            setattr(user, field, value)
    
    user.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(user)
    return user


class AssignVesselsPayload(BaseModel):
    vessel_imos: list[str]
    plain_password: Optional[str] = None

@router.put("/users/{user_id}/vessels", response_model=UserDetail)
async def assign_vessels(
    user_id: uuid.UUID,
    payload: AssignVesselsPayload,
    db: AsyncSession = Depends(get_control_db),
    admin: User = Depends(get_current_admin),
):
    result = await db.execute(
        select(User).where(User.id == user_id).options(selectinload(User.vessels))
    )
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    vessels_result = await db.execute(
        select(Vessel).where(Vessel.imo.in_(payload.vessel_imos))
    )
    vessels = vessels_result.scalars().all()

    user.vessels = vessels
    user.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(user)

    # Only send welcome email on new user creation (when password is provided)
    if payload.plain_password:
        try:
            await send_welcome_email(
                to_email=user.email,
                full_name=user.full_name,
                password=payload.plain_password,
                role=user.role,
                assigned_vessels=[v.name for v in vessels],
                permissions=user.permissions,
                created_by=admin.full_name,
            )
        except Exception as e:
            logger.error(f"Welcome email failed: {e}")

    return UserDetail(
        id=user.id,
        full_name=user.full_name,
        email=user.email,
        job_title=user.job_title,
        role=user.role,
        is_active=user.is_active,
        can_self_assign_vessels=user.can_self_assign_vessels,
        permissions=user.permissions,
        assigned_vessels=[{"imo": v.imo, "name": v.name} for v in user.vessels],
    )

@router.patch("/users/me/vessels", response_model=UserDetail)
async def self_assign_vessels(
    vessel_imos: list[str],
    db: AsyncSession = Depends(get_control_db),
    current_user: User = Depends(get_current_user),
):
    if not current_user.can_self_assign_vessels:
        raise HTTPException(status_code=403, detail="Not permitted to self-assign vessels")

    result = await db.execute(
        select(User).where(User.id == current_user.id).options(selectinload(User.vessels))
    )
    user = result.scalar_one_or_none()

    vessels_result = await db.execute(
        select(Vessel).where(Vessel.imo.in_(vessel_imos))
    )
    user.vessels = vessels_result.scalars().all()
    await db.commit()
    await db.refresh(user)

    return UserDetail(
        id=user.id,
        full_name=user.full_name,
        email=user.email,
        job_title=user.job_title,
        role=user.role,
        is_active=user.is_active,
        can_self_assign_vessels=user.can_self_assign_vessels,
        permissions=user.permissions,
        assigned_vessels=[{"imo": v.imo, "name": v.name} for v in user.vessels],
    )

# ADD THIS NEW ENDPOINT:
class JobTitleUpdate(BaseModel):
    job_title: str

@router.patch("/users/me/job-title")
async def update_own_job_title(
    payload: JobTitleUpdate,
    db: AsyncSession = Depends(get_control_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(User).where(User.id == current_user.id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    user.job_title = payload.job_title
    user.updated_at = datetime.utcnow()
    await db.commit()
    return {"message": "Job title updated successfully"}

# ADD after the job-title endpoint:
class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str

@router.post("/users/me/change-password")
async def change_password(
    payload: ChangePasswordRequest,
    db: AsyncSession = Depends(get_control_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(User).where(User.id == current_user.id))
    user = result.scalar_one_or_none()

    if not verify_password(payload.old_password, user.password_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect")

    if len(payload.new_password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")

    user.password_hash = hash_password(payload.new_password)
    user.updated_at = datetime.utcnow()
    await db.commit()
    return {"message": "Password changed successfully"}