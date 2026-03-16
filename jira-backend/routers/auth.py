# routers/auth.py — standalone auth removed, Workplace JWT handles login
from fastapi import APIRouter

router = APIRouter(prefix="/api/auth", tags=["auth"])

# Auth is handled by workplace-backend (port 8003)
# This router is kept as a placeholder to avoid import errors