"""Where incident files and chat attachments are kept.

Azure Blob when AZURE_STORAGE_CONNECTION_STRING is set (the storage account has public access off, so downloads
are proxied through the API), otherwise a folder under UPLOAD_DIR. Type and size limits are enforced here on the
server, never trusted from the browser.
"""
import os
import re
import uuid
from urllib.parse import unquote, urlparse

from fastapi import HTTPException

from app.config import get_settings

settings = get_settings()

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
    conn = settings.AZURE_STORAGE_CONNECTION_STRING
    # Azurite (local) only understands older API versions.
    if "127.0.0.1" in conn or "UseDevelopmentStorage" in conn or "localhost" in conn:
        return BlobServiceClient.from_connection_string(conn, api_version="2021-06-08")
    return BlobServiceClient.from_connection_string(conn)


def _parse_blob_url(blob_url: str) -> tuple[str, str]:
    u = urlparse(blob_url)
    parts = unquote(u.path).lstrip("/").split("/")
    if (u.hostname or "") in _LOCAL_HOSTS or (u.hostname or "").startswith("127."):
        parts = parts[1:]
    return parts[0], "/".join(parts[1:])


async def save(content: bytes, filename: str, content_type: str, incident_id: uuid.UUID, chat: bool = False) -> str:
    """Store the file; returns the storage_path to keep in the database."""
    name = safe_filename(filename)
    if settings.AZURE_STORAGE_CONNECTION_STRING:
        from azure.storage.blob import ContentSettings
        cname = settings.AZURE_STORAGE_INCIDENT_CHAT_CONTAINER if chat else settings.AZURE_STORAGE_INCIDENT_CONTAINER
        container = _client().get_container_client(cname)
        try:
            container.create_container()
        except Exception:
            pass  # already exists
        blob = container.get_blob_client(f"{incident_id}/{uuid.uuid4()}_{name}")
        blob.upload_blob(content, overwrite=True, content_settings=ContentSettings(content_type=content_type))
        return blob.url
    folder = os.path.join(settings.UPLOAD_DIR, "chat" if chat else "files", str(incident_id))
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, f"{uuid.uuid4()}_{name}")
    with open(path, "wb") as f:
        f.write(content)
    return path


async def read(storage_path: str) -> bytes:
    if storage_path.startswith("http"):
        container_name, blob_name = _parse_blob_url(storage_path)
        blob = _client().get_container_client(container_name).get_blob_client(blob_name)
        if not blob.exists():
            raise FileNotFoundError(blob_name)
        return blob.download_blob().readall()
    with open(storage_path, "rb") as f:
        return f.read()
