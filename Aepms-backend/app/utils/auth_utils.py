# app/utils/auth_utils.py
import requests
import logging
from datetime import datetime, timedelta, timezone
from typing import Dict, Any

from fastapi import HTTPException, status
from jose import JWTError, jwt as jose_jwt  # python-jose: used for BOTH encode and decode
from app.config import settings

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Microsoft SSO helpers (unchanged)
# ---------------------------------------------------------------------------

_ms_keys_cache = None
_cache_time = None


def get_microsoft_public_keys():
    """
    Fetch Microsoft's public keys for token validation.
    Caches keys for 24 hours to reduce API calls.
    """
    global _ms_keys_cache, _cache_time

    if _ms_keys_cache and _cache_time:
        if datetime.utcnow() - _cache_time < timedelta(hours=24):
            return _ms_keys_cache

    try:
        openid_config_url = (
            f"https://login.microsoftonline.com/{settings.AZURE_TENANT_ID}/v2.0/"
            ".well-known/openid-configuration"
        )
        response = requests.get(openid_config_url, timeout=10)
        response.raise_for_status()
        openid_config = response.json()

        jwks_uri = openid_config["jwks_uri"]
        jwks_response = requests.get(jwks_uri, timeout=10)
        jwks_response.raise_for_status()
        jwks = jwks_response.json()

        _ms_keys_cache = jwks
        _cache_time = datetime.utcnow()
        return jwks

    except requests.RequestException as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Failed to fetch Microsoft public keys: {str(e)}",
        )


def validate_microsoft_token(id_token: str) -> Dict[str, Any]:
    """
    Validate Microsoft ID token and extract user information.
    """
    try:
        jwks = get_microsoft_public_keys()
        unverified_header = jose_jwt.get_unverified_header(id_token)
        kid = unverified_header.get("kid")

        if not kid:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token missing key ID",
            )

        key = None
        for jwk in jwks["keys"]:
            if jwk["kid"] == kid:
                key = jwk
                break

        if not key:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Public key not found",
            )

        payload = jose_jwt.decode(
            id_token,
            key,
            algorithms=["RS256"],
            audience=settings.AZURE_CLIENT_ID,
            issuer=f"https://login.microsoftonline.com/{settings.AZURE_TENANT_ID}/v2.0",
        )

        user_info = {
            "oid": payload.get("oid"),
            "email": payload.get("email") or payload.get("preferred_username"),
            "name": payload.get("name"),
        }

        if not user_info["oid"]:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token missing user object ID",
            )
        if not user_info["email"]:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token missing user email",
            )

        return user_info

    except JWTError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid Microsoft token: {str(e)}",
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Token validation failed: {str(e)}",
        )


# ---------------------------------------------------------------------------
# Application JWT helpers  ← THIS WAS THE MISSING PIECE
# ---------------------------------------------------------------------------

def create_application_jwt(data: Dict[str, Any]) -> str:
    """
    Encode a JWT that carries the full user payload (id, email, role, …).

    The dict passed in from auth.py already contains the 'id' key, so we
    just add the standard expiry claim and sign with our SECRET_KEY.
    """
    to_encode = data.copy()

    expire = datetime.now(timezone.utc) + timedelta(
        minutes=settings.APP_JWT_EXPIRE_MINUTES
    )
    to_encode["exp"] = expire

    token = jose_jwt.encode(
        to_encode,
        settings.SECRET_KEY,
        algorithm=settings.ALGORITHM,
    )
    logger.debug("create_application_jwt: encoded keys=%s", list(to_encode.keys()))
    return token

# app/utils/auth_utils.py

def verify_application_jwt(token: str) -> Dict[str, Any]:
    """
    Decode and verify an application JWT.
    Returns the full payload dict, which includes 'id', 'email', 'role', etc.
    """
    try:
        payload = jose_jwt.decode(
            token,
            settings.SECRET_KEY,
            algorithms=[settings.ALGORITHM],
        )
        logger.debug("verify_application_jwt: decoded keys=%s", list(payload.keys()))

        # --- FIX: Map 'sub' to 'id' for cross-service compatibility ---
        if "id" not in payload and "sub" in payload:
            payload["id"] = payload["sub"]

        # Sanity-check: warn early if 'id' is somehow absent
        if "id" not in payload:
            logger.warning(
                "verify_application_jwt: 'id' missing from payload. "
                "Keys present: %s",
                list(payload.keys()),
            )

        return payload

    except JWTError as e:
        # python-jose raises JWTError for both expiry and invalid tokens
        detail = "Token has expired" if "expired" in str(e).lower() else f"Invalid token: {str(e)}"
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=detail)