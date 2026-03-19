from fastapi import APIRouter, HTTPException, status, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
from typing import Optional, List
from app.core.database_control import get_control_db as get_db
from app.models.control.user import User
from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncSession
import bcrypt
import logging
from app.utils.auth_utils import (
    validate_microsoft_token,
    create_application_jwt,
    verify_application_jwt
)

router = APIRouter()
security = HTTPBearer()
logger = logging.getLogger(__name__)

# ======================= MODELS =======================

class MicrosoftSSORequest(BaseModel):
    id_token: str

class LocalLoginRequest(BaseModel):
    email: str
    password: str

class UserResponse(BaseModel):
    id: str
    email: str
    full_name: str
    role: str
    # ✅ oid and auth_type kept as optional so /me does not break
    # if frontend still reads them — they just return None/"unknown"
    oid: Optional[str] = None
    auth_type: Optional[str] = "local"

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserResponse

# ✅ Kept — was in original, may be used by other routes importing it
class ProtectedDataResponse(BaseModel):
    message: str
    user_id: str
    user_email: str
    roles: List[str]

# ======================= DEPENDENCIES =======================

async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security)
) -> dict:
    """Dependency to verify JWT token and extract current user."""
    token = credentials.credentials
    payload = verify_application_jwt(token)
    return payload

def require_admin(current_user: dict = Depends(get_current_user)):
    """Check if user has admin role."""
    user_role = str(current_user.get("role") or "VESSEL").upper()
    if user_role not in ["ADMIN", "SUPERUSER"]:
        raise HTTPException(
            status_code=403,
            detail=f"Admin access required. Your role: {user_role}"
        )
    return current_user

# ======================= ROUTES =======================

@router.post("/sso/microsoft", response_model=TokenResponse)
async def microsoft_sso_login(
    request: MicrosoftSSORequest,
    db: AsyncSession = Depends(get_db)
):
    try:
        from sqlalchemy import select
        ms_user_info = validate_microsoft_token(request.id_token)
        result = await db.execute(select(User).where(User.email == ms_user_info["email"]))
        user = result.scalars().first()

        if not user:
            # NEW USER - Create as INACTIVE
            # ✅ Removed Organization lookup — not in new model
            # ✅ Added password_hash placeholder — column is NOT NULL
            user = User(
                full_name=ms_user_info["name"],
                email=ms_user_info["email"],
                password_hash="SSO_USER_NO_PASSWORD",
                role="VESSEL",          # ✅ default role, admin changes later
                is_active=False,
            )

            db.add(user)
            await db.commit()

            raise HTTPException(
                status_code=403,
                detail={
                    "type": "pending_approval",
                    "message": "Your access request has been submitted. Please contact your administrator.",
                    "email": ms_user_info["email"]
                }
            )

        if not user.is_active:
            raise HTTPException(
                status_code=403,
                detail={
                    "type": "pending_approval",
                    "message": "Your account is pending approval.",
                    "email": user.email
                }
            )

        user.last_login = datetime.utcnow()
        await db.commit()

        logger.info(f"[SSO LOGIN] user: {user.email}, role from DB: '{user.role}'")

        # ✅ Removed auth_type and organization_id — not in new model
        app_token = create_application_jwt({
            "id": str(user.id),
            "email": user.email,
            "full_name": user.full_name,
            "role": user.role,
            "permissions": user.permissions or {}
        })

        from app.config import settings

        return TokenResponse(
            access_token=app_token,
            token_type="bearer",
            expires_in=settings.APP_JWT_EXPIRE_MINUTES * 60,
            user=UserResponse(
                id=str(user.id),
                email=user.email,
                full_name=user.full_name,
                role=user.role,
                auth_type="microsoft"   # ✅ hardcoded string, not from DB column
            )
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Microsoft SSO error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/local/login", response_model=TokenResponse)
async def local_login(
    request: LocalLoginRequest,
    db: AsyncSession = Depends(get_db)
):
    """Local authentication endpoint."""

    # --- ADMIN BYPASS FOR TESTING ---
    if request.email == "Admin" and request.password == "Admin@123":
        logger.warning("⚠️ ADMIN TESTING CREDENTIALS USED")
        mock_payload = {
            "id": "999",
            "email": "Admin",
            "full_name": "System Administrator",
            "role": "ADMIN",            # ✅ removed auth_type, organization_id
            "permissions": {}
        }
        app_token = create_application_jwt(mock_payload)
        from app.config import settings
        return TokenResponse(
            access_token=app_token,
            expires_in=settings.APP_JWT_EXPIRE_MINUTES * 60,
            user=UserResponse(
                id="999",
                email="Admin",
                full_name="System Administrator",  # ✅ was name= in original — fixed
                role="ADMIN",
                auth_type="local"
            )
        )
    # --------------------------------

    from sqlalchemy import select
    result = await db.execute(select(User).where(User.email == request.email))
    user = result.scalars().first()

    # ✅ Moved null check BEFORE logger to prevent crash on missing user
    if not user:
        raise HTTPException(status_code=401, detail="Invalid email or password")

    logger.info(f"[LOGIN] user found: {user.email}, role from DB: '{user.role}', is_active: {user.is_active}")

    if not user.password_hash or user.password_hash == "SSO_USER_NO_PASSWORD":
        raise HTTPException(status_code=403, detail="Local login disabled. Use SSO.")

    if not bcrypt.checkpw(
        request.password.encode('utf-8'),
        user.password_hash.encode('utf-8')
    ):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account not activated")

    user.last_login = datetime.utcnow()
    await db.commit()

    # ✅ Removed auth_type and organization_id — not in new model
    app_token = create_application_jwt({
        "id": str(user.id),
        "email": user.email,
        "full_name": user.full_name,
        "role": user.role,
        "permissions": user.permissions or {}
    })

    from app.config import settings

    return TokenResponse(
        access_token=app_token,
        token_type="bearer",
        expires_in=settings.APP_JWT_EXPIRE_MINUTES * 60,
        user=UserResponse(
            id=str(user.id),
            email=user.email,
            full_name=user.full_name,
            role=user.role,
            auth_type="local"           # ✅ hardcoded string, not from DB column
        )
    )


@router.get("/me", response_model=UserResponse)
async def get_current_user_info(
    current_user: dict = Depends(get_current_user)
):
    return UserResponse(
        id=current_user["id"],
        email=current_user["email"],
        full_name=current_user.get("full_name", ""),
        role=current_user.get("role", "VESSEL"),
        oid=current_user.get("oid"),                        # ✅ kept — returns None if not present
        auth_type=current_user.get("auth_type", "unknown")  # ✅ kept — returns "unknown" if not present
    )


@router.get("/check-access")
async def check_page_access(
    page: str,
    current_user: dict = Depends(get_current_user)
):
    # Permissive mode: Always return True
    return {"page": page, "has_access": True, "endpoint": "permissive_mode"}


@router.post("/logout")
async def logout(current_user: dict = Depends(get_current_user)):
    return {"message": "Logged out successfully"}