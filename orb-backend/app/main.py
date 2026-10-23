import ssl
import os
import certifi
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.api import vessels, vessel_tanks, orb_uploads, orb_entries, orb_alerts, orb_alert_threads, orb_alert_pages, orb_notifications

settings = get_settings()

# SSL Configuration for local environments
if settings.DISABLE_SSL_VERIFY:
    ssl._create_default_https_context = ssl._create_unverified_context

os.environ["GRPC_DEFAULT_SSL_ROOTS_FILE_PATH"] = certifi.where()
os.environ["REQUESTS_CA_BUNDLE"] = certifi.where()

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup logic can go here
    yield

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

@app.get("/")
async def root():
    return {"message": "ORB Platform API", "docs": "/docs"}