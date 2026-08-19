# app/main.py
from fastapi import FastAPI
from contextlib import asynccontextmanager
from fastapi.middleware.cors import CORSMiddleware

from app.core.database import init_models, engine
from app.core.database_control import engine_control
from app.core.blob_storage import configure_blob
from app.api.v1.api import api_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    import asyncio
    print("Starting SmartPAL Report Tracker Backend...")

    # 1. Create DB tables (Reports, ReportThreads)
    await init_models()

    # 2. Configure Azure Blob Storage in background (non-blocking)
    # Runs in a thread so it doesn't block startup if Azure is unreachable
    async def _blob_init():
        try:
            await asyncio.to_thread(configure_blob)
        except Exception as e:
            print(f"[WARN] Blob config failed (non-fatal): {e}")

    asyncio.create_task(_blob_init())

    # NOTE: Scraping is triggered externally via an OS-level cron job running
    # app/scraper/cron_smart_scrape.py (smart_cron=True), NOT by an in-process
    # scheduler. Do not re-add an in-process scheduler here without removing
    # the external cron job first -- running both risks two Playwright
    # sessions logging into SmartPAL at the same time and invalidating each
    # other's session.
    print("Backend ready. Scraping is handled by the external cron job.")

    yield

    # ── SHUTDOWN ──
    print("Shutting down Report Tracker Backend...")
    await engine.dispose()
    await engine_control.dispose()
    print("Engines disposed.")


app = FastAPI(
    title="SmartPAL Report Tracker API",
    description="Shore-side API for managing scraped SmartPAL reports, threads, and Azure Blob PDFs.",
    version="1.0.0",
    lifespan=lifespan,
)

origins = [
    "http://localhost:3000",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:8080",
    "http://52.172.91.85",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

app.include_router(api_router, prefix="/api/v1")


@app.get("/")
async def root():
    return {"message": "SmartPAL Report Tracker API is Online"}


@app.get("/health")
async def health():
    return {"status": "ok"}
