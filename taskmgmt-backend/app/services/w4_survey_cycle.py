# Subtask 1.W.4 — Class survey cycle review.
#
# This is the first fully data-backed subtask under Task 1 (Survey planning and Arrangement)
# — its shape (a plain async handler taking (db, control_db) and returning a Pydantic model)
# is the template 1.W.1–1.W.3 and 1.W.5 should follow once their own backend logic exists;
# see app/routes/subtasks.py's SUBTASK_VESSEL_HANDLERS registry.
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.control.vessel import Vessel
from app.models.scraper_data import ClassSurvey, SmartpalSurvey, VesselSourceId
from app.schemas.task_schemas import SurveyCycleReviewOut, SurveyCycleRow
from app.utils.urgency import days_remaining, urgency_bucket

WINDOW_LOWER_DAYS = 30
WINDOW_UPPER_DAYS = 90


async def get_survey_cycle_review(db: AsyncSession, control_db: AsyncSession) -> SurveyCycleReviewOut:
    today = date.today()
    lower = today + timedelta(days=WINDOW_LOWER_DAYS)
    upper = today + timedelta(days=WINDOW_UPPER_DAYS)

    # class_surveys (DNV/ABS/IRS): effective due date is range_date_to, falling back to
    # due_date when range_date_to is null. The fallback makes a single SQL WHERE clumsy
    # (COALESCE across two nullable columns plus a window check reads worse than it saves
    # for a table this small — low tens/hundreds of rows per vessel), so pull rows that have
    # either date set and do the effective-date + window filtering in Python instead.
    class_res = await db.execute(
        select(ClassSurvey).where(
            ClassSurvey.range_date_to.isnot(None) | ClassSurvey.due_date.isnot(None)
        )
    )
    class_rows_all = class_res.scalars().all()
    class_rows = []
    for r in class_rows_all:
        eff = r.range_date_to or r.due_date
        if eff is not None and lower <= eff <= upper:
            class_rows.append((r, eff))

    # smartpal_surveys: effective due date is date_due.
    smartpal_res = await db.execute(
        select(SmartpalSurvey).where(
            SmartpalSurvey.date_due.isnot(None),
            SmartpalSurvey.date_due >= lower,
            SmartpalSurvey.date_due <= upper,
        )
    )
    smartpal_rows = smartpal_res.scalars().all()

    # SmartPAL's own vessel_id is source-native, not our IMO — resolve it back via
    # vessel_source_ids (class_surveys.vessel_id is already IMO-keyed, no resolution needed).
    vsid_res = await db.execute(select(VesselSourceId).where(VesselSourceId.source == "SMARTPAL"))
    smartpal_imo_by_native_id = {v.source_vessel_id: v.imo_number for v in vsid_res.scalars().all()}

    needed_imos = {str(r.vessel_id) for r, _ in class_rows}
    for r in smartpal_rows:
        imo = smartpal_imo_by_native_id.get(str(r.vessel_id))
        if imo:
            needed_imos.add(imo)

    vessel_name_by_imo = {}
    if needed_imos:
        vessels_res = await control_db.execute(select(Vessel).where(Vessel.imo.in_(needed_imos)))
        vessel_name_by_imo = {v.imo: v.name for v in vessels_res.scalars().all()}

    rows_out = []
    distinct_vessels = set()

    for r, eff in class_rows:
        imo = str(r.vessel_id)
        dr = days_remaining(eff, today)
        rows_out.append(SurveyCycleRow(
            vessel_name=vessel_name_by_imo.get(imo, f"IMO {imo}"),
            survey_name=r.survey_name or "",
            range_date_from=r.range_date_from,
            range_date_to=r.range_date_to,
            due_date=eff,
            days_remaining=dr,
            urgency=urgency_bucket(dr),
            source=r.source,
        ))
        distinct_vessels.add(imo)

    for r in smartpal_rows:
        imo = smartpal_imo_by_native_id.get(str(r.vessel_id))
        vessel_name = vessel_name_by_imo.get(imo) if imo else None
        if not vessel_name:
            # Genuinely unresolved (no vessel_source_ids row, or the mapped IMO isn't in the
            # control DB's vessel list) — show it plainly rather than silently dropping the row.
            vessel_name = f"SmartPAL vessel {r.vessel_id} (unmapped)"
        dr = days_remaining(r.date_due, today)
        rows_out.append(SurveyCycleRow(
            vessel_name=vessel_name,
            survey_name=r.survey_name or "",
            range_date_from=r.due_range_from,
            range_date_to=r.due_range_to,
            due_date=r.date_due,
            days_remaining=dr,
            urgency=urgency_bucket(dr),
            source="SMARTPAL",
        ))
        distinct_vessels.add(imo or f"smartpal:{r.vessel_id}")

    rows_out.sort(key=lambda row: row.days_remaining if row.days_remaining is not None else 9999)

    return SurveyCycleReviewOut(vessel_count=len(distinct_vessels), rows=rows_out)
