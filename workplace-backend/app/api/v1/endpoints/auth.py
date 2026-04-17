import secrets
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from app.api.deps import get_control_db
from app.core.security import verify_password, create_access_token, hash_password
from app.core.email import send_password_reset_email, send_contact_email
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
        .where(User.email.ilike(form_data.username))
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


# ── Forgot Password ───────────────────────────────────────────────────────────

class ForgotPasswordRequest(BaseModel):
    email: str


@router.post("/auth/forgot-password")
async def forgot_password(
    payload: ForgotPasswordRequest,
    db: AsyncSession = Depends(get_control_db),
):
    result = await db.execute(select(User).where(User.email.ilike(payload.email)))
    user = result.scalar_one_or_none()

    if user and user.is_active:
        token = secrets.token_urlsafe(32)
        user.password_reset_token = token
        user.reset_token_expiry = datetime.utcnow() + timedelta(hours=1)
        await db.commit()
        await send_password_reset_email(
            to_email=user.email,
            full_name=user.full_name,
            token=token,
        )

    # Always return 200 — don't reveal whether the email exists
    return {"message": "If an account exists for that email, a reset link has been sent."}


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str


@router.post("/auth/reset-password")
async def reset_password(
    payload: ResetPasswordRequest,
    db: AsyncSession = Depends(get_control_db),
):
    result = await db.execute(
        select(User).where(User.password_reset_token == payload.token)
    )
    user = result.scalar_one_or_none()

    if not user or not user.reset_token_expiry or user.reset_token_expiry < datetime.utcnow():
        raise HTTPException(status_code=400, detail="Invalid or expired reset link.")

    if len(payload.new_password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters.")

    user.password_hash = hash_password(payload.new_password)
    user.password_reset_token = None
    user.reset_token_expiry = None
    user.updated_at = datetime.utcnow()
    await db.commit()

    return {"message": "Password reset successfully."}


# ── Contact Administrator ─────────────────────────────────────────────────────

class ContactRequest(BaseModel):
    name: str
    email: str
    message: str


@router.post("/contact")
async def contact_admin(payload: ContactRequest):
    await send_contact_email(
        name=payload.name,
        from_email=payload.email,
        message=payload.message,
    )
    return {"message": "Your message has been sent."}