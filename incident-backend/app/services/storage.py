"""Where incident files and chat attachments are kept.

Azure Blob (FILE_STORAGE=blob, the default), like DRS and ORB: the storage account has public access off, so
downloads are proxied through the API with the account credentials. An upload is refused when the connection string
is missing; it never quietly lands on the local disk. FILE_STORAGE=local keeps files under UPLOAD_DIR (throwaway dev
only). Files stored locally earlier stay readable. Type and size limits are enforced here on the server, never
trusted from the browser. The Azure SDK is blocking, so its calls run in a worker thread.
"""
import asyncio
import logging
import os
import re
import uuid
from urllib.parse import unquote, urlparse

from fastapi import HTTPException

from app.config import get_settings

settings = get_settings()
logger = logging.getLogger(__name__)

IMAGE_EXTENSIONS = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
}
ALLOWED_EXTENSIONS = {
    **IMAGE_EXTENSIONS,
    ".pdf": "application/pdf", ".txt": "text/plain", ".csv": "text/csv", ".log": "text/plain",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".xls": "application/vnd.ms-excel",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".doc": "application/msword",
}
MAX_FILES_PER_MESSAGE = 5
_LOCAL_HOSTS = ("127.0.0.1", "localhost", "[::1]")


def safe_filename(name: str) -> str:
    base = os.path.basename((name or "file").replace("\\", "/")) or "file"
    return re.sub(r"[^A-Za-z0-9._ -]", "_", base)[:150] or "file"


def validate_file(filename: str, size: int, max_mb: int, images_only: bool = False) -> str:
    """Raises 400 for a file we will not store; returns the content type to serve it with."""
    ext = os.path.splitext(filename)[1].lower()
    allowed = IMAGE_EXTENSIONS if images_only else ALLOWED_EXTENSIONS
    if ext not in allowed:
        raise HTTPException(status_code=400, detail=f"File type {ext or '(none)'} is not allowed here")
    if size <= 0:
        raise HTTPException(status_code=400, detail=f"{filename} is empty")
    if size > max_mb * 1024 * 1024:
        raise HTTPException(status_code=400, detail=f"{filename} is larger than {max_mb} MB")
    return allowed[ext]


def _client():
    from azure.storage.blob import BlobServiceClient
    # API version pinned like DRS: fine for real Azure and the Azurite emulator.
    return BlobServiceClient.from_connection_string(settings.AZURE_STORAGE_CONNECTION_STRING, api_version="2021-06-08")


def _parse_blob_url(blob_url: str) -> tuple[str, str]:
    u = urlparse(blob_url)
    parts = unquote(u.path).lstrip("/").split("/")
    if (u.hostname or "") in _LOCAL_HOSTS or (u.hostname or "").startswith("127."):
        parts = parts[1:]   # Azurite puts the account name first in the path
    return parts[0], "/".join(parts[1:])


def container_names() -> list[str]:
    return [settings.AZURE_STORAGE_INCIDENT_CONTAINER, settings.AZURE_STORAGE_INCIDENT_CHAT_CONTAINER]


def _ensure_container(container) -> None:
    """Create a container if it is missing. Several gunicorn workers start at once and can all find it missing, so
    losing the race ("already exists") is success, not an error."""
    from azure.core.exceptions import ResourceExistsError
    try:
        container.create_container()
        logger.info("Created blob container '%s'", container.container_name)
    except ResourceExistsError:
        pass


def ensure_containers() -> None:
    """Make sure the containers exist (called at startup; also safe to call again)."""
    client = _client()
    for name in container_names():
        _ensure_container(client.get_container_client(name))


def _upload_blob(content: bytes, blob_path: str, content_type: str, container_name: str) -> str:
    from azure.storage.blob import ContentSettings
    from azure.core.exceptions import ResourceNotFoundError
    container = _client().get_container_client(container_name)
    blob = container.get_blob_client(blob_path)
    settings_ = ContentSettings(content_type=content_type)
    try:
        blob.upload_blob(content, overwrite=True, content_settings=settings_)
    except ResourceNotFoundError:
        # The container is missing (storage was down at startup, or it was removed): create it and retry once.
        _ensure_container(container)
        blob.upload_blob(content, overwrite=True, content_settings=settings_)
    return blob.url


def _read_blob(blob_url: str) -> bytes:
    container_name, blob_name = _parse_blob_url(blob_url)
    blob = _client().get_container_client(container_name).get_blob_client(blob_name)
    if not blob.exists():
        raise FileNotFoundError(blob_name)
    return blob.download_blob().readall()


def _delete_blob(blob_url: str) -> None:
    container_name, blob_name = _parse_blob_url(blob_url)
    blob = _client().get_container_client(container_name).get_blob_client(blob_name)
    if blob.exists():
        blob.delete_blob()


async def save(content: bytes, filename: str, content_type: str, incident_id: uuid.UUID, chat: bool = False) -> str:
    """Store the file; returns the storage_path to keep in the database (the blob URL, or a local path)."""
    name = safe_filename(filename)
    if settings.use_blob:
        if not settings.AZURE_STORAGE_CONNECTION_STRING:
            logger.error("Upload refused: FILE_STORAGE=blob but AZURE_STORAGE_CONNECTION_STRING is not set")
            raise HTTPException(status_code=503, detail="File storage is not configured on the server")
        cname = settings.AZURE_STORAGE_INCIDENT_CHAT_CONTAINER if chat else settings.AZURE_STORAGE_INCIDENT_CONTAINER
        try:
            return await asyncio.to_thread(_upload_blob, content, f"{incident_id}/{uuid.uuid4()}_{name}", content_type, cname)
        except HTTPException:
            raise
        except Exception:
            logger.exception("Blob upload failed")
            raise HTTPException(status_code=502, detail="Could not store the file; please try again")
    folder = os.path.join(settings.UPLOAD_DIR, "chat" if chat else "files", str(incident_id))
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, f"{uuid.uuid4()}_{name}")
    with open(path, "wb") as f:
        f.write(content)
    return path


async def read(storage_path: str) -> bytes:
    if storage_path.startswith("http"):
        return await asyncio.to_thread(_read_blob, storage_path)
    with open(storage_path, "rb") as f:   # a file stored locally before blob storage was switched on
        return f.read()


async def delete(storage_path: str) -> None:
    """Remove the stored file. Best effort: a missing file or a storage hiccup is logged, never raised, because the
    database row (what the user sees) is already gone."""
    try:
        if storage_path.startswith("http"):
            await asyncio.to_thread(_delete_blob, storage_path)
        elif os.path.exists(storage_path):
            os.remove(storage_path)
    except Exception:
        logger.exception("Could not delete stored file %s", storage_path)
