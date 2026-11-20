# ============================================================
# AUTH MODULE  (workplace login)
# ============================================================
# Vessel Performance no longer has its own users. A request carries the
# JWT issued by the workplace backend; the user is read (read-only) from the
# control database, the same way the ORB module does it.
#
# Access:
#   ADMIN  -> everything, incl. the admin-only routes
#   SHORE  -> only with permissions["vessel_performance"] == true
#   other roles -> no access
#
# Machine access: the voyage-report PDF page is rendered by a headless
# browser that holds a short-lived "render" token (create_render_token),
# valid for GET/HEAD requests only.
# ============================================================

import logging
import re
import threading
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from sqlalchemy import create_engine, text

from backend.config import config

logger = logging.getLogger(__name__)

ALGORITHM = "HS256"
PERMISSION_KEY = "vessel_performance"
RENDER_TOKEN_MINUTES = 5

bearer_scheme = HTTPBearer(auto_error=False)


@dataclass
class User:
    """The workplace user behind a request (read from the control database)."""
    id: uuid.UUID
    full_name: str
    email: str
    role: str
    permissions: dict = field(default_factory=dict)
    is_render: bool = False

    @property
    def username(self) -> str:
        """Name shown on rows this user writes (data-quality threads, CP overrides)."""
        return self.full_name or self.email


# ──────────────────────────────────────────────────────────────
# CONTROL DATABASE (read-only)
# ──────────────────────────────────────────────────────────────
_control_engine = None
_control_lock = threading.Lock()


def _get_control_engine():
    global _control_engine
    if _control_engine is None:
        with _control_lock:
            if _control_engine is None:
                url = config.CONTROL_DATABASE_URL
                if not url:
                    raise HTTPException(status_code=503, detail="CONTROL_DATABASE_URL is not configured")
                url = re.sub(r"^postgres(ql)?(\+\w+)?://", "postgresql+psycopg2://", url)
                _control_engine = create_engine(url, pool_pre_ping=True, pool_recycle=1800, pool_size=2, max_overflow=2)
    return _control_engine


def load_control_user(user_id: uuid.UUID) -> Optional[User]:
    with _get_control_engine().connect() as conn:
        row = conn.execute(
            text("SELECT id, full_name, email, role, is_active, permissions FROM users WHERE id = :id"),
            {"id": str(user_id)},
        ).first()
    if row is None or not row.is_active:
        return None
    return User(id=row.id if isinstance(row.id, uuid.UUID) else uuid.UUID(str(row.id)),
                full_name=row.full_name or "", email=row.email or "", role=row.role or "",
                permissions=row.permissions or {})


# ──────────────────────────────────────────────────────────────
# TOKENS
# ──────────────────────────────────────────────────────────────
def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, config.SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Could not validate credentials",
                            headers={"WWW-Authenticate": "Bearer"})


def create_render_token(minutes: int = RENDER_TOKEN_MINUTES) -> str:
    """Short-lived, read-only token for the headless browser that renders the voyage PDF."""
    exp = datetime.now(timezone.utc) + timedelta(minutes=minutes)
    return jwt.encode({"purpose": "vp_render", "exp": exp}, config.SECRET_KEY, algorithm=ALGORITHM)


# ──────────────────────────────────────────────────────────────
# FASTAPI DEPENDENCIES
# ──────────────────────────────────────────────────────────────
def get_db_for_auth():
    """Yields a session on the Vessel Performance database."""
    from backend.database import SessionLocal
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def has_vp_access(user: User) -> bool:
    if user.role == "ADMIN":
        return True
    return user.role in ("SHORE", "VESSEL") and user.permissions.get(PERMISSION_KEY) is True


def get_current_user(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
) -> User:
    if not credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated",
                            headers={"WWW-Authenticate": "Bearer"})
    payload = decode_token(credentials.credentials)

    if payload.get("purpose") == "vp_render":
        if request.method not in ("GET", "HEAD", "OPTIONS"):
            raise HTTPException(status_code=403, detail="This token is read-only")
        return User(id=uuid.UUID(int=0), full_name="Voyage report renderer", email="", role="RENDER", is_render=True)

    sub = payload.get("sub")
    try:
        user_id = uuid.UUID(str(sub))
    except (TypeError, ValueError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Could not validate credentials")
    try:
        user = load_control_user(user_id)
    except HTTPException:
        raise
    except Exception:
        logger.exception("Control database unavailable")
        raise HTTPException(status_code=503, detail="User service unavailable")
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Could not validate credentials")
    if not has_vp_access(user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Vessel Performance access not granted")
    return user


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role != "ADMIN":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return current_user


def require_person(current_user: User = Depends(get_current_user)) -> User:
    """A signed-in person (not the PDF renderer): for routes that record who did something."""
    if current_user.is_render:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not available to this token")
    return current_user
