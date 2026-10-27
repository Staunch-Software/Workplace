import uuid
from urllib.parse import urlparse, unquote
from azure.storage.blob import BlobServiceClient, ContentSettings

from app.config import get_settings

settings = get_settings()

_LOCAL_HOSTS = ("127.0.0.1", "localhost", "[::1]")


def _client(conn_str: str) -> BlobServiceClient:
    """Azurite (the vessel's local store) only understands older API versions."""
    if "127.0.0.1" in conn_str or "UseDevelopmentStorage" in conn_str or "localhost" in conn_str:
        return BlobServiceClient.from_connection_string(conn_str, api_version="2021-06-08")
    return BlobServiceClient.from_connection_string(conn_str)


def parse_blob_url(blob_url: str) -> tuple[str, str]:
    """(container, blob name) of a stored blob URL. Azurite URLs carry the account name as a first path
    segment (http://127.0.0.1:10000/devstoreaccount1/<container>/<blob>); Azure URLs do not."""
    u = urlparse(blob_url)
    parts = unquote(u.path).lstrip("/").split("/")
    if (u.hostname or "") in _LOCAL_HOSTS or (u.hostname or "").startswith("127."):
        parts = parts[1:]
    container, name = parts[0], "/".join(parts[1:])
    return container, name


async def _upload_document(content: bytes, filename: str, content_type: str, container_name: str) -> str:
    """Upload a file to the given Azure Blob container and return its URL."""
    client = _client(settings.AZURE_STORAGE_CONNECTION_STRING)
    container = client.get_container_client(container_name)
    try:
        container.create_container()
    except Exception:
        pass  # already exists

    blob_name = f"{uuid.uuid4()}_{filename}"
    blob = container.get_blob_client(blob_name)
    blob.upload_blob(content, overwrite=True, content_settings=ContentSettings(content_type=content_type))
    return blob.url


async def upload_iopp_document(content: bytes, filename: str, content_type: str) -> str:
    """Upload a file to the configured Azure Blob container and return its URL."""
    return await _upload_document(content, filename, content_type, settings.AZURE_STORAGE_CONTAINER)


async def upload_orb_pdf(content: bytes, filename: str) -> str:
    """Upload an original ORB logbook PDF to blob storage (for later preview) and return its URL."""
    return await _upload_document(content, filename, "application/pdf", settings.AZURE_STORAGE_ORB_CONTAINER)


async def download_iopp_document(blob_url: str) -> tuple[bytes, str]:
    """Download a previously-uploaded blob by its stored URL.

    The storage account has public access disabled, so the UI can't link to
    blob_url directly — the backend fetches it (using the connection string's
    credentials) and streams it back to the authenticated frontend instead.
    """
    import asyncio
    container_name, blob_name = parse_blob_url(blob_url)
    client = _client(settings.AZURE_STORAGE_CONNECTION_STRING)
    container = client.get_container_client(container_name)
    try:
        container.create_container()
    except Exception:
        pass
    blob = container.get_blob_client(blob_name)
    if not blob.exists():
        if settings.is_offline_vessel and settings.CLOUD_STORAGE_CONNECTION_STRING:
            try:
                await asyncio.to_thread(copy_blob_to_local, blob_url)
            except Exception:
                pass
    if not blob.exists():
        raise FileNotFoundError(f"Blob '{blob_name}' is not in local storage yet")
    downloader = blob.download_blob()
    content_type = downloader.properties.content_settings.content_type or "application/octet-stream"
    return downloader.readall(), content_type

# ── Vessel <-> VM file copy (offline sync) ───────────────────────────────────
# A vessel keeps the same container and blob name as the VM, so a URL stored by either side resolves on both
# (downloads only use the container and blob name of the URL, never its host).

def copy_blob_to_local(blob_url: str) -> bool:
    """Vessel: copy the blob of a VM URL from Azure into the local store. False when it is already there."""
    container_name, blob_name = parse_blob_url(blob_url)
    local = _client(settings.AZURE_STORAGE_CONNECTION_STRING).get_container_client(container_name)
    try:
        local.create_container()
    except Exception:
        pass
    target = local.get_blob_client(blob_name)
    if target.exists():
        return False
    src = _client(settings.CLOUD_STORAGE_CONNECTION_STRING).get_container_client(container_name).get_blob_client(blob_name)
    down = src.download_blob()
    ctype = down.properties.content_settings.content_type or "application/octet-stream"
    target.upload_blob(down.readall(), overwrite=True, content_settings=ContentSettings(content_type=ctype))
    return True


def copy_blob_to_cloud(local_blob_url: str) -> str:
    """Vessel: copy a locally stored blob up to the VM's Azure account; returns its Azure URL."""
    container_name, blob_name = parse_blob_url(local_blob_url)
    src = _client(settings.AZURE_STORAGE_CONNECTION_STRING).get_container_client(container_name).get_blob_client(blob_name)
    down = src.download_blob()
    ctype = down.properties.content_settings.content_type or "application/octet-stream"
    cloud = _client(settings.CLOUD_STORAGE_CONNECTION_STRING).get_container_client(container_name)
    try:
        cloud.create_container()
    except Exception:
        pass
    target = cloud.get_blob_client(blob_name)
    target.upload_blob(down.readall(), overwrite=True, content_settings=ContentSettings(content_type=ctype))
    return target.url
