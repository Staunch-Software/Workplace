# app/models/task.py — this module's own domain tables (TASKMGMT_DATABASE_URL)
from sqlalchemy import Column, DateTime, Integer, String, Text, Float, ForeignKey, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from app.database import Base


class TaskMaster(Base):
    """The 63 recurring technical-department tasks, seeded once from the source RACI register."""
    __tablename__ = "task_master"

    id = Column(Integer, primary_key=True, autoincrement=True)
    item_no = Column(Integer, nullable=False)
    description = Column(Text, nullable=False)
    interval = Column(String, nullable=True)
    priority = Column(Integer, nullable=True)
    effort_reduction = Column(Float, nullable=True)


class VesselRoleAssignment(Base):
    """Which user fills a given role on a given vessel. One row per (vessel, role)."""
    __tablename__ = "vessel_role_assignment"
    __table_args__ = (
        UniqueConstraint("vessel_imo", "role_code", name="uq_vessel_role"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    vessel_imo = Column(String(7), nullable=False, index=True)
    role_code = Column(String, nullable=False)
    user_id = Column(UUID(as_uuid=True), nullable=True)  # FK removed — cross-DB (control DB owns users)


class TaskRaciEntry(Base):
    """RACI involvement of a role on a task, for a given vessel. Multiple letters per cell (e.g. ["R","A"])."""
    __tablename__ = "task_raci_entry"
    __table_args__ = (
        UniqueConstraint("vessel_imo", "task_id", "role_code", name="uq_vessel_task_role"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    vessel_imo = Column(String(7), nullable=False, index=True)
    task_id = Column(Integer, ForeignKey("task_master.id", ondelete="CASCADE"), nullable=False)
    role_code = Column(String, nullable=False)
    raci_values = Column(JSONB, nullable=False, server_default='[]')


class WorkOrderTrigger(Base):
    """Records that someone clicked "Trigger work order" on a subtask (e.g. 1.W.4's survey
    cycle review table). Stub only — no actual SmartPAL/MariApps work-order API integration
    yet, that's future scope. This just needs to prove someone asked for one."""
    __tablename__ = "work_order_triggers"

    id = Column(Integer, primary_key=True, autoincrement=True)
    task_code = Column(String, nullable=False)  # e.g. '1.W.4'
    vessel_name = Column(String, nullable=False)
    survey_name = Column(String, nullable=False)
    source = Column(String, nullable=False)  # 'DNV' | 'ABS' | 'IRS' | 'SMARTPAL'
    triggered_by = Column(String, nullable=True)  # email/full_name of the requesting user
    triggered_at = Column(DateTime(timezone=True), nullable=False)
