# =============================================================================
# app/models/mariapps_pr_cache.py
#
# Cache table that stores raw PR data scraped from Mariapps.
# This is FULLY SEPARATE from DRS — it is the staging area.
# The sync service reads from here and updates pr_entries.pr_status.
# =============================================================================

import uuid
from sqlalchemy import Column, String, DateTime, Boolean
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from app.core.database import Base


class MariappsPrCache(Base):
    __tablename__ = "mariapps_pr_cache"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # Scraped directly from Mariapps grid
    requisition_no = Column(String, nullable=False, unique=True, index=True)
    vessel_name    = Column(String, nullable=False)
    stage          = Column(String, nullable=True)   # e.g. "RFQ Sent", "PO Finally Approved"
    status         = Column(String, nullable=True)   # e.g. "Approved", "Finally Approved"
    department     = Column(String, nullable=True)
    created_by     = Column(String, nullable=True)
    approved_date  = Column(String, nullable=True)   # stored as string, Mariapps format

    # Housekeeping
    last_scraped_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    created_at      = Column(DateTime(timezone=True), server_default=func.now())