from fastapi import APIRouter
from app.api.v1.endpoints import defects, vessels, users, attachments, sync
from app.api.v1.endpoints.scraper import router as scraper_router

api_router = APIRouter()

api_router.include_router(defects.router, prefix="/defects", tags=["defects"])
api_router.include_router(vessels.router, prefix="/vessels", tags=["vessels"])
api_router.include_router(users.router, prefix="/users", tags=["users"])
api_router.include_router(attachments.router, prefix="/attachments", tags=["Attachments"])
api_router.include_router(sync.router, prefix="/sync", tags=["Sync"])
api_router.include_router(scraper_router, prefix="/scraper", tags=["Scraper"])