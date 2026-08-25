# Verbatim-equivalent of lub_backend's verify_application_jwt — same claim shape and shared
# APP_JWT_SECRET, so tokens minted elsewhere in the platform validate here too.
import jwt
from typing import Dict, Any
from fastapi import HTTPException, status
from app.config import settings


def verify_application_jwt(token: str) -> Dict[str, Any]:
    try:
        payload = jwt.decode(
            token,
            settings.SECRET_KEY or settings.APP_JWT_SECRET,
            algorithms=["HS256"],
            options={"verify_iss": False},
        )

        raw_role = payload.get("role", "VESSEL")
        role = str(raw_role).upper() if raw_role else "VESSEL"

        return {
            "sub": payload.get("sub"),
            "id": payload.get("sub"),
            "email": payload.get("email", payload.get("sub", "")),
            "full_name": payload.get("full_name"),
            "role": role,
            "permissions": payload.get("permissions", {}),
            "oid": payload.get("oid"),
        }

    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token has expired")
    except jwt.InvalidTokenError as e:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=f"Invalid token: {str(e)}")
