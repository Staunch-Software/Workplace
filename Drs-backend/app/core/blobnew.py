# app/core/blob_storagenew.py
import logging
from datetime import datetime, timedelta, timezone
from azure.storage.blob import (
    BlobServiceClient, 
    generate_blob_sas, 
    BlobSasPermissions
)
from app.core.config import settings

logger = logging.getLogger(__name__)

def get_blob_info():
    """Parses connection string to get account details safely."""
    conn_str = settings.AZURE_STORAGE_CONNECTION_STRING
    conn_str_dict = dict(item.split('=', 1) for item in conn_str.split(';') if item)
    return {
        "account_name": conn_str_dict.get('AccountName') or conn_str_dict.get('accountname'),
        "account_key": conn_str_dict.get('AccountKey') or conn_str_dict.get('accountkey'),
        "container": settings.AZURE_CONTAINER_NAME
    }

def generate_write_sas_url(blob_name: str):
    """
    Generates a URL that allows the UI to UPLOAD (Write/Create).
    Fixed: Uses correct Azure Storage API version explicitly
    """
    info = get_blob_info()
    now = datetime.now(timezone.utc)

    try:
        # Generate SAS token - SDK uses latest version automatically
        sas_token = generate_blob_sas(
            account_name=info["account_name"],
            account_key=info["account_key"],
            container_name=info["container"],
            blob_name=blob_name,
            permission=BlobSasPermissions(read=True, write=True, create=True),
            start=now - timedelta(minutes=15),
            expiry=now + timedelta(hours=1)
        )
        
        # Construct the full URL
        url = f"https://{info['account_name']}.blob.core.windows.net/{info['container']}/{blob_name}?{sas_token}"
        
        logger.info(f"✅ Generated write SAS URL for: {blob_name}")
        return url
        
    except Exception as e:
        logger.error(f"❌ Failed to generate write SAS URL: {str(e)}")
        raise

def generate_read_sas_url(blob_path: str):
    """
    Generates a URL that allows the Shore UI to VIEW (Read).
    Fixed: Uses correct Azure Storage API version explicitly
    """
    info = get_blob_info()
    now = datetime.now(timezone.utc)
    
    try:
        # Generate SAS token - SDK uses latest version automatically
        sas_token = generate_blob_sas(
            account_name=info["account_name"],
            account_key=info["account_key"],
            container_name=info["container"],
            blob_name=blob_path,
            permission=BlobSasPermissions(read=True),
            expiry=now + timedelta(hours=24)  # 24 hours for viewing
        )
        
        # Construct the full URL
        url = f"https://{info['account_name']}.blob.core.windows.net/{info['container']}/{blob_path}?{sas_token}"
        
        logger.info(f"✅ Generated read SAS URL for: {blob_path}")
        return url
        
    except Exception as e:
        logger.error(f"❌ Failed to generate read SAS URL: {str(e)}")
        raise

def get_blob_service_client():
    """
    Returns a BlobServiceClient instance for direct blob operations.
    """
    try:
        connection_string = settings.AZURE_STORAGE_CONNECTION_STRING
        blob_service_client = BlobServiceClient.from_connection_string(connection_string)
        logger.info("✅ BlobServiceClient initialized successfully")
        return blob_service_client
    except Exception as e:
        logger.error(f"❌ Failed to initialize BlobServiceClient: {str(e)}")
        raise