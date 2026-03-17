from fastapi import APIRouter, HTTPException, status, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
from typing import Optional, List
from app.core.database_control import get_control_db as get_db
from app.models.control.user import User
from datetime import datetime
from sqlalchemy.orm import Session
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
    name: str
    oid: Optional[str] = None
    auth_type: str
    role: Optional[str] = "user"
    access_type: Optional[str] = "VESSEL"

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserResponse

class ProtectedDataResponse(BaseModel):
    message: str
    user_id: str
    user_email: str
    roles: List[str]

# ======================= DEPENDENCIES =======================

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    """Dependency to verify JWT token and extract current user."""
    token = credentials.credentials
    payload = verify_application_jwt(token)
    return payload

# ✅ MOVED HERE: This fixes the Circular Dependency/NameError
def require_admin(current_user: dict = Depends(get_current_user)):
    """Check if user has admin role."""
    roles = current_user.get("roles", [])
    user_role = roles[0] if isinstance(roles, list) and len(roles) > 0 else "user"
    
    logger.info(f"🔐 Admin check for {current_user.get('email')} with role: {user_role}")
    
    if user_role not in ["admin", "superuser"]:
        logger.warning(f"❌ Non-admin access attempt by {current_user.get('email')}")
        raise HTTPException(status_code=403, detail=f"Admin access required. Your role: {user_role}")
    
    return current_user

# ======================= ROUTES =======================

@router.post("/sso/microsoft", response_model=TokenResponse)
async def microsoft_sso_login(request: MicrosoftSSORequest, db: Session = Depends(get_db)):
    try:
        # Validate Microsoft token
        ms_user_info = validate_microsoft_token(request.id_token)
        
        # Check if user exists in database
        user = db.query(User).filter_by(email=ms_user_info["email"]).first()
        
        if not user:
            # NEW USER - Create as INACTIVE
            email_domain = ms_user_info["email"].split("@")[1]
            
            # Find organization by domain
            org = db.query(Organization).filter_by(domain=email_domain).first()
            if not org:
                org = db.query(Organization).filter_by(id=1).first()  # Default to Staunch
            
            user = User(
                name=ms_user_info["name"],
                email=ms_user_info["email"],
                role="user",
                is_active=False,
                auth_type="microsoft",
                organization_id=org.id
            )
            
            db.add(user)
            db.commit()
            
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
        db.commit()
        
        app_token = create_application_jwt({
            "id": str(user.id),
            "email": user.email,
            "name": user.name,
            "auth_type": "microsoft",
            "roles": [user.role],
            "access_type": user.access_type,
            "organization_id": user.organization_id,
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
                name=user.name,
                auth_type="microsoft",
                role=user.role,
                access_type=user.access_type
            )
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Microsoft SSO error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/local/login", response_model=TokenResponse)
async def local_login(request: LocalLoginRequest, db: Session = Depends(get_db)):
    """Local authentication endpoint."""
    
    # --- ADMIN BYPASS FOR TESTING ---
    if request.email == "Admin" and request.password == "Admin@123":
        logger.warning("⚠️ ADMIN TESTING CREDENTIALS USED")
        mock_payload = {
            "id": "999", "email": "Admin", "name": "System Administrator",
            "auth_type": "local", "roles": ["admin", "superuser"], 
            "access_type": "SHORE",
            "organization_id": 1, "permissions": {} 
        }
        app_token = create_application_jwt(mock_payload)
        from app.config import settings
        return TokenResponse(
            access_token=app_token, expires_in=settings.APP_JWT_EXPIRE_MINUTES * 60,
            user=UserResponse(
                id="999", 
                email="Admin", 
                name="System Admin", 
                auth_type="local", 
                role="admin",
                access_type="SHORE"  # <--- ✅ ADD THIS HERE
            )
        )
    # --------------------------------

    user = db.query(User).filter_by(email=request.email).first()
    
    if not user:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    
    if not user.password_hash:
        raise HTTPException(status_code=403, detail="Local login disabled. Use SSO.")
    
    if not bcrypt.checkpw(request.password.encode('utf-8'), user.password_hash.encode('utf-8')):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account not activated")
    
    user.last_login = datetime.utcnow()
    db.commit()
    
    app_token = create_application_jwt({
        "id": str(user.id),
        "email": user.email,
        "name": user.name,
        "auth_type": "local",
        "roles": [user.role],
        "access_type": user.access_type,
        "organization_id": user.organization_id,
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
            name=user.name,
            auth_type="local",
            role=user.role,
            access_type=user.access_type
        )
    )

@router.get("/me", response_model=UserResponse)
async def get_current_user_info(current_user: dict = Depends(get_current_user)):
    return UserResponse(
        id=current_user["sub"],
        email=current_user["email"],
        name=current_user["name"],
        oid=current_user.get("oid"),
        auth_type=current_user.get("auth_type", "unknown"),
        role=current_user.get("roles", ["user"])[0],
         access_type=current_user.get("access_type", "VESSEL")
    )

@router.get("/check-access")
async def check_page_access(page: str, current_user: dict = Depends(get_current_user)):
    # Permissive mode: Always return True
    return {"page": page, "has_access": True, "endpoint": "permissive_mode"}

@router.post("/logout")
async def logout(current_user: dict = Depends(get_current_user)):
    return {"message": "Logged out successfully"}