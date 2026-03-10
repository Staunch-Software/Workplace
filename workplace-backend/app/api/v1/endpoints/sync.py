# NEW FILE: app/api/v1/endpoints/sync.py
from fastapi import APIRouter, Depends, HTTPException, Query, Security
from fastapi.security import APIKeyHeader
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload
from datetime import datetime

from app.core.database_control import get_control_db
from app.core.config import settings
from app.models.control.user import User
from app.models.control.vessel import Vessel
from app.models.control.associations import user_vessel_link

router = APIRouter()

sync_api_key_header = APIKeyHeader(name="X-Sync-API-Key", auto_error=True)

async def verify_sync_key(api_key: str = Security(sync_api_key_header)):
    if api_key != settings.SYNC_API_KEY:
        raise HTTPException(status_code=401, detail="Invalid Sync API Key")


@router.get("/config/changes", dependencies=[Depends(verify_sync_key)])
async def get_config_changes(
    since: datetime = Query(...),
    db: AsyncSession = Depends(get_control_db),
):
    """
    Returns users and vessels updated after 'since' timestamp.
    Called by ALL offline modules (DRS, future modules) to sync config data.
    Shore always wins for config data.
    """
    results = {}

    # --- USERS ---
    user_stmt = (
        select(User)
        .where(User.updated_at > since)
        .options(selectinload(User.vessels))
    )
    users = (await db.execute(user_stmt)).scalars().all()
    serialized_users = []
    for u in users:
        user_data = {c.name: getattr(u, c.name) for c in u.__table__.columns}
        user_data["assigned_vessel_imos"] = [v.imo for v in u.vessels]
        # Never send password hash to vessel
        user_data.pop("password_hash", None)
        serialized_users.append(user_data)
    results["users"] = serialized_users

    # --- VESSELS ---
    vessel_stmt = select(Vessel).where(Vessel.updated_at > since)
    vessels = (await db.execute(vessel_stmt)).scalars().all()
    results["vessels"] = [
        {c.name: getattr(v, c.name) for c in v.__table__.columns}
        for v in vessels
    ]

    return results