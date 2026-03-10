from fastapi import APIRouter
from app.api.v1.endpoints import auth, users, vessels, sync

api_router = APIRouter()
api_router.include_router(auth.router, tags=["Auth"])
api_router.include_router(users.router, tags=["Users"])
api_router.include_router(vessels.router, tags=["Vessels"])
api_router.include_router(sync.router, prefix="/sync", tags=["sync"])