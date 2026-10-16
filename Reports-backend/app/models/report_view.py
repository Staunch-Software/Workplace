# app/models/report_view.py
from datetime import datetime
from sqlalchemy import Column, String, DateTime
from sqlalchemy.dialects.postgresql import UUID
from app.core.database import Base


class ReportView(Base):
    """Records that a user has opened a report's attachment (one row per user+report).

    Drives the "new vs viewed" look of attachment icons on the Overview matrix,
    so the state follows the user across browsers and devices.
    """
    __tablename__ = "report_views"

    user_id   = Column(String(100), primary_key=True)
    report_id = Column(UUID(as_uuid=True), primary_key=True)
    viewed_at = Column(DateTime, default=datetime.utcnow, nullable=False)
