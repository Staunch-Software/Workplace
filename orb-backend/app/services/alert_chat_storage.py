"""Where files attached to alert chat messages are kept.

Azure Blob when AZURE_STORAGE_CONNECTION_STRING is set (the storage account has public access off,
so downloads are proxied through the API), otherwise a folder under UPLOAD_DIR. The size limit and
the allowed types are enforced here on the server, not trusted from the browser.
"""
import os
import re
import uuid

from fastapi import HTTPException

from app.config import get_settings

settings = get_settings()

ALLOWED_EXTENSIONS = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
    ".pdf": "application/pdf", ".txt": "text/plain", ".csv": "text/csv",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".xls": "application/vnd.ms-excel",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".doc": "application/msword",
}
MAX_FILES_PER_MESSAGE = 5


def safe_filename(name: str) -> str:
    base = os.path.basename((name or "file").replace("\\", "/")) or "file"
    return re.sub(r"[^A-Za-z0-9._ -]", "_", base)[:150] or "file"


def validate_attachment(filename: str, size: int) -> str:
    """Raises 400 for a file we will not store; returns the content type to serve it with."""
    ext = os.path.splitext(filename)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"File type {ext or '(none)'} is not allowed")
    if size <= 0:
        raise HTTPException(status_code=400, detail=f"{filename} is empty")
    if size > settings.MAX_CHAT_ATTACHMENT_MB * 1024 * 1024:
        raise HTTPException(status_code=400, detail=f"{filename} is larger than {settings.MAX_CHAT_ATTACHMENT_MB} MB")
    return ALLOWED_EXTENSIONS[ext]


async def save_attachment(content: bytes, filename: str, content_type: str, alert_id: uuid.UUID) -> str:
    """Store the file; returns the storage_path to keep in orb_alert_attachments."""
    name = safe_filename(filename)
    if settings.AZURE_STORAGE_CONNECTION_STRING:
        from app.services.azure_storage import _upload_document
        return await _upload_document(content, f"{alert_id}_{name}", content_type, settings.AZURE_STORAGE_ORB_CHAT_CONTAINER)
    folder = os.path.join(settings.UPLOAD_DIR, "chat", str(alert_id))
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, f"{uuid.uuid4()}_{name}")
    with open(path, "wb") as f:
        f.write(content)
    return path


async def read_attachment(storage_path: str) -> bytes:
    if storage_path.startswith("http"):
        from app.services.azure_storage import download_iopp_document
        content, _ = await download_iopp_document(storage_path)
        return content
    with open(storage_path, "rb") as f:
        return f.read()
