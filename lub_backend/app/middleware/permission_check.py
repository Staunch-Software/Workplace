from fastapi import Request, HTTPException
from app.utils.auth_utils import verify_application_jwt
import logging

logger = logging.getLogger(__name__)

async def check_endpoint_permission(request: Request, call_next):
    if request.method == "OPTIONS":
        return await call_next(request)

    public_paths = ["/docs", "/openapi.json", "/favicon.ico", "/redoc"]
    if any(request.url.path.startswith(path) for path in public_paths):
        return await call_next(request)

    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing token")

    token = auth_header.split(" ")[1]
    try:
        verify_application_jwt(token)
        return await call_next(request)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Permission check error: {e}")
        raise HTTPException(status_code=401, detail="Invalid token")
