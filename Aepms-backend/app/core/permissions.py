# app/core/permissions.py
import logging
from typing import List, Tuple

logger = logging.getLogger(__name__)

def get_allowed_vessel_imos(current_user: dict) -> Tuple[List[int], str]:
    from app.model.control.vessel import Vessel as ControlVessel
    from app.core.database_control import SessionControl
    from sqlalchemy import text

    # Extract user ID from either 'id' or 'sub'
    user_id_raw = current_user.get("id") or current_user.get("sub")
    role = str(current_user.get("role") or "").upper()

    control_db = SessionControl()
    try:
        if not user_id_raw:
            logger.warning("get_allowed_vessel_imos: no user_id in token")
            return[], role

        query = text("""
            SELECT vessel_imo
            FROM user_vessel_link
            WHERE user_id = CAST(:uid AS UUID)
        """)
        result = control_db.execute(query, {"uid": str(user_id_raw)}).fetchall()
        clean_imos = [int(row[0]) for row in result if str(row[0]).isdigit()]

        logger.info(f"User {user_id_raw} (role={role}) assigned IMOs: {clean_imos}")

        if clean_imos:
            return clean_imos, role

        if role in ("ADMIN", "SUPERUSER", "SHORE", "SUPERINTENDENT"):
            all_vessels = control_db.query(ControlVessel).all()
            all_imos =[int(v.imo) for v in all_vessels if str(v.imo).isdigit()]
            logger.info(f"Elevated role {role} granted all IMOs: {all_imos}")
            return all_imos, role

        logger.warning(f"User {user_id_raw} has no assigned vessels and role {role} is not elevated")
        return[], role

    except Exception as e:
        logger.error(f"get_allowed_vessel_imos error: {e}", exc_info=True)
        return