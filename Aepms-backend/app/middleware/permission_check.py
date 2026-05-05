# app/middleware/permission_check.py
from fastapi import Request, HTTPException
from app.utils.auth_utils import verify_application_jwt
from jose import JWTError
import logging

logger = logging.getLogger(__name__)

ENDPOINT_TO_PAGE_MAP = {
    "/api/dashboard/kpis": "/dashboard",
    "/api/dashboard/kpis/": "/dashboard",
    "/api/performance/": "/performance",
    "/api/performance": "/performance",
    "/api/fleet/": "/fleet",
    "/api/fleet": "/fleet",
    "/upload-monthly-report/": "/performance",
    "/upload-monthly-report": "/performance",
    "/performance/history": "/performance",
}

async def check_endpoint_permission(request: Request, call_next):
    """Middleware to check if user has permission to access endpoint"""

    # ✅ Allow all CORS preflight OPTIONS requests to pass through
    if request.method == "OPTIONS":
        return await call_next(request)
    
    # Skip auth check for public endpoints
    public_paths = ["/auth/", "/docs", "/openapi.json", "/favicon.ico"]
    if any(request.url.path.startswith(path) for path in public_paths):
        return await call_next(request)
    
    # Get token from header
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        logger.warning(f"❌ Missing token for {request.url.path}")
        raise HTTPException(status_code=401, detail="Missing token")
    
    token = auth_header.split(" ")[1]
    
    try:
        payload = verify_application_jwt(token)

        # ✅ Fixed: JWT key is now "role" (string) not "roles" (list) — matches Workplace JWT
        user_role = str(payload.get("role") or "VESSEL").upper()
        user_permissions = payload.get("permissions", {})
        requested_path = request.url.path
        
        logger.info(f"🔍 Checking {requested_path} for role: {user_role}")
        
        # ✅ Fixed: check single role string instead of list membership
        if user_role in ["SUPERUSER", "ADMIN"]:
            logger.info(f"✅ Full access granted ({user_role})")
            return await call_next(request)
        
        # Fast path: honor explicit endpoint permissions in token first
        for allowed_endpoint, is_allowed in user_permissions.items():
            if is_allowed and requested_path.startswith(allowed_endpoint.rstrip('/')):
                logger.info(f"✅ Permission granted via explicit token endpoint: {allowed_endpoint}")
                return await call_next(request)

        # Map API endpoint to page permission
        page_permission_key = None
        
        for api_path, page_path in ENDPOINT_TO_PAGE_MAP.items():
            if requested_path.startswith(api_path.rstrip('/')):
                page_permission_key = page_path
                break
        
        if not page_permission_key:
            has_permission = False
            for allowed_endpoint, is_allowed in user_permissions.items():
                if is_allowed and requested_path.startswith(allowed_endpoint.rstrip('/')):
                    has_permission = True
                    logger.info(f"✅ Permission granted via direct match: {allowed_endpoint}")
                    break
        else:
            has_permission = user_permissions.get(page_permission_key, False)
            if has_permission:
                logger.info(f"✅ Permission granted: {requested_path} → {page_permission_key}")
            else:
                logger.warning(f"❌ No permission for {requested_path} (needs {page_permission_key})")
                # Fallback: honor explicit API endpoint permissions if present in token
                for allowed_endpoint, is_allowed in user_permissions.items():
                    if is_allowed and requested_path.startswith(allowed_endpoint.rstrip('/')):
                        has_permission = True
                        logger.info(f"✅ Permission granted via fallback direct match: {allowed_endpoint}")
                        break
        
        if not has_permission:
            logger.warning(f"❌ Access denied to {requested_path}")
            logger.warning(f"   User permissions: {user_permissions}")
            raise HTTPException(
                status_code=403, 
                detail=f"Access denied to endpoint: {requested_path}"
            )
        
        return await call_next(request)
        
    except HTTPException:
        raise
    except JWTError as e:
        logger.warning(f"❌ JWT validation failed: {e}")
        raise HTTPException(status_code=401, detail="Token has expired or is invalid")
    except Exception as e:
        logger.error(f"❌ Permission check error: {e}")
        raise HTTPException(status_code=403, detail=f"Permission check failed: {str(e)}")