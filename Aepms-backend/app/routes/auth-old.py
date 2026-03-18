from fastapi import APIRouter, HTTPException, status, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, EmailStr
from typing import Optional, List
from app.database import get_db
from app.models import User
from app.models import Organization
from datetime import datetime
from sqlalchemy.orm import Session
import bcrypt  # ✅ ADD THIS LINE
import logging  # ✅ ADD THIS LINE
from app.utils.auth_utils import (
    validate_microsoft_token,
    create_application_jwt,
    verify_application_jwt
)

router = APIRouter()
security = HTTPBearer()
logger = logging.getLogger(__name__) 


# Pydantic Models
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


# Dependency to get current user from JWT
async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    """Dependency to verify JWT token and extract current user."""
    token = credentials.credentials
    payload = verify_application_jwt(token)
    return payload


@router.post("/sso/microsoft", response_model=TokenResponse)
async def microsoft_sso_login(request: MicrosoftSSORequest, db: Session = Depends(get_db)):
    try:
        # ✅ Validate Microsoft token
        ms_user_info = validate_microsoft_token(request.id_token)
        
        # ✅ Check if user exists in database
        user = db.query(User).filter_by(email=ms_user_info["email"]).first()
        
        if not user:
            # ✅ NEW USER - Create as INACTIVE and send clear message
            email_domain = ms_user_info["email"].split("@")[1]
            
            # Find organization by domain
            org = db.query(Organization).filter_by(domain=email_domain).first()
            if not org:
                org = db.query(Organization).filter_by(id=1).first()  # Default to Staunch
            
            # Create new user (INACTIVE by default)
            user = User(
                name=ms_user_info["name"],
                email=ms_user_info["email"],
                role="user",  # Default role
                is_active=False,  # ✅ INACTIVE until admin approves
                auth_type="microsoft",
                organization_id=org.id
            )
            
            db.add(user)
            db.commit()
            
            # ✅ Return 403 with clear message for new users
            raise HTTPException(
                status_code=403, 
                detail={
                    "type": "pending_approval",
                    "message": "Your access request has been submitted. Please contact your administrator for approval.",
                    "email": ms_user_info["email"],
                    "organization": org.name
                }
            )
        
        # ✅ Check if existing user is activated
        if not user.is_active:
            raise HTTPException(
                status_code=403, 
                detail={
                    "type": "pending_approval",
                    "message": "Your account is pending approval. Please contact your administrator.",
                    "email": user.email
                }
            )
        
        # ✅ Update last login timestamp
        user.last_login = datetime.utcnow()
        db.commit()
        
        # ✅ Create JWT token with user info
        app_token = create_application_jwt({
            "id": str(user.id),
            "email": user.email,
            "name": user.name,
            "auth_type": "microsoft",
            "roles": [user.role],
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
                role=user.role
            )
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Microsoft SSO error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/local/login", response_model=TokenResponse)
async def local_login(request: LocalLoginRequest, db: Session = Depends(get_db)):
    """Local authentication endpoint (email/password). Works for any user that has a password set."""
    
    # Find user by email regardless of auth_type; local login should work if password is set
    user = db.query(User).filter_by(email=request.email).first()
    
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")
    
    # Ensure local credentials are configured
    if not user.password_hash:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Local login disabled for this account. Use SSO or ask admin to set a password.")
    
    password_bytes = request.password.encode('utf-8')
    hashed_bytes = user.password_hash.encode('utf-8')
    
    if not bcrypt.checkpw(password_bytes, hashed_bytes):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")
    
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account not activated")
    
    user.last_login = datetime.utcnow()
    db.commit()
    
    # 🔍 DEBUG: Log permissions being added to token
    user_permissions = user.permissions or {}
    logger.info(f"=" * 60)
    logger.info(f"🔑 TOKEN CREATION DEBUG")
    logger.info(f"User: {user.email}")
    logger.info(f"Permissions from DB: {user_permissions}")
    logger.info(f"Permissions type: {type(user_permissions)}")
    logger.info(f"=" * 60)
    
    # ✅ CREATE JWT TOKEN WITH PERMISSIONS
    app_token = create_application_jwt({
        "id": str(user.id),
        "email": user.email,
        "name": user.name,
        "auth_type": "local",
        "roles": [user.role],
        "organization_id": user.organization_id,
        "permissions": user_permissions  # ✅ This MUST be included
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
            role=user.role
        )
    )


@router.get("/me", response_model=UserResponse)
async def get_current_user_info(current_user: dict = Depends(get_current_user)):
    """Get current authenticated user information."""
    return UserResponse(
        id=current_user["sub"],
        email=current_user["email"],
        name=current_user["name"],
        oid=current_user.get("oid"),
        auth_type=current_user.get("auth_type", "unknown"),
        role=current_user.get("roles", ["user"])[0]
    )


@router.get("/protected/data", response_model=ProtectedDataResponse)
async def get_protected_data(current_user: dict = Depends(get_current_user)):
    """Example protected endpoint - requires valid JWT token."""
    return ProtectedDataResponse(
        message="This is protected data accessible only with valid JWT",
        user_id=current_user["sub"],
        user_email=current_user["email"],
        roles=current_user.get("roles", [])
    )


@router.post("/logout")
async def logout(current_user: dict = Depends(get_current_user)):
    """
    Logout endpoint - in a stateless JWT system, this mainly serves
    as confirmation. Actual token invalidation happens on the client side.
    """
    return {"message": "Logged out successfully"}
@router.get("/check-access")
async def check_page_access(page: str, current_user: dict = Depends(get_current_user)):
    """Check if user has access to a specific page"""
    try:
        user_roles = current_user.get("roles", [])
        permissions = current_user.get("permissions", {})
        user_email = current_user.get("email", "unknown")
        
        # 🔍 DEBUG: Log everything
        logger.info(f"=" * 60)
        logger.info(f"🔍 ACCESS CHECK DEBUG")
        logger.info(f"Page requested: {page}")
        logger.info(f"User: {user_email}")
        logger.info(f"Roles: {user_roles}")
        logger.info(f"Permissions from token: {permissions}")
        logger.info(f"Permissions type: {type(permissions)}")
        
        # ✅ Admins and superusers have FULL ACCESS
        if "superuser" in user_roles or "admin" in user_roles:
            logger.info(f"✅ Full access granted (admin/superuser)")
            logger.info(f"=" * 60)
            return {"page": page, "has_access": True, "endpoint": "full_access"}
        
        # ✅ Map frontend page names to backend endpoints
        endpoint_map = {
            "dashboard": ["/api/dashboard/kpis", "/api/dashboard/kpis/"],
            "performance": ["/api/performance/", "/api/performance"],
            "fleet": ["/api/fleet/", "/api/fleet"]
        }
        
        possible_endpoints = endpoint_map.get(page.lower(), [])
        logger.info(f"Checking endpoints: {possible_endpoints}")
        
        if not possible_endpoints:
            logger.warning(f"⚠️ Unknown page: {page}")
            return {"page": page, "has_access": False, "endpoint": None}
        
        # ✅ Check each possible endpoint
        has_access = False
        matched_endpoint = None
        
        for endpoint in possible_endpoints:
            perm_value = permissions.get(endpoint)
            logger.info(f"  Checking '{endpoint}': {perm_value}")
            if perm_value is True:
                has_access = True
                matched_endpoint = endpoint
                logger.info(f"  ✅ MATCH FOUND!")
                break
        
        logger.info(f"Final result: {has_access}")
        logger.info(f"=" * 60)
        
        return {
            "page": page, 
            "has_access": has_access, 
            "endpoint": matched_endpoint or possible_endpoints[0],
            "user_role": user_roles[0] if user_roles else "user",
            "debug_permissions": permissions  # ✅ Send back for debugging
        }
    
    except Exception as e:
        logger.error(f"❌ Error in access check: {e}", exc_info=True)
        return {"page": page, "has_access": False, "endpoint": None, "error": str(e)}