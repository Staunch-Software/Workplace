from fastapi import APIRouter
from app.api.v1.endpoints import defects, vessels, users, attachments, sync

api_router = APIRouter()

api_router.include_router(defects.router, prefix="/defects", tags=["defects"])
api_router.include_router(vessels.router, prefix="/vessels", tags=["vessels"])
api_router.include_router(users.router, prefix="/users", tags=["users"])
api_router.include_router(attachments.router, prefix="/attachments", tags=["Attachments"])
api_router.include_router(sync.router, prefix="/sync", tags=["Sync"])