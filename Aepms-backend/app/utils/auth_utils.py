# backend/utils/auth_utils.py
import jwt
import requests
from datetime import datetime, timedelta
from typing import Dict, Any
from fastapi import HTTPException, status
from jose import JWTError, jwt as jose_jwt
from app.config import settings

# Cache for Microsoft public keys
_ms_keys_cache = None
_cache_time = None


def get_microsoft_public_keys():
    """
    Fetch Microsoft's public keys for token validation.
    Caches keys for 24 hours to reduce API calls.
    """
    global _ms_keys_cache, _cache_time
    
    # Check if cache is valid (24 hours)
    if _ms_keys_cache and _cache_time:
        if datetime.utcnow() - _cache_time < timedelta(hours=24):
            return _ms_keys_cache
    
    try:
        # Fetch OpenID configuration
        openid_config_url = (
            f"https://login.microsoftonline.com/{settings.AZURE_TENANT_ID}/v2.0/"
            ".well-known/openid-configuration"
        )
        response = requests.get(openid_config_url, timeout=10)
        response.raise_for_status()
        openid_config = response.json()
        
        # Fetch JWKS (JSON Web Key Set)
        jwks_uri = openid_config["jwks_uri"]
        jwks_response = requests.get(jwks_uri, timeout=10)
        jwks_response.raise_for_status()
        jwks = jwks_response.json()
        
        # Cache the keys
        _ms_keys_cache = jwks
        _cache_time = datetime.utcnow()
        
        return jwks
    except requests.RequestException as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Failed to fetch Microsoft public keys: {str(e)}"
        )


def validate_microsoft_token(id_token: str) -> Dict[str, Any]:
    """
    Validate Microsoft ID token and extract user information.
    
    Args:
        id_token: JWT token from Microsoft
        
    Returns:
        Dictionary with user information (oid, email, name)
        
    Raises:
        HTTPException if token is invalid
    """
    try:
        # Get Microsoft's public keys
        jwks = get_microsoft_public_keys()
        
        # Decode token header to get kid (key ID)
        unverified_header = jose_jwt.get_unverified_header(id_token)
        kid = unverified_header.get("kid")
        
        if not kid:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token missing key ID"
            )
        
        # Find the matching public key
        key = None
        for jwk in jwks["keys"]:
            if jwk["kid"] == kid:
                key = jwk
                break
        
        if not key:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Public key not found"
            )
        
        # Verify and decode the token
        payload = jose_jwt.decode(
            id_token,
            key,
            algorithms=["RS256"],
            audience=settings.AZURE_CLIENT_ID,
            issuer=f"https://login.microsoftonline.com/{settings.AZURE_TENANT_ID}/v2.0"
        )
        
        # Extract user information
        user_info = {
            "oid": payload.get("oid"),  # Azure AD Object ID
            "email": payload.get("email") or payload.get("preferred_username"),
            "name": payload.get("name"),
        }
        
        # Validate required fields
        if not user_info["oid"]:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token missing user object ID"
            )
        
        if not user_info["email"]:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token missing user email"
            )
        
        return user_info
        
    except JWTError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid Microsoft token: {str(e)}"
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Token validation failed: {str(e)}"
        )


def verify_application_jwt(token: str) -> Dict[str, Any]:
    try:
        payload = jwt.decode(
            token,
            settings.SECRET_KEY,
            algorithms=[settings.ALGORITHM]
        )
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired"
        )
    except jwt.InvalidTokenError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid token: {str(e)}"
        )