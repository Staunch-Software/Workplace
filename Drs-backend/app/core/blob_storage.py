# =============================================================================
# app/core/blob_storage.py  — PRODUCTION READY (Shore + Vessel / Azurite + Azure)
#
# WHAT THIS FILE CONTAINS:
#   ✅ get_blob_service_client()  — lazy init, API version pinned to 2021-06-08
#                                   (compatible with both Azurite and Azure Cloud)
#   ✅ get_container_client()     — exposed as a FUNCTION (not module-level var)
#                                   so defects.py can call get_container_client()
#                                   inside get_image_data() without import-time
#                                   connection errors on startup
#   ✅ configure_cors()           — called once at app startup (main.py lifespan)
#                                   sets CORS + creates container if missing
#   ✅ generate_write_sas_url()   — SAS for browser direct-upload (PUT/write/create)
#   ✅ generate_read_sas_url()    — SAS for download/view (read only, 24h expiry)
#   ✅ verify_blob_exists()       — utility used by image validation logic
#   ✅ Account key length guard   — catches .env quoting errors early with clear msg
#   ✅ Azurite (http) + Azure (https) both handled transparently by the SDK
# =============================================================================

import logging
from datetime import datetime, timedelta, timezone

from azure.storage.blob import (
    BlobServiceClient,
    BlobSasPermissions,
    CorsRule,
    generate_blob_sas,
)

from app.core.config import settings

logger = logging.getLogger(__name__)


# =============================================================================
# CORE CLIENTS  (lazy init — no connection at import/startup time)
# =============================================================================

def get_blob_service_client() -> BlobServiceClient:
    """
    Returns BlobServiceClient parsed from the connection string.

    API version pinned to 2021-06-08:
      - Fully supported by real Azure Storage
      - Required for Azurite (local emulator) compatibility

    Never called at module/import level — only when a request arrives.
    This means a missing or invalid connection string won't crash startup.
    """
    return BlobServiceClient.from_connection_string(
        settings.AZURE_STORAGE_CONNECTION_STRING,
        api_version="2021-06-08",
    )


def get_container_client():
    """
    Returns ContainerClient for the configured container.

    Exposed as a FUNCTION (not a module-level variable) so that
    defects.py can import it and call get_container_client() inside
    get_image_data() without triggering a connection at import time.

    Used by:
      - defects.py → get_image_data() → Excel export Sheet 2 embedded images
    """
    return get_blob_service_client().get_container_client(
        settings.AZURE_CONTAINER_NAME
    )


# =============================================================================
# STARTUP CONFIGURATION
# =============================================================================

def configure_cors():
    """
    Configures CORS on Azure Blob Storage (or Azurite) and ensures the
    container exists, creating it if missing.

    Called ONCE at app startup from main.py lifespan.
    Safe to call multiple times — overwrites CORS with correct settings.
    Non-fatal: logs a warning but does NOT crash the app if storage is
    unreachable (e.g. Azurite not yet running during local dev startup).
    """
    try:
        client = get_blob_service_client()

        # ── Step 1: Set CORS rules ────────────────────────────────────────────
        cors_rule = CorsRule(
            allowed_origins=["*"],
            allowed_methods=["GET", "PUT", "POST", "DELETE", "HEAD", "OPTIONS", "MERGE", "PATCH"],
            allowed_headers=["*"],
            exposed_headers=["*"],
            max_age_in_seconds=3600,
        )
        client.set_service_properties(cors=[cors_rule])
        logger.info("✅ Azure Blob Storage CORS configured successfully")

        # ── Step 2: Ensure container exists ──────────────────────────────────
        container_client = client.get_container_client(settings.AZURE_CONTAINER_NAME)
        if not container_client.exists():
            container_client.create_container()
            logger.info(f"✅ Container '{settings.AZURE_CONTAINER_NAME}' created successfully")
        else:
            logger.info(f"✅ Container '{settings.AZURE_CONTAINER_NAME}' already exists")

    except Exception as e:
        logger.warning(f"⚠️ Could not configure blob storage: {str(e)}")
        logger.warning("   If using Azurite, make sure it is running before starting the backend.")


# =============================================================================
# INTERNAL HELPER — Account Key Validation
# =============================================================================

def _get_validated_account_key(client: BlobServiceClient, operation: str) -> str:
    """
    Extracts and validates the account key from the BlobServiceClient credential.
    Raises ValueError with a clear fix message if the key is missing or corrupted.

    A valid Azure Storage account key is always exactly 88 characters long
    (64 bytes encoded in base64). A corrupted key (e.g. from an unquoted
    connection string in .env where the = signs get stripped) will be shorter.
    """
    credential = client.credential
    if not credential:
        raise ValueError(
            "Storage account key not found in connection string. "
            "Wrap AZURE_STORAGE_CONNECTION_STRING in double quotes in your .env file."
        )

    account_key = credential.account_key
    key_len = len(account_key)

    logger.debug(f"[{operation}] Account: {client.account_name}, Key length: {key_len} (expected: 88)")

    if key_len != 88:
        logger.error(
            f"❌ [{operation}] INVALID ACCOUNT KEY LENGTH: {key_len} chars (expected 88). "
            "FIX: Wrap AZURE_STORAGE_CONNECTION_STRING in double quotes in your .env file."
        )
        raise ValueError(
            f"Account key is corrupted ({key_len} chars, expected 88). "
            "Wrap AZURE_STORAGE_CONNECTION_STRING in double quotes in your .env file."
        )

    return account_key


# =============================================================================
# SAS URL GENERATION
# =============================================================================

def generate_write_sas_url(blob_name: str) -> str:
    """
    Generates a short-lived SAS URL that allows the browser UI to upload
    (write/create) a blob directly to Azure Storage or Azurite.

    Permissions : read + write + create
    Expiry      : 1 hour from now
    Start       : 5 minutes ago (clock-skew tolerance)

    Works in both:
      - Offline / Vessel mode: points to Azurite (http://127.0.0.1:10000/...)
      - Online  / Shore  mode: points to Azure Cloud (https://...)
    """
    client = get_blob_service_client()
    blob_client = client.get_blob_client(
        container=settings.AZURE_CONTAINER_NAME,
        blob=blob_name,
    )

    account_key = _get_validated_account_key(client, "WRITE SAS")
    now = datetime.now(timezone.utc)

    sas_token = generate_blob_sas(
        account_name=client.account_name,
        account_key=account_key,
        container_name=settings.AZURE_CONTAINER_NAME,
        blob_name=blob_name,
        permission=BlobSasPermissions(read=True, write=True, create=True),
        start=now - timedelta(minutes=5),   # Clock-skew tolerance
        expiry=now + timedelta(hours=1),
    )

    url = f"{blob_client.url}?{sas_token}"
    logger.info(f"✅ WRITE SAS generated for: {blob_name}")
    logger.debug(f"🔗 URL (first 200 chars): {url[:200]}...")
    return url


def generate_read_sas_url(blob_name: str) -> str:
    """
    Generates a SAS URL that allows viewing / downloading a blob (read only).
    Used when returning image URLs and attachment download links to the UI.

    Permissions : read only
    Expiry      : 24 hours from now

    Works in both Azurite (offline) and Azure Cloud (online) modes.
    """
    client = get_blob_service_client()
    blob_client = client.get_blob_client(
        container=settings.AZURE_CONTAINER_NAME,
        blob=blob_name,
    )

    account_key = _get_validated_account_key(client, "READ SAS")

    sas_token = generate_blob_sas(
        account_name=client.account_name,
        account_key=account_key,
        container_name=settings.AZURE_CONTAINER_NAME,
        blob_name=blob_name,
        permission=BlobSasPermissions(read=True),
        expiry=datetime.now(timezone.utc) + timedelta(hours=24),
    )

    url = f"{blob_client.url}?{sas_token}"
    logger.info(f"✅ READ SAS generated for: {blob_name}")
    return url


# =============================================================================
# UTILITY
# =============================================================================

def verify_blob_exists(blob_name: str) -> bool:
    """
    Checks whether a blob exists in the configured container.
    Returns False (instead of raising) on any error, so callers can treat
    a missing blob gracefully without crashing the request.
    """
    try:
        container_client = get_container_client()
        blob_client = container_client.get_blob_client(blob_name)
        exists = blob_client.exists()
        logger.info(f"🔍 Blob exists check: {blob_name} → {exists}")
        return exists
    except Exception as e:
        logger.error(f"❌ Error checking blob existence for '{blob_name}': {str(e)}")
        return False
    
def download_blob_bytes(blob_path: str) -> bytes:
    """
    Downloads a blob from Azure Storage and returns raw bytes.
    Used for attaching files to Graph API email drafts.
    """
    try:
        container_client = get_container_client()
        blob_client = container_client.get_blob_client(blob_path)
        download_stream = blob_client.download_blob()
        data = download_stream.readall()
        logger.info(f"✅ Downloaded blob: {blob_path} ({len(data)} bytes)")
        return data
    except Exception as e:
        logger.error(f"❌ Failed to download blob '{blob_path}': {str(e)}")
        raise