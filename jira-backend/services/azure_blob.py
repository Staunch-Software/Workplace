# services/azure_blob.py
import uuid
from datetime import datetime, timezone, timedelta
from azure.storage.blob.aio import BlobServiceClient
from azure.storage.blob import (
    generate_blob_sas,
    BlobSasPermissions,
    ContentSettings,
)
from azure.core.exceptions import ResourceExistsError
from core.config import settings


def _get_account_name() -> str:
    for part in settings.AZURE_STORAGE_CONNECTION_STRING.split(";"):
        if part.startswith("AccountName="):
            return part.split("=", 1)[1]
    return ""


def _get_account_key() -> str:
    for part in settings.AZURE_STORAGE_CONNECTION_STRING.split(";"):
        if part.startswith("AccountKey="):
            return part.split("=", 1)[1]
    return ""


def generate_read_sas_url(blob_name: str, expiry_hours: int = 24) -> str:
    """Generate a temporary SAS URL to read/download a blob."""
    sas_token = generate_blob_sas(
        account_name=_get_account_name(),
        container_name=settings.AZURE_CONTAINER_NAME,
        blob_name=blob_name,
        account_key=_get_account_key(),
        permission=BlobSasPermissions(read=True),
        expiry=datetime.now(timezone.utc) + timedelta(hours=expiry_hours),
    )
    account_name = _get_account_name()
    return f"https://{account_name}.blob.core.windows.net/{settings.AZURE_CONTAINER_NAME}/{blob_name}?{sas_token}"


async def get_blob_service_client() -> BlobServiceClient:
    return BlobServiceClient.from_connection_string(settings.AZURE_STORAGE_CONNECTION_STRING)


async def init_azure_container():
    """Runs on startup to ensure the container exists."""
    client = await get_blob_service_client()
    try:
        container = client.get_container_client(settings.AZURE_CONTAINER_NAME)
        await container.create_container()  # no public_access — private container
        print(f"[Azure] Created container: {settings.AZURE_CONTAINER_NAME}")
    except ResourceExistsError:
        print(f"[Azure] Container '{settings.AZURE_CONTAINER_NAME}' already exists.")
    except Exception as e:
        if "ContainerAlreadyExists" in str(e):
            print(f"[Azure] Container '{settings.AZURE_CONTAINER_NAME}' already exists.")
        else:
            print(f"[Azure] Container init ERROR: {e}")
    finally:
        await client.close()


async def upload_file_to_blob(file_bytes: bytes, original_filename: str, content_type: str) -> dict:
    """Uploads a file to Azure and returns a SAS URL + metadata."""
    ext = original_filename.split('.')[-1] if '.' in original_filename else 'bin'
    blob_name = f"{uuid.uuid4()}.{ext}"

    client = await get_blob_service_client()
    blob_client = client.get_blob_client(
        container=settings.AZURE_CONTAINER_NAME,
        blob=blob_name
    )

    try:
        await blob_client.upload_blob(
            file_bytes,
            overwrite=True,
            content_settings=ContentSettings(content_type=content_type),
        )

        # Generate 24hr SAS URL for reading
        sas_url = generate_read_sas_url(blob_name, expiry_hours=24)

        return {
            "src":      sas_url,
            "blob_name": blob_name,       # store this in DB to regenerate SAS later
            "filename": original_filename,
            "alt":      original_filename,
            "mimeType": content_type,
        }
    finally:
        await client.close()


async def download_blob(blob_name: str) -> bytes:
    """Download blob bytes — used by sync to transfer from Azurite to Azure."""
    client = await get_blob_service_client()
    try:
        blob_client = client.get_blob_client(
            container=settings.AZURE_CONTAINER_NAME,
            blob=blob_name
        )
        stream = await blob_client.download_blob()
        return await stream.readall()
    finally:
        await client.close()