# app/backfill_thresholds.py
"""
One-time backfill: re-run ME and AE alert classification for ALL existing reports
already sitting in the database, using the CURRENT threshold code
(report_processor.ALERT_THRESHOLDS / ae_alert_processor.THRESHOLDS) — the revised
2026-09 thresholds.

Why this exists: thresholds are evaluated ONCE at upload time and the resulting
Normal/Warning/Critical rows are stored in the DB (MENormalStatus/MEWarningAlert/
MECriticalAlert for ME, AENormalStatus/AEWarningAlert/AECriticalAlert for AE). The
dashboard reads those stored rows — it does not recompute them. Reports uploaded
before the threshold revision still carry the OLD classification until reprocessed.

This script does NOT need the original report files. Everything required (the
report's parsed values + the vessel's shop-trial baseline) is already in the
database — it just re-runs the same classification step the upload pipeline runs.

Usage (run from the Aepms-backend directory, with the venv active):
    python -m app.backfill_thresholds --dry-run              # report only, writes nothing
    python -m app.backfill_thresholds --dry-run --engine me  # ME only, dry run
    python -m app.backfill_thresholds --engine ae            # AE only, for real
    python -m app.backfill_thresholds                        # both engines, for real

Always run --dry-run first and read the summary before running for real.
"""
import argparse
import asyncio
import logging

from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.pool import NullPool

from app.database import SQLALCHEMY_DATABASE_URL
from app.models import (
    MonthlyReportHeader,
    MonthlyISOPerformanceData,
    VesselInfo,
    ShopTrialPerformanceData,
    ShopTrialSession,
    MENormalStatus,
    MEWarningAlert,
    MECriticalAlert,
)
from app.report_processor import process_me_alerts, update_me_alert_summary
from app.generator_models import GeneratorMonthlyReportHeader
from app.ae_alert_processor import process_ae_alerts
from app.me_iso_corrector import MEISOCorrector

logging.basicConfig(level=logging.WARNING)
logger = logging.getLogger("backfill_thresholds")
logger.setLevel(logging.INFO)

# This script runs as its OWN OS process, separate from the live backend service.
# The app's shared engine (app.database.AsyncSessionLocal) pools up to 10 connections
# (pool_size=5 + max_overflow=5) PER PROCESS — using it here would add up to 10 more
# connections on top of whatever the running backend already holds, which can exhaust
# a VM's Postgres max_connections. NullPool here guarantees this script holds at most
# ONE connection at a time, opened and closed around each individual query/report.
_backfill_engine = create_async_engine(SQLALCHEMY_DATABASE_URL, poolclass=NullPool, echo=False)
AsyncSessionLocal = async_sessionmaker(
    _backfill_engine, class_=AsyncSession, expire_on_commit=False, autoflush=False, autocommit=False,
)


async def _build_me_baseline_and_monthly(session: AsyncSession, header: MonthlyReportHeader, iso_record: MonthlyISOPerformanceData):
    """Mirrors the exact baseline_list / monthly_dict construction in
    report_processor.py's upload pipeline (lines ~728-756) — rebuilt here from
    data already in the DB, so no original file is needed."""
    vessel_result = await session.execute(
        select(VesselInfo).where(VesselInfo.imo_number == header.imo_number)
    )
    vessel_info = vessel_result.scalar_one_or_none()
    if not vessel_info or not vessel_info.engine_no:
        return None, None

    st_result = await session.execute(
        select(ShopTrialPerformanceData)
        .join(ShopTrialSession, ShopTrialPerformanceData.session_id == ShopTrialSession.session_id)
        .where(ShopTrialSession.engine_no == vessel_info.engine_no)
        .order_by(ShopTrialPerformanceData.load_percentage)
    )
    st_sess = st_result.scalars().all()
    if not st_sess:
        return None, None

    baseline_list = [{
        "load_percentage": float(r.load_percentage),
        "max_combustion_pressure_bar": float(r.max_combustion_pressure_iso_bar or 0),
        "compression_pressure_bar": float(r.compression_pressure_iso_bar or 0),
        "scav_air_pressure_kg_cm2": float(r.scav_air_pressure_iso_kg_cm2 or 0),
        "turbocharger_speed_x1000_rpm": float(r.turbocharger_speed_x1000_iso_rpm or 0),
        "exh_temp_tc_inlet_c": float(r.exh_temp_tc_inlet_iso_c or 0),
        "exh_temp_tc_outlet_c": float(r.exh_temp_tc_outlet_iso_c or 0),
        "cyl_exhaust_gas_temp_outlet_c": float(r.exh_temp_cylinder_outlet_ave_c or 0),
        "fuel_inj_pump_index_mm": float(r.fuel_injection_pump_index_mm or 0),
        "fuel_consumption_total_kg_h": float(r.fuel_oil_consumption_kg_h or 0),
        "engine_speed_rpm": float(r.engine_speed_rpm or 0),
        "sfoc_g_kwh": float(r.fuel_oil_consumption_iso_g_kwh or r.fuel_oil_consumption_g_kwh or 0),
    } for r in st_sess]

    monthly_dict = {
        "max_combustion_pressure_bar": float(iso_record.max_combustion_pressure_iso_bar or 0),
        "compression_pressure_bar": float(iso_record.compression_pressure_iso_bar or 0),
        "scav_air_pressure_kg_cm2": float(iso_record.scav_air_pressure_graph_kg_cm2 or 0),
        "turbocharger_speed_x1000_rpm": float(iso_record.turbocharger_speed_graph_x1000_rpm_scaled or 0),
        "exh_temp_tc_inlet_c": float(iso_record.exh_temp_tc_inlet_iso_c or 0),
        "exh_temp_tc_outlet_c": float(iso_record.exh_temp_tc_outlet_iso_c or 0),
        "cyl_exhaust_gas_temp_outlet_c": float(iso_record.cyl_exhaust_gas_temp_outlet_graph_c or 0),
        "fuel_inj_pump_index_mm": float(iso_record.fuel_inj_pump_index_graph_mm or 0),
        "fuel_consumption_total_kg_h": float(iso_record.fuel_consumption_total_graph_kg_h or 0),
        "engine_speed_rpm": float(iso_record.engine_speed_graph_rpm or 0),
        "sfoc_g_kwh": float(iso_record.sfoc_graph_g_kwh or 0),
        "load_percent": float(header.load_percent or 0),
    }
    return baseline_list, monthly_dict, vessel_info


async def backfill_me(dry_run: bool) -> dict:
    counts = {
        "reports_seen": 0,
        "reports_reprocessed": 0,
        "iso_generated": 0,
        "skipped_no_baseline": 0,
    }
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(MonthlyReportHeader.report_id).order_by(MonthlyReportHeader.report_id)
        )
        report_ids = [r[0] for r in result.all()]

    for report_id in report_ids:
        counts["reports_seen"] += 1
        async with AsyncSessionLocal() as session:
            header_result = await session.execute(
                select(MonthlyReportHeader).where(MonthlyReportHeader.report_id == report_id)
            )
            header = header_result.scalar_one_or_none()
            iso_result = await session.execute(
                select(MonthlyISOPerformanceData).where(MonthlyISOPerformanceData.report_id == report_id)
            )
            iso_record = iso_result.scalar_one_or_none()
            if not header:
                logger.warning(f"SKIPPED ME report {report_id}: no MonthlyReportHeader row found")
                counts["skipped_no_baseline"] += 1
                continue
            if not iso_record:
                # This report was never given its ISO-corrected data at upload time —
                # the original pipeline only calls process_me_alerts "if iso_record exists",
                # so a report missing this row has ZERO alert rows to this day, and its
                # me_alert_summary (if any) was never derived from real data. Generate the
                # missing ISO record now (same step the original upload runs), instead of
                # skipping, so this report can finally get correctly classified.
                if dry_run:
                    logger.warning(
                        f"[DRY RUN] ME report {report_id} (imo {header.imo_number}, {header.report_month}): "
                        f"no MonthlyISOPerformanceData row found — would generate it and reprocess"
                    )
                    counts["iso_generated"] += 1
                    counts["reports_reprocessed"] += 1
                    continue

                logger.warning(
                    f"ME report {report_id} (imo {header.imo_number}, {header.report_month}): "
                    f"no MonthlyISOPerformanceData row found — generating it now"
                )
                try:
                    iso_corrector = MEISOCorrector(session)
                    iso_record = await iso_corrector.process_and_save_iso_correction(report_id)
                    await session.commit()
                except Exception as e:
                    logger.error(f"SKIPPED ME report {report_id}: ISO correction failed: {e}")
                    counts["skipped_no_baseline"] += 1
                    continue
                if not iso_record:
                    logger.error(f"SKIPPED ME report {report_id}: ISO correction returned nothing")
                    counts["skipped_no_baseline"] += 1
                    continue
                counts["iso_generated"] += 1

            built = await _build_me_baseline_and_monthly(session, header, iso_record)
            if built[0] is None:
                vessel_result = await session.execute(
                    select(VesselInfo).where(VesselInfo.imo_number == header.imo_number)
                )
                vessel_info_dbg = vessel_result.scalar_one_or_none()
                logger.warning(
                    f"SKIPPED ME report {report_id} ({vessel_info_dbg.vessel_name if vessel_info_dbg else '?'}, "
                    f"{header.report_month}): no shop-trial baseline rows found for engine_no="
                    f"{vessel_info_dbg.engine_no if vessel_info_dbg else '?'}"
                )
                counts["skipped_no_baseline"] += 1
                continue
            baseline_list, monthly_dict, vessel_info = built

            if dry_run:
                logger.info(f"[DRY RUN] ME report {report_id} ({vessel_info.vessel_name}) would be reprocessed")
                counts["reports_reprocessed"] += 1
                continue

            # process_me_alerts does NOT delete prior rows itself — must clear first
            # to avoid duplicate alert rows on a second run.
            await session.execute(delete(MENormalStatus).where(MENormalStatus.report_id == report_id))
            await session.execute(delete(MEWarningAlert).where(MEWarningAlert.report_id == report_id))
            await session.execute(delete(MECriticalAlert).where(MECriticalAlert.report_id == report_id))

            await process_me_alerts(session, report_id, baseline_list, monthly_dict)
            await update_me_alert_summary(
                session, report_id, vessel_info.vessel_name, vessel_info.imo_number,
                header.report_date, header.report_month,
            )
            await session.commit()
            counts["reports_reprocessed"] += 1
            logger.info(f"ME report {report_id} ({vessel_info.vessel_name}) reprocessed")

    return counts


async def backfill_ae(dry_run: bool) -> dict:
    counts = {"reports_seen": 0, "reports_reprocessed": 0, "skipped_error": 0}
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(GeneratorMonthlyReportHeader.report_id).order_by(GeneratorMonthlyReportHeader.report_id)
        )
        report_ids = [r[0] for r in result.all()]

    for report_id in report_ids:
        counts["reports_seen"] += 1
        if dry_run:
            logger.info(f"[DRY RUN] AE report {report_id} would be reprocessed")
            counts["reports_reprocessed"] += 1
            continue
        async with AsyncSessionLocal() as session:
            try:
                await process_ae_alerts(session, report_id)
                await session.commit()
                counts["reports_reprocessed"] += 1
                logger.info(f"AE report {report_id} reprocessed")
            except Exception as e:
                await session.rollback()
                counts["skipped_error"] += 1
                logger.error(f"AE report {report_id} failed: {e}")

    return counts


async def main():
    parser = argparse.ArgumentParser(description="Backfill ME/AE alert thresholds for existing reports")
    parser.add_argument("--dry-run", action="store_true", help="Report what would change, write nothing")
    parser.add_argument("--engine", choices=["me", "ae", "both"], default="both")
    args = parser.parse_args()

    if args.engine in ("me", "both"):
        logger.info("=== Backfilling Main Engine (ME) alerts ===")
        me_counts = await backfill_me(args.dry_run)
        logger.info(f"ME summary: {me_counts}")

    if args.engine in ("ae", "both"):
        logger.info("=== Backfilling Auxiliary Engine (AE) alerts ===")
        ae_counts = await backfill_ae(args.dry_run)
        logger.info(f"AE summary: {ae_counts}")

    logger.info("Done." + (" (dry run — nothing was written)" if args.dry_run else ""))


if __name__ == "__main__":
    asyncio.run(main())
