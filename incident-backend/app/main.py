import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")

from app.config import get_settings
from app.api import chat, incidents

settings = get_settings()

app = FastAPI(
    title="Incident Report Repository",
    description="Incident reports with evidence tabs and an internal chat",
    version="1.0.0",
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


@app.get("/health")
@app.get("/api/health")
async def health():
    return {"status": "ok"}
