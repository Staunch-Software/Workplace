import sys
import asyncio

if sys.platform.startswith("win"):
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from db.database import init_models
from core.config import settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_models()

    try:
        from services.azure_blob import init_azure_container
        await init_azure_container()
        print("[Azure] Blob storage ready.")
    except Exception as e:
        print(f"[Azure] Blob init skipped: {e}")

    if settings.is_online_shore:
        print("[SHORE MODE] Jira sync available at /api/jira/sync")

    if settings.is_offline_vessel:
        from services.sync_worker import start_background_sync
        asyncio.create_task(start_background_sync())
        print(f"[VESSEL MODE] Sync worker started. Shore={settings.SHORE_URL}")

    yield


app = FastAPI(title="Ozellar MA Ticketing Portal API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from routers import auth, tickets, vessels, export, attachments
app.include_router(auth.router)
app.include_router(tickets.router)
app.include_router(vessels.router)
app.include_router(export.router)
app.include_router(attachments.router)

if settings.is_online_shore:
    from routers import jira, sync          # ← sync router added
    app.include_router(jira.router)
    app.include_router(sync.router)


@app.get("/")
def root():
    return {
        "message": "Ozellar MA Ticketing Portal API",
        "status": "running",
        "mode": settings.STORAGE_MODE,
    }