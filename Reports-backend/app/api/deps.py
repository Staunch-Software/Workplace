# app/api/deps.py
# RBAC dependencies used by all route handlers.
# Roles: ADMIN, SHORE, VESSEL
# Shore-side routes are accessible to SHORE and ADMIN only.
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import jwt, JWTError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload
from sqlalchemy import text

from app.core.config import settings
from app.core.database_control import get_control_db

# We import the User model from the shared workplace-backend control DB.
# This means this backend does NOT manage users — it reads them from the shared DB.
try:
    from app.models.user import User  # type: ignore
except ImportError:
    # Fallback: minimal User class to allow the app to start if the control DB
    # User model is defined differently. In production, ensure the real User
    # model from workplace-backend is importable.
    from sqlalchemy import Column, String, Boolean, JSON
    from sqlalchemy.dialects.postgresql import UUID
    from app.core.database import Base
    import uuid

    class User(Base):  # type: ignore
        __tablename__ = "users"
        id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
        email = Column(String, unique=True, nullable=False)
        role = Column(String(20), nullable=False, default="VESSEL")
        full_name = Column(String(150), nullable=True)
        is_active = Column(Boolean, default=True)


oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/token")


async def get_current_user(
    token: str = Depends(oauth2_scheme),
    control_db: AsyncSession = Depends(get_control_db),
) -> User:
    """Decode JWT and load user from the shared control-plane DB."""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        user_id: str = payload.get("sub")
        if not user_id:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    stmt = select(User).where(User.id == user_id)
    result = await control_db.execute(stmt)
    user = result.scalars().first()

    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if not user.is_active:
        raise HTTPException(status_code=400, detail="Inactive user")

    # ── Inject assigned vessel IMOs from the user_vessel_link table ──
    # The JWT does NOT include assigned_vessels, so we query the DB directly.
    # This is used by list_reports/feed to restrict VESSEL users to their own vessel.
    try:
        link_result = await control_db.execute(
            text("SELECT vessel_imo FROM user_vessel_link WHERE user_id = :uid"),
            {"uid": str(user.id)}
        )
        user.assigned_vessels = [row[0] for row in link_result.fetchall()]
    except Exception as e:
        # IMPORTANT: use None (not []) to mean "lookup failed", distinct from
        # a VESSEL user who genuinely has zero vessels assigned ([]). Callers
        # that restrict VESSEL users by assigned_vessels must check for this
        # sentinel and fail loudly instead of silently returning an empty
        # list, which used to make a transient error (e.g. control-DB pool
        # exhaustion -- this pool is deliberately tiny, see database_control.py)
        # indistinguishable from "you have no vessel assigned".
        import logging
        logging.getLogger("deps").error(
            f"Failed to load assigned_vessels for user {user.id}: {e}"
        )
        user.assigned_vessels = None

    return user


# ── RBAC Guards ────────────────────────────────────────────────────────────────

async def require_shore(
    current_user: User = Depends(get_current_user),
) -> User:
    """
    Allows only SHORE and ADMIN roles.
    VESSEL users get 403.
    """
    if current_user.role not in ("SHORE", "ADMIN"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Shore/Admin access only."
        )
    return current_user


async def require_admin(
    current_user: User = Depends(get_current_user),
) -> User:
    """
    Allows only ADMIN role.
    Used for sensitive actions like force-triggering scraper or deleting reports.
    """
    if current_user.role != "ADMIN":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access only."
        )
    return current_user


async def require_any(
    current_user: User = Depends(get_current_user),
) -> User:
    """Allows any authenticated user (SHORE, ADMIN, VESSEL)."""
    return current_user
