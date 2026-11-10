import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")

from app.config import get_settings
from app.api import chat, incidents, notifications
from app.services import storage

settings = get_settings()
logger = logging.getLogger("incident")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Non-fatal, like DRS: an unreachable storage account must not stop the API, but it is said loudly in the log.
    if not settings.use_blob:
        logger.warning("FILE_STORAGE=local: files are kept under %s (development only)", settings.UPLOAD_DIR)
    elif not settings.AZURE_STORAGE_CONNECTION_STRING:
        logger.error("AZURE_STORAGE_CONNECTION_STRING is not set: file and photo uploads will be refused")
    else:
        try:
            await asyncio.to_thread(storage.ensure_containers)
            logger.info("Blob storage ready (containers: %s)", ", ".join(storage.container_names()))
        except Exception:
            logger.exception("Could not reach blob storage; uploads will fail until it is available")
    yield


app = FastAPI(
    title="Incident Report Repository",
    description="Incident reports with evidence tabs and an internal chat",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(incidents.router, prefix="/api")
app.include_router(chat.router, prefix="/api")
app.include_router(notifications.router, prefix="/api")


@app.get("/health")
@app.get("/api/health")
async def health():
    return {"status": "ok"}
