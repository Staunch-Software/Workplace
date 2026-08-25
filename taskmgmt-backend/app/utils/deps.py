# FastAPI auth dependencies. No middleware layer here on purpose — lub_backend's
# permission_check.py middleware is imported but never registered there (dead code);
# this service enforces auth as an explicit per-route Depends instead.
import uuid

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.utils.auth_utils import verify_application_jwt
from app.core.database_control import get_control_db
from app.models.control.user import User


def get_current_user(request: Request) -> dict:
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing token")
    token = auth_header.split(" ", 1)[1]
    return verify_application_jwt(token)


def require_admin(current_user: dict = Depends(get_current_user)) -> dict:
    role = current_user.get("role")
    permissions = current_user.get("permissions") or {}
    if role != "ADMIN" and not permissions.get("task_management"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized for Task Management")
    return current_user


async def require_survey_coordinator(
    current_user: dict = Depends(get_current_user),
    control_db: AsyncSession = Depends(get_control_db),
) -> dict:
    """Gates the 1.W.4 survey-cycle-review page to users whose task-management role_code is
    SURVEY_COORDINATOR. role_code (SURVEY_COORDINATOR/TA/TSI/TM) isn't carried in the JWT —
    create_access_token in workplace-backend/app/core/security.py only mints the
    platform-wide role (ADMIN/SHORE/VESSEL) plus a permissions dict — so this looks it up
    fresh from the control DB by the token's subject on every request. ADMIN keeps the same
    superuser override require_admin already uses, for consistency."""
    if current_user.get("role") == "ADMIN":
        return current_user

    permissions = current_user.get("permissions") or {}
    if not permissions.get("task_management"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized for Task Management")

    try:
        user_id = uuid.UUID(str(current_user.get("sub")))
    except (ValueError, TypeError):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Could not resolve current user")

    res = await control_db.execute(select(User.role_code).where(User.id == user_id))
    role_code = res.scalar_one_or_none()
    if role_code != "SURVEY_COORDINATOR":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This page is only available to the Survey Coordinator role",
        )
    return current_user
