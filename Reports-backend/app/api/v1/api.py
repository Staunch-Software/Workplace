# app/api/v1/api.py
from fastapi import APIRouter
from app.api.v1.endpoints import reports, threads, config, notifications, feed, sync

api_router = APIRouter()
api_router.include_router(config.router)
api_router.include_router(reports.router)
api_router.include_router(threads.router)
api_router.include_router(notifications.router)
api_router.include_router(feed.router)
api_router.include_router(sync.router)
