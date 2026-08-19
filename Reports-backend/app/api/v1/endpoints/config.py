# app/api/v1/endpoints/config.py
import uuid
from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.core.database import get_db
from app.api.deps import require_shore
from app.models.report import ReportConfig
from app.schemas.report import ReportConfigOut, ReportConfigCreate, BulkAssignRequest
from app.utils.excel import get_default_configs

router = APIRouter(prefix="/reports/config", tags=["config"])


@router.get("", response_model=List[ReportConfigOut])
async def list_configs(db: AsyncSession = Depends(get_db), current_user=Depends(require_shore)):
    """
    List all report configs for the scraper.
    """
    stmt = select(ReportConfig).order_by(ReportConfig.vessel_name)
    result = await db.execute(stmt)
    return result.scalars().all()


@router.post("", response_model=ReportConfigOut)
async def create_config(config: ReportConfigCreate, db: AsyncSession = Depends(get_db), current_user=Depends(require_shore)):
    """
    Create a new report scraper configuration.
    """
    stmt = select(ReportConfig).where(
        ReportConfig.vessel_imo == config.vessel_imo,
        ReportConfig.report_code == config.report_code,
    )
    result = await db.execute(stmt)
    if result.scalars().first():
        raise HTTPException(
            status_code=409,
            detail="A config with this report_code already exists for this vessel.",
        )

    new_config = ReportConfig(
        id=uuid.uuid4(),
        vessel_imo=config.vessel_imo,
        vessel_name=config.vessel_name,
        report_code=config.report_code,
        report_name=config.report_name,
        department=config.department,
        frequency=config.frequency,
    )
    db.add(new_config)
    await db.commit()
    await db.refresh(new_config)
    return new_config


@router.post("/bulk-assign")
async def bulk_assign_configs(req: BulkAssignRequest, db: AsyncSession = Depends(get_db), current_user=Depends(require_shore)):
    """
    Bulk assign the 45 default master reports to a specific vessel.
    """
    default_reports = get_default_configs()
    if not default_reports:
        raise HTTPException(status_code=400, detail="Default reports config not found or could not be parsed")

    # Fetch existing configs for this vessel to avoid duplicates
    stmt = select(ReportConfig.report_code).where(ReportConfig.vessel_imo == req.vessel_imo)
    result = await db.execute(stmt)
    existing_codes = set(result.scalars().all())

    inserted_count = 0
    for r in default_reports:
        if r["report_code"] not in existing_codes:
            new_config = ReportConfig(
                id=uuid.uuid4(),
                vessel_imo=req.vessel_imo,
                vessel_name=req.vessel_name,
                report_code=r["report_code"],
                report_name=r["report_name"],
                department=r["department"],
                frequency=r["frequency"],
            )
            db.add(new_config)
            inserted_count += 1
            
    if inserted_count > 0:
        await db.commit()

    return {"message": f"Successfully assigned {inserted_count} new reports to {req.vessel_name}", "inserted": inserted_count}


@router.delete("/{config_id}", status_code=204)
async def delete_config(config_id: uuid.UUID, db: AsyncSession = Depends(get_db), current_user=Depends(require_shore)):
    """
    Delete a report config.
    """
    stmt = select(ReportConfig).where(ReportConfig.id == config_id)
    result = await db.execute(stmt)
    config = result.scalars().first()
    
    if not config:
        raise HTTPException(status_code=404, detail="Config not found")
        
    await db.delete(config)
    await db.commit()
    return None
