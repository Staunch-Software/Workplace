from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.api.v1.api import api_router
from app.core.database_control import init_control_db

# Register ALL models
import app.models.control.user
import app.models.control.vessel
import app.models.control.associations
import app.models

# Add this under your other imports (around line 6)
from contextlib import asynccontextmanager
from app.core.database_control import engine_control

@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── STARTUP ──
    await init_control_db()
    
    yield  # ← App runs here
    
    # ── SHUTDOWN (NEW) ──
    print("Shutting down Workplace Control Backend...")
    await engine_control.dispose()
    print("Engines disposed.")
app = FastAPI(title=settings.PROJECT_NAME, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://52.172.91.85"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

app.include_router(api_router, prefix="/api/v1")





@app.get("/health")
async def health():
    return {"status": "ok", "service": "workplace-control"}