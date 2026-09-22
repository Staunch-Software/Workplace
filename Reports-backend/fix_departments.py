import asyncio
import logging
from sqlalchemy.future import select
from app.core.database import SessionLocal
from app.models.report import Report, ReportConfig

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")

async def fix_departments():
    async with SessionLocal() as db:
        # Load all configs into a dictionary keyed by report_code
        res_cfg = await db.execute(select(ReportConfig))
        configs = res_cfg.scalars().all()
        config_map = {cfg.report_code: cfg for cfg in configs}

        # Load all reports
        res_rep = await db.execute(select(Report))
        reports = res_rep.scalars().all()

        updated_count = 0
        for rep in reports:
            # If the report code matches a config, ensure the department and frequency are synced
            if rep.report_code in config_map:
                cfg = config_map[rep.report_code]
                needs_update = False
                
                # Check department
                if rep.department != cfg.department:
                    rep.department = cfg.department
                    needs_update = True
                
                # Check frequency
                if rep.frequency != cfg.frequency:
                    rep.frequency = cfg.frequency
                    needs_update = True
                
                if needs_update:
                    updated_count += 1
            
            # Special fallback for generic codes
            elif rep.report_code in ("SP-WEEKLY", "SP-MONTHLY", "SP-QUARTERLY") and (rep.department is None or rep.department == ""):
                rep.department = "OTHER"
                updated_count += 1

        if updated_count > 0:
            await db.commit()
            logging.info(f"Successfully updated {updated_count} reports with the correct department/frequency.")
        else:
            logging.info("All reports already have the correct department and frequency.")

if __name__ == '__main__':
    asyncio.run(fix_departments())
