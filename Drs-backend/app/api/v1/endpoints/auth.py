from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from typing import List, Optional

from app.core.database import get_db
from app.models.user import User
from app.core.security import verify_password, create_access_token

router = APIRouter()

# --- INPUT SCHEMA ---
class LoginRequest(BaseModel):
    username: str # This receives the Email
    password: str

# --- OUTPUT SCHEMA ---
class UserLoginResponse(BaseModel):
    id: str
    email: str
    full_name: str
    role: str
    job_title: Optional[str] = None
    assigned_vessels: List[str] = [] # List of IMO numbers
    access_token: str
    token_type: str

@router.post("/access-token", response_model=UserLoginResponse)
async def login_access_token(
    form_data: LoginRequest, 
    db: AsyncSession = Depends(get_db)
):
    # 1. Fetch User from DB (and load their vessels)
    # We use 'selectinload' to efficiently fetch the Many-to-Many relationship
    stmt = (
        select(User)
        .where(User.email == form_data.username)
        .options(selectinload(User.vessels))
    )
    result = await db.execute(stmt)
    user = result.scalars().first()

    # 2. Verify Email and Password
    if not user:
        # Security: Don't reveal if email exists or not
        raise HTTPException(status_code=401, detail="Incorrect email or password")
    
    if not verify_password(form_data.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Incorrect email or password")

    if not user.is_active:
        raise HTTPException(status_code=400, detail="User account is inactive")

    # 3. Generate Token
    access_token = create_access_token(subject=user.id)

    # 4. Extract Vessel IMOs for the Frontend
    vessel_imos = [v.imo for v in user.vessels]

    # 5. Return Data
    return {
        "id": str(user.id),
        "email": user.email,
        "full_name": user.full_name,
        "role": user.role,
        "job_title": user.job_title,
        "assigned_vessels": vessel_imos,
        "access_token": access_token,
        "token_type": "bearer"
    }