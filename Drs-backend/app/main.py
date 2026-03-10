from fastapi import FastAPI
from contextlib import asynccontextmanager
from fastapi.middleware.cors import CORSMiddleware
from app.core.database import init_models
from app.api.v1.api import api_router
from app.core.blob_storage import configure_cors
import asyncio
from app.services.sync_worker import start_background_sync
from app.core.config import settings

@asynccontextmanager
async def lifespan(app: FastAPI):
    print("Starting Maritime DRS Backend...")
    await init_models()
    configure_cors()
    if settings.is_offline_vessel:
        asyncio.create_task(start_background_sync())
        print("Sync Worker started in background.")
    yield

app = FastAPI(title="Maritime DRS API", lifespan=lifespan)

origins = [
    "http://localhost:3000",
    "http://localhost:5173",
    "http://localhost:8080",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:8000",
    "http://127.0.0.1:8080",
    "http://localhost:8000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"]
)

app.include_router(api_router, prefix="/api/v1")

@app.get("/")
async def root():
    return {"message": "Maritime DRS API is Online"}

@app.get("/health")
async def health_check():
    return {"status": "ok"}