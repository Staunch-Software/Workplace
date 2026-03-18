from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.core.database_control import get_control_db as get_db
from app.models.control.user import User
from app.models.control.vessel import Vessel as ControlVessel
from app.routes.auth import get_current_user, require_admin
from pydantic import BaseModel
from typing import Optional, List
import logging
import bcrypt
import uuid

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/admin", tags=["Admin"])

# ======================= MODELS =======================

class ActivateUserRequest(BaseModel):
    role: str  # Should be "SHORE", "VESSEL", or "ADMIN"

class CreateLocalUserWithPermsRequest(BaseModel):
    full_name: str                          # ✅ was 'name' in old model
    email: str
    password: str
    role: str = "VESSEL"                    # ✅ "SHORE" or "VESSEL" or "ADMIN"
    job_title: Optional[str] = None
    assigned_vessels: List[str] = []        # ✅ list of vessel IDs (used for user_vessel_link)
    permissions: Optional[dict] = {
        "drs": False,
        "jira": False,
        "voyage": False,
        "lubeoil": False,
        "engine_performance": False
    }

# ======================= ROUTES =======================

@router.get("/users")
async def list_users(
    db: Session = Depends(get_db),
    admin: dict = Depends(require_admin)
):
    try:
        admin_role = str(admin.get("role") or "").upper()
        logger.info(f"📋 Fetching users - Role: {admin_role}")

        # Superuser and Admin can see all users
        users = db.query(User).all()

        return {
            "users": [
                {
                    "id": str(u.id),
                    "email": u.email,
                    "full_name": u.full_name,           # ✅ was 'name'
                    "role": u.role,                     # ✅ "SHORE"/"VESSEL"/"ADMIN"
                    "job_title": u.job_title,
                    "is_active": u.is_active,
                    "permissions": u.permissions or {},
                    "can_self_assign_vessels": u.can_self_assign_vessels,
                    "created_at": u.created_at.isoformat() if u.created_at else None,
                    "created_by": str(u.created_by) if u.created_by else "System"
                }
                for u in users
            ]
        }
    except Exception as e:
        logger.error(f"❌ Error fetching users: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/users/{user_id}/activate")
async def activate_user(
    user_id: str,                           # ✅ UUID string now, not int
    request: ActivateUserRequest,
    db: Session = Depends(get_db),
    admin: dict = Depends(require_admin)
):
    try:
        user = db.query(User).filter(User.id == uuid.UUID(user_id)).first()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        user.is_active = True
        user.role = request.role.upper()    # ✅ normalize to uppercase
        db.commit()
        return {"message": "User activated", "user": {"id": str(user.id), "role": user.role}}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/users/{user_id}/deactivate")
async def deactivate_user(
    user_id: str,                           # ✅ UUID string now, not int
    db: Session = Depends(get_db),
    admin: dict = Depends(require_admin)
):
    try:
        user = db.query(User).filter(User.id == uuid.UUID(user_id)).first()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        if str(user.id) == admin.get("id"):
            raise HTTPException(status_code=400, detail="Cannot deactivate yourself")

        user.is_active = False
        db.commit()
        return {"message": "User deactivated"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/summary")
async def get_summary(
    db: Session = Depends(get_db),
    admin: dict = Depends(require_admin)
):
    try:
        users = db.query(User).all()
        total = len(users)
        active = len([u for u in users if u.is_active])

        return {
            "summary": {
                "total_users": total,
                "active_users": active,
                "pending_users": total - active
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/local-users")
async def create_local_user_with_permissions(
    request: CreateLocalUserWithPermsRequest,
    db: Session = Depends(get_db),
    admin: dict = Depends(require_admin)
):
    try:
        logger.info(f"👤 Creating local user: {request.email}")

        existing = db.query(User).filter_by(email=request.email).first()
        if existing:
            raise HTTPException(status_code=400, detail="Email already exists")

        admin_id = admin.get("id")

        # Hash password
        password_hash = bcrypt.hashpw(
            request.password.encode('utf-8'),
            bcrypt.gensalt()
        ).decode('utf-8')

        new_user = User(
            full_name=request.full_name,            # ✅ was 'name'
            email=request.email,
            password_hash=password_hash,
            role=request.role.upper(),              # ✅ normalize: "SHORE"/"VESSEL"/"ADMIN"
            job_title=request.job_title,
            is_active=True,
            permissions=request.permissions or {
                "drs": False,
                "jira": False,
                "voyage": False,
                "lubeoil": False,
                "engine_performance": False
            },
            created_by=uuid.UUID(admin_id) if admin_id else None
        )

        db.add(new_user)
        db.commit()
        db.refresh(new_user)

        # ✅ Handle vessel assignments via user_vessel_link (replaces assigned_vessels column)
        if request.assigned_vessels:
            vessels = db.query(ControlVessel).filter(
                ControlVessel.id.in_(request.assigned_vessels)
            ).all()
            new_user.vessels = vessels
            db.commit()

        logger.info(f"✅ User created: {new_user.email}, role: {new_user.role}")
        return {
            "message": "User created successfully",
            "user": {
                "id": str(new_user.id),
                "email": new_user.email,
                "full_name": new_user.full_name,
                "role": new_user.role
            }
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Error creating user: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/users/{user_id}/permissions")
async def update_user_permissions(
    user_id: str,
    permissions: dict,
    db: Session = Depends(get_db),
    admin: dict = Depends(require_admin)
):
    try:
        user = db.query(User).filter(User.id == uuid.UUID(user_id)).first()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        user.permissions = permissions
        db.commit()
        return {"message": "Permissions updated", "permissions": user.permissions}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/users/{user_id}/vessels")
async def update_user_vessels(
    user_id: str,
    vessel_ids: List[str],
    db: Session = Depends(get_db),
    admin: dict = Depends(require_admin)
):
    """Assign vessels to a user via user_vessel_link (replaces old assigned_vessels column)."""
    try:
        user = db.query(User).filter(User.id == uuid.UUID(user_id)).first()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        vessels = db.query(ControlVessel).filter(
            ControlVessel.id.in_(vessel_ids)
        ).all()
        user.vessels = vessels
        db.commit()

        return {
            "message": "Vessels updated",
            "assigned_vessels": [str(v.id) for v in user.vessels]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))