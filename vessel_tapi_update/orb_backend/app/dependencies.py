import logging
import uuid
from typing import List, Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.control_database import get_control_db
from app.database import get_db
from app.models.control_user import ControlUser
from app.models.vessel import Vessel

settings = get_settings()
logger = logging.getLogger(__name__)

# Tokens are issued by workplace-backend; this service never logs anyone in.
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/login/access-token")

ORB_PERMISSION_KEY = "orb"


async def get_current_user(
    token: str = Depends(oauth2_scheme),
    control_db: AsyncSession = Depends(get_control_db),
) -> ControlUser:
    """Decode the workplace JWT, load the user from the control DB and require
    ORB access: ADMIN, or SHORE / VESSEL with the `orb` permission switched on."""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        user_id = payload.get("sub")
        if not user_id:
            raise credentials_exception
        user_uuid = uuid.UUID(str(user_id))
    except (JWTError, ValueError):
        raise credentials_exception

    result = await control_db.execute(select(ControlUser).where(ControlUser.id == user_uuid))
    user = result.scalar_one_or_none()
    if user is None or not user.is_active:
        raise credentials_exception

    permissions = user.permissions or {}
    has_access = user.role == "ADMIN" or (user.role in ("SHORE", "VESSEL") and permissions.get(ORB_PERMISSION_KEY) is True)
    if not has_access:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="ORB module access not granted")

    try:
        link = await control_db.execute(
            text("SELECT vessel_imo FROM user_vessel_link WHERE user_id = :uid"),
            {"uid": str(user.id)},
        )
        user.assigned_vessels = [str(row[0]) for row in link.fetchall()]
    except Exception:
        logger.exception("Failed to load assigned vessels for user %s", user.id)
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Could not load vessel assignments")
    return user


async def require_admin(current_user: ControlUser = Depends(get_current_user)) -> ControlUser:
    if current_user.role != "ADMIN":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return current_user


async def require_shore(current_user: ControlUser = Depends(get_current_user)) -> ControlUser:
    """Shore-side routes (uploads, resolving alerts). Vessel users get Vessel View only."""
    if current_user.role not in ("ADMIN", "SHORE"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Shore access required")
    return current_user


async def shore_instance_only() -> None:
    """Routes that only the VM runs: uploads, extraction, alert regeneration and the shore's resolution steps.
    A vessel install holds copies of that data and never creates it."""
    if settings.is_offline_vessel:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This action is only available on the shore server")


def is_shore(user: ControlUser) -> bool:
    return user.role in ("ADMIN", "SHORE")


# ── Vessel scoping ───────────────────────────────────────────────────────────
# ADMIN sees every vessel; SHORE and VESSEL users only the vessels assigned to them in the
# control database. ORB's own `vessels` table is matched to those by IMO.

async def allowed_vessel_ids(user: ControlUser, db: AsyncSession) -> Optional[List[uuid.UUID]]:
    """None = no restriction (ADMIN). Otherwise the ORB vessel ids the user may see."""
    if user.role == "ADMIN":
        return None
    imos = user.assigned_vessels or []
    if not imos:
        return []
    rows = await db.execute(select(Vessel.id).where(Vessel.imo_number.in_(imos)))
    return [r[0] for r in rows.all()]


def scope_vessel_ids(requested: Optional[List[uuid.UUID]], allowed: Optional[List[uuid.UUID]]) -> Optional[List[uuid.UUID]]:
    """Combine a ?vessel_id= filter with the user's allowed vessels.
    Returns None for 'no filter', otherwise the list to filter on (may be empty)."""
    if allowed is None:
        return requested or None
    if requested:
        return [v for v in requested if v in allowed]
    return allowed


async def assert_vessel_access(user: ControlUser, db: AsyncSession, vessel_id: uuid.UUID) -> None:
    allowed = await allowed_vessel_ids(user, db)
    if allowed is not None and vessel_id not in allowed:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have access to this vessel")
