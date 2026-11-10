import uuid

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.control_database import get_control_db
from app.models.control_user import ControlUser

settings = get_settings()

# Tokens are issued by workplace-backend; this service never logs anyone in.
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/login/access-token")

ACCESS_KEY = "incident_report"   # may open the module
CREATE_KEY = "incident_create"   # may create / edit / close incidents (granted to a few named users only)


def can_create(user: ControlUser) -> bool:
    # Deliberately not implied by ADMIN: creation belongs to the users this flag was granted to.
    return (user.permissions or {}).get(CREATE_KEY) is True


def has_module_access(user: ControlUser) -> bool:
    """ADMIN, or SHORE with the `incident_report` permission. Vessel users never get in."""
    return user.role == "ADMIN" or (user.role == "SHORE" and (user.permissions or {}).get(ACCESS_KEY) is True)


async def get_current_user(
    token: str = Depends(oauth2_scheme),
    control_db: AsyncSession = Depends(get_control_db),
) -> ControlUser:
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

    user = (await control_db.execute(select(ControlUser).where(ControlUser.id == user_uuid))).scalar_one_or_none()
    if user is None or not user.is_active:
        raise credentials_exception
    if not has_module_access(user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Incident module access not granted")
    return user


async def require_creator(user: ControlUser = Depends(get_current_user)) -> ControlUser:
    if not can_create(user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You are not allowed to create or change incidents")
    return user
