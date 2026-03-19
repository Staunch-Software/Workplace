# app/blob_storage.py
import logging
import os
from datetime import datetime, timedelta
import mimetypes
# 👇 IMPORT unquote here
from urllib.parse import urlparse, unquote
from azure.storage.blob import (
    BlobServiceClient, 
    ContentSettings, 
    generate_blob_sas, 
    BlobSasPermissions
)
from dotenv import load_dotenv

logger = logging.getLogger(__name__)

load_dotenv()

AZURE_CONNECTION_STRING = os.getenv("AZURE_STORAGE_CONNECTION_STRING")
AZURITE_CONNECTION_STRING = os.getenv("AZURITE_CONNECTION_STRING")
CONTAINER_NAME = os.getenv("AZURE_CONTAINER_NAME", "pdf-repository")
IS_VESSEL_INSTANCE = os.getenv("IS_VESSEL_INSTANCE", "false").lower() == "true"

def get_blob_service_client():
    """Returns the cloud Azure client. Used by generate_sas_url, download_blob_bytes."""
    if not AZURE_CONNECTION_STRING:
        raise ValueError("Azure Connection String is not set.")
    return BlobServiceClient.from_connection_string(AZURE_CONNECTION_STRING)

def get_local_blob_service_client():
    """Returns the Azurite client for vessel-local storage."""
    if not AZURITE_CONNECTION_STRING:
        raise ValueError("Azurite Connection String is not set.")
    return BlobServiceClient.from_connection_string(AZURITE_CONNECTION_STRING)

def upload_file_locally(file_data: bytes, filename: str, folder_path: str, content_type=None) -> str:
    """
    Uploads bytes to Azurite (local vessel storage).
    Returns the local blob URL (no SAS).
    """
    try:
        if not content_type:
            content_type, _ = mimetypes.guess_type(filename)
            if not content_type:
                if filename.lower().endswith('.pdf'):
                    content_type = "application/pdf"
                elif filename.lower().endswith(('.jpg', '.jpeg', '.png', '.webp')):
                    content_type = "image/jpeg"
                else:
                    content_type = "application/octet-stream"

        blob_service_client = get_local_blob_service_client()
        blob_path = f"{folder_path}/{filename}".replace("\\", "/").replace("//", "/")
        blob_client = blob_service_client.get_blob_client(container=CONTAINER_NAME, blob=blob_path)

        blob_client.upload_blob(
            file_data,
            overwrite=True,
            content_settings=ContentSettings(content_type=content_type)
        )

        logger.info(f"✅ Uploaded to Azurite (local): {blob_path}")
        return blob_client.url

    except Exception as e:
        logger.error(f"❌ Azurite Upload Failed: {e}")
        return None

def upload_file_to_azure(file_data: bytes, filename: str, folder_path: str, content_type=None) -> str:
    """
    Uploads bytes to Azure Blob Storage (cloud) or Azurite (vessel local).
    Controlled by IS_VESSEL_INSTANCE env var.
    Returns the CLEAN URL (No SAS).
    """
    if IS_VESSEL_INSTANCE:
        return upload_file_locally(file_data, filename, folder_path, content_type)

    try:
        # 🔥 Detect the correct mime type (e.g., image/jpeg, application/pdf)
        if not content_type:
            content_type, _ = mimetypes.guess_type(filename)
            # Fallback if detection fails
            if not content_type:
                if filename.lower().endswith('.pdf'):
                    content_type = "application/pdf"
                elif filename.lower().endswith(('.jpg', '.jpeg', '.png', '.webp')):
                    content_type = "image/jpeg"
                else:
                    content_type = "application/octet-stream"

        blob_service_client = get_blob_service_client()
        
        # Ensure path uses forward slashes and remove double slashes
        blob_path = f"{folder_path}/{filename}".replace("\\", "/").replace("//", "/")
        
        blob_client = blob_service_client.get_blob_client(container=CONTAINER_NAME, blob=blob_path)
        
        blob_client.upload_blob(
            file_data, 
            overwrite=True,
            # 🔥 Pass the dynamic content_type so images render in browsers
            content_settings=ContentSettings(content_type=content_type)
        )
        
        logger.info(f"✅ Uploaded to Azure as {content_type}: {blob_path}")
        return blob_client.url 
        
    except Exception as e:
        logger.error(f"❌ Azure Upload Failed: {e}")
        return None

# 🔥 FIXED FUNCTION: GENERATE SECURE LINK
def generate_sas_url(blob_url: str, expiry_hours: int = 1, download_name: str = None) -> str:
    """
    Takes a plain Blob URL and returns a Signed (Secure) URL valid for N hours.
    If download_name is provided, forces browser to download with that filename.
    Handles filenames with spaces/special characters correctly.
    """
    if not blob_url:
        return None

    try:
        # 1. Parse the blob name from the full URL
        parsed = urlparse(blob_url)
        path_parts = parsed.path.lstrip("/").split("/", 1)
        
        if len(path_parts) < 2:
            return blob_url

        container = path_parts[0]
        blob_name = unquote(path_parts[1])

        # 2. Get Account Key/Name from Connection String
        conn_str_dict = dict(item.split('=', 1) for item in AZURE_CONNECTION_STRING.split(';') if item)
        account_name = conn_str_dict.get('AccountName') or conn_str_dict.get('accountname')
        account_key = conn_str_dict.get('AccountKey') or conn_str_dict.get('accountkey')

        if not account_name or not account_key:
            logger.error("Could not find AccountName or AccountKey in connection string")
            return blob_url

        # 3. Define Content Disposition (forces download with custom name)
        content_disposition = None
        if download_name:
            clean_name = download_name.replace('"', '').replace("'", "").replace(",", "")
            content_disposition = f'attachment; filename="{clean_name}"'

        # 4. Generate SAS Token
        sas_token = generate_blob_sas(
            account_name=account_name,
            account_key=account_key,
            container_name=container,
            blob_name=blob_name,
            permission=BlobSasPermissions(read=True),
            expiry=datetime.utcnow() + timedelta(hours=expiry_hours),
            content_disposition=content_disposition  # <--- MAGIC HAPPENS HERE
        )

        return f"{blob_url}?{sas_token}"

    except Exception as e:
        logger.error(f"Failed to generate SAS token: {e}")
        return blob_url

def download_blob_bytes(blob_url: str) -> bytes:
    """
    Downloads the actual raw bytes of a file from Azure using its URL.
    Used for batching files into a ZIP.
    """
    if not blob_url:
        return None

    try:
        # 1. Parse the blob name from the full URL (same logic as generate_sas_url)
        parsed = urlparse(blob_url)
        path_parts = parsed.path.lstrip("/").split("/", 1)
        
        if len(path_parts) < 2:
            logger.error(f"Invalid blob URL structure: {blob_url}")
            return None

        # The first part is the container, the rest is the path/filename
        # unquote handles spaces (%20) correctly
        blob_name = unquote(path_parts[1])

        # 2. Get the blob client
        blob_service_client = get_blob_service_client()
        blob_client = blob_service_client.get_blob_client(container=CONTAINER_NAME, blob=blob_name)
        
        # 3. Download the data as bytes
        return blob_client.download_blob().readall()
        
    except Exception as e:
        logger.error(f"❌ Failed to download blob bytes: {e}")
        raise e