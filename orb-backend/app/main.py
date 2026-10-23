import asyncio
import ssl
import os
import certifi
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.services.clock import load_offset, utc_now
from app.api import sync as sync_endpoints
from app.api import vessels, vessel_tanks, orb_uploads, orb_entries, orb_alerts, orb_alert_threads, orb_alert_pages, orb_notifications, orb_alert_resolution

settings = get_settings()

# SSL Configuration for local environments
if settings.DISABLE_SSL_VERIFY:
    ssl._create_default_https_context = ssl._create_unverified_context

os.environ["GRPC_DEFAULT_SSL_ROOTS_FILE_PATH"] = certifi.where()
os.environ["REQUESTS_CA_BUNDLE"] = certifi.where()

@asynccontextmanager
async def lifespan(app: FastAPI):
    # A vessel install pushes its outbox to the VM and pulls what changed there (app/services/sync_processor.py).
    sync_task = None
    if settings.is_offline_vessel:
        from app.database import AsyncSessionLocal
        async with AsyncSessionLocal() as db:
            await load_offset(db)            # keep stamping corrected times after a restart, even while offline
        from app.services.sync_worker import start_background_sync
        sync_task = asyncio.create_task(start_background_sync())
    yield
    if sync_task:
        sync_task.cancel()

app = FastAPI(
    title="ORB Digitization Platform",
    description="MARPOL Oil Record Book digitization and compliance platform",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS Configuration
origins = settings.cors_origins_list

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include Routers
app.include_router(vessels.router, prefix="/api")
app.include_router(vessel_tanks.router, prefix="/api")
app.include_router(orb_uploads.router, prefix="/api")
app.include_router(orb_entries.router, prefix="/api")
app.include_router(orb_alerts.router, prefix="/api")
app.include_router(orb_alert_threads.router, prefix="/api")
app.include_router(orb_alert_pages.router, prefix="/api")
app.include_router(orb_notifications.router, prefix="/api")
app.include_router(orb_alert_resolution.router, prefix="/api")
app.include_router(sync_endpoints.router, prefix="/api")

@app.get("/health")
async def health():
    # server_time lets a vessel measure how far its own clock is from the VM (services/clock.py).
    return {"status": "ok", "mode": settings.STORAGE_MODE, "server_time": utc_now().isoformat()}


@app.get("/api/time")
async def server_time():
    """UTC now, for screens whose PC clock may be wrong (relative times such as \"3 h ago\")."""
    return {"server_time": utc_now().isoformat()}


@app.get("/")
async def root():
    return {"message": "ORB Platform API", "docs": "/docs"}