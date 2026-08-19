# app/core/blob_storage.py
# Handles Azure Blob Storage for storing scraped SmartPAL PDF reports.
# Uses the same pattern as DRS blob_storage.py.
import logging
from datetime import datetime, timedelta, timezone
from azure.storage.blob import (
    BlobServiceClient,
    BlobSasPermissions,
    CorsRule,
    generate_blob_sas,
    ContentSettings,
)
from app.core.config import settings

logger = logging.getLogger(__name__)


def get_blob_service_client() -> BlobServiceClient:
    """Returns a BlobServiceClient from the connection string."""
    return BlobServiceClient.from_connection_string(
        settings.AZURE_STORAGE_CONNECTION_STRING,
        api_version="2021-06-08",
    )


def get_container_client():
    """Returns the ContainerClient for the smartpal-reports container."""
    return get_blob_service_client().get_container_client(settings.AZURE_CONTAINER_NAME)


def configure_blob():
    """
    Called once at startup:
    - Sets CORS rules on the blob container
    - Creates the container if it does not exist
    """
    try:
        client = get_blob_service_client()
        cors_rule = CorsRule(
            allowed_origins=["*"],
            allowed_methods=["GET", "PUT", "POST", "DELETE", "HEAD", "OPTIONS"],
            allowed_headers=["*"],
            exposed_headers=["*"],
            max_age_in_seconds=3600,
        )
        client.set_service_properties(cors=[cors_rule])
        logger.info("Azure Blob CORS configured.")

        container = client.get_container_client(settings.AZURE_CONTAINER_NAME)
        if not container.exists():
            container.create_container()
            logger.info(f"Container '{settings.AZURE_CONTAINER_NAME}' created.")
        else:
            logger.info(f"Container '{settings.AZURE_CONTAINER_NAME}' already exists.")
    except Exception as e:
        logger.warning(f"Could not configure blob storage at startup: {e}")


def upload_pdf_to_blob(pdf_bytes: bytes, blob_name: str) -> str:
    """
    Uploads raw PDF bytes to Azure Blob Storage.
    blob_name format: reports/{vessel_imo}/{report_code}/{filename}.ext
    Returns the blob_name (path) stored in the DB for later SAS generation.
    """
    import mimetypes
    try:
        content_type, _ = mimetypes.guess_type(blob_name)
        if not content_type:
            if blob_name.lower().endswith(".pdf"):
                content_type = "application/pdf"
            elif blob_name.lower().endswith(".xlsx") or blob_name.lower().endswith(".xls") or blob_name.lower().endswith(".xlsm"):
                content_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            else:
                content_type = "application/octet-stream"

        container = get_container_client()
        blob_client = container.get_blob_client(blob_name)
        blob_client.upload_blob(
            pdf_bytes,
            overwrite=True,
            content_settings=ContentSettings(content_type=content_type)
        )
        logger.info(f"File uploaded to blob: {blob_name} ({len(pdf_bytes)} bytes) as {content_type}")
        return blob_name
    except Exception as e:
        logger.error(f"Failed to upload PDF '{blob_name}': {e}")
        raise


def generate_read_sas_url(blob_name: str, force_download: bool = False, download_filename: str = None) -> str:
    """
    Generates a 24-hour read-only SAS URL for a stored PDF.
    Used by the frontend PdfViewer to load the PDF in an iframe.
    If force_download is True, sets Content-Disposition to force the browser to download the file.
    """
    client = get_blob_service_client()
    blob_client = client.get_blob_client(
        container=settings.AZURE_CONTAINER_NAME,
        blob=blob_name,
    )
    credential = client.credential
    account_key = credential.account_key

    kwargs = {}
    
    if force_download:
        filename = download_filename or blob_name.split('/')[-1]
        kwargs["content_disposition"] = f'attachment; filename="{filename}"'
    else:
        # If it's actually an Excel file (even if it ends with .pdf), force a download
        # rather than opening inline, because the browser PDF viewer will fail.
        lower_name = blob_name.lower()
        if ".xls" in lower_name or ".csv" in lower_name:
            import re
            base = blob_name.split('/')[-1]
            # Strip date prefix
            clean_name = re.sub(r'^\d{4}-\d{2}-\d{2}_\d+_', '', base)
            
            # The scraper often appends the report name and .pdf AFTER the excel extension.
            # e.g., "AM_KIRTI_16_AUG_2026.xlsxBWT_CWT_REPORT.pdf"
            # We want to match up to the actual valid extension and truncate the rest.
            match = re.search(r'(?i)(.*\.xlsx?m?|.*\.csv)', clean_name)
            if match:
                clean_name = match.group(1)
                
            # Replace underscores with spaces
            clean_name = clean_name.replace('_', ' ')
            if not clean_name:
                clean_name = "Document.xlsx"
                
            kwargs["content_disposition"] = f'attachment; filename="{clean_name}"'

    sas_token = generate_blob_sas(
        account_name=client.account_name,
        account_key=account_key,
        container_name=settings.AZURE_CONTAINER_NAME,
        blob_name=blob_name,
        permission=BlobSasPermissions(read=True),
        expiry=datetime.now(timezone.utc) + timedelta(hours=24),
        **kwargs
    )
    url = f"{blob_client.url}?{sas_token}"
    logger.info(f"READ SAS URL generated for: {blob_name}")
    return url


def generate_write_sas_url(blob_name: str) -> str:
    """
    Generates a 24-hour write-only SAS URL.
    Used by the frontend to upload a file directly to Azure Blob.
    """
    client = get_blob_service_client()
    blob_client = client.get_blob_client(
        container=settings.AZURE_CONTAINER_NAME,
        blob=blob_name,
    )
    credential = client.credential
    account_key = credential.account_key

    sas_token = generate_blob_sas(
        account_name=client.account_name,
        account_key=account_key,
        container_name=settings.AZURE_CONTAINER_NAME,
        blob_name=blob_name,
        permission=BlobSasPermissions(write=True, create=True, read=True),
        expiry=datetime.now(timezone.utc) + timedelta(hours=24),
    )
    url = f"{blob_client.url}?{sas_token}"
    logger.info(f"WRITE SAS URL generated for: {blob_name}")
    return url


def verify_blob_exists(blob_name: str) -> bool:
    try:
        container = get_container_client()
        return container.get_blob_client(blob_name).exists()
    except Exception as e:
        logger.error(f"Error checking blob '{blob_name}': {e}")
        return False
