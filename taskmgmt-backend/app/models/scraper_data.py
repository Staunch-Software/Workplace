# Shadow copies of tables owned by this repo's OTHER Python project — scraper_worker's
# own db.py + the raw op.create_table migrations in alembic/versions/0002_extraction_layer.py
# onward. Same physical database (TASKMGMT_DATABASE_URL) as this app's own Base-managed
# tables, but a different owner/migration path — scraper_worker uses plain SQLAlchemy Core
# against a sync engine, this app uses its own async Base.
#
# Kept on their own declarative base (ScraperBase), NOT app.database.Base, for the same
# reason app/models/control/*.py shadow-copies the control DB's User/Vessel onto a separate
# ControlBase: alembic/env.py's target_metadata = Base.metadata would otherwise try to
# manage/diff these tables, which this app doesn't own and shouldn't migrate.
#
# Only the columns actually read by app/services/*.py are declared here — keep in sync
# manually with scraper_worker/db.py if a query here starts needing a new column.
from sqlalchemy import BigInteger, Column, Date, DateTime, Integer, Text
from sqlalchemy.orm import DeclarativeBase


class ScraperBase(DeclarativeBase):
    pass


class ClassSurvey(ScraperBase):
    __tablename__ = "class_surveys"
    __table_args__ = {"extend_existing": True}

    id = Column(Integer, primary_key=True)
    vessel_id = Column(Integer, nullable=False)  # our canonical IMO (int), not source-native
    source = Column(Text, nullable=False)  # 'DNV' | 'ABS' | 'IRS'
    survey_name = Column(Text)
    due_date = Column(Date)
    range_date_from = Column(Date)
    range_date_to = Column(Date)


class SmartpalSurvey(ScraperBase):
    __tablename__ = "smartpal_surveys"
    __table_args__ = {"extend_existing": True}

    id = Column(BigInteger, primary_key=True, autoincrement=False)
    vessel_id = Column(Integer, nullable=False)  # SmartPAL's OWN native vessel id, NOT our IMO
    survey_name = Column(Text)
    date_due = Column(Date)
    due_range_from = Column(Date)
    due_range_to = Column(Date)


class VesselSourceId(ScraperBase):
    """IMO <-> source-native-id resolution, one row per (imo_number, source). Needed to turn
    smartpal_surveys.vessel_id (SmartPAL's own id) back into our canonical IMO — class_surveys
    doesn't need this, its vessel_id is already IMO-keyed (see scraper_worker's dnv/abs/irs
    extract.py: "vessel_id = our canonical IMO ... this must be IMO-keyed rather than
    source-native across the shared class_* tables")."""
    __tablename__ = "vessel_source_ids"
    __table_args__ = {"extend_existing": True}

    id = Column(Integer, primary_key=True)
    imo_number = Column(Text, nullable=False)
    source = Column(Text, nullable=False)
    source_vessel_id = Column(Text, nullable=False)
