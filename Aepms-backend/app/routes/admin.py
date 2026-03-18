from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.core.database_control import get_control_db as get_db
from app.model.control.user import User
# ✅ IMPORT require_admin FROM auth.py (Resolves NameError)
from app.routes.auth import get_current_user, require_admin
from pydantic import BaseModel
from typing import Optional, List 
import logging
import bcrypt

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/admin", tags=["Admin"])

# ======================= MODELS =======================

class ActivateUserRequest(BaseModel):
    role: str

class CreateLocalUserWithPermsRequest(BaseModel):
    full_name: str
    email: str
    password: str
    role: str = "VESSEL"
    job_title: str
    # ✅ FIX 422 ERROR: Made optional with default empty dict
    endpoint_permissions: Optional[dict] = {} 

# ======================= ROUTES =======================

@router.get("/users")
async def list_users(db: Session = Depends(get_db), admin: dict = Depends(require_admin)):
    try:
        user_role = admin.get("role", "VESSEL")
        
        logger.info(f"📋 Fetching users - Role: {user_role}")
        
        if user_role in ("ADMIN", "SUPERUSER"):
            users = db.query(User).all()
        else:
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        return {
            "users": [
                {
                    "id": str(u.id),
                    "email": u.email,
                    "full_name": u.full_name,
                    "role": u.role,
                    "job_title": u.job_title,
                    "is_active": u.is_active,
                    "permissions": u.permissions or {},
                    "created_at": u.created_at.isoformat() if hasattr(u, 'created_at') and u.created_at else None,
                    "created_by": str(u.created_by) if u.created_by else None
                }
                for u in users
            ]
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Error fetching users: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/users/{user_id}/activate")
async def activate_user(
    user_id: str,
    request: ActivateUserRequest,
    db: Session = Depends(get_db),
    admin: dict = Depends(require_admin)
):
    try:
        user = db.query(User).filter_by(id=user_id).first()
        if not user: raise HTTPException(status_code=404, detail="User not found")
        
        user.is_active = True
        user.role = request.role
        db.commit()
        return {"message": "User activated", "user": {"id": str(user.id), "role": user.role}}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/users/{user_id}/deactivate")
async def deactivate_user(
    user_id: str,
    db: Session = Depends(get_db),
    admin: dict = Depends(require_admin)
):
    try:
        user = db.query(User).filter_by(id=user_id).first()
        if not user: raise HTTPException(status_code=404, detail="User not found")
        if str(user.id) == admin.get("id"): raise HTTPException(status_code=400, detail="Cannot deactivate yourself")
        
        user.is_active = False
        db.commit()
        return {"message": "User deactivated"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/summary")
async def get_summary(db: Session = Depends(get_db), admin: dict = Depends(require_admin)):
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

# ✅ FIX 404 ERROR: Changed URL to '/local-users' to match frontend
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
        password_hash = bcrypt.hashpw(request.password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
        
        new_user = User(
            full_name=request.full_name,
            email=request.email,
            password_hash=password_hash,
            role=request.role,
            job_title=request.job_title,
            is_active=True,         # Auto-active
            permissions=request.endpoint_permissions or {}, # Handle optional permissions
            created_by=admin_id
        )
        
        db.add(new_user)
        db.commit()
        db.refresh(new_user)
        
        logger.info(f"✅ Local user created: {new_user.id}")
        
        return {
            "message": "Local user created successfully",
            "user": {
                "id": str(new_user.id),
                "email": new_user.email,
                "role": new_user.role
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Error creating user: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.patch("/users/{user_id}/permissions")
async def update_user_permissions(
    user_id: str, 
    request: dict, 
    db: Session = Depends(get_db), 
    admin: dict = Depends(require_admin)
):
    try:
        user = db.query(User).filter_by(id=user_id).first()
        if not user: raise HTTPException(status_code=404, detail="User not found")
        user.permissions = request.get("permissions", {})
        db.commit()
        return {"message": "Permissions updated"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))