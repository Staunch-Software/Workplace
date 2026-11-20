"""
backend/sync_processor.py
-------------------------
VP Sync Processor: pulls VP snapshot data from Shore and upserts into local DB.
Used when STORAGE_MODE=offline (on vessel).
"""
import os
import json
import logging
import traceback
from datetime import datetime, timezone, date
from typing import Optional, Dict, Any, List

import httpx
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy import inspect as sa_inspect

from backend.database import SessionLocal
from backend.models import (
    Vessel,
    VesselParticulars,
    AnalysisData,
    FleetStatusData,
    VesselDesignData,
    ISO19030Result,
    VesselCPConfig,
    CPVesselDescription,
    CPSeaWarranty,
    CPPortWarranty,
    MariAppsBunkerReport,
    BiofuelPoS,
    BiofuelBunkerStem,
    ExpandedColumnMetadata,
    UserColumnPreference,
    VesselColumnDefault,
)

log = logging.getLogger("uvicorn")

TRANSIENT_KEYWORDS = [
    "network error", "ssl", "wrong_version_number", "timeout",
    "connecterror", "connection refused", "remotedisconnected",
    "temporary failure", "name or service not known", "closed stream",
    "eof occurred", "connection reset",
]


def _is_transient(msg: str) -> bool:
    low = (msg or "").lower()
    return any(k in low for k in TRANSIENT_KEYWORDS)


def _parse_date(v) -> Optional[date]:
    if v is None:
        return None
    if isinstance(v, date):
        return v
    try:
        return datetime.fromisoformat(str(v)[:10]).date()
    except Exception:
        return None


def _parse_dt(v) -> Optional[datetime]:
    if v is None:
        return None
    if isinstance(v, datetime):
        return v
    try:
        return datetime.fromisoformat(str(v).replace("Z", "+00:00"))
    except Exception:
        return None


class VPSyncProcessor:
    def __init__(self):
        self.cloud_base = os.getenv("CLOUD_BASE_URL", "https://workplace.ozellar.com/vp").rstrip("/")
        self.api_key = os.getenv("SYNC_API_KEY", "PROD_SECURE_SYNC_9922")
        self.vessel_imo = os.getenv("VESSEL_IMO", "")
        self.state_file = os.path.join(os.path.dirname(__file__), "..", "data", "vp_sync_state.json")
        self.last_error = None
        self.failed_items = 0

    def _get_last_pull(self) -> Optional[str]:
        if os.path.exists(self.state_file):
            try:
                with open(self.state_file, "r") as f:
                    return json.load(f).get("last_pull_at")
            except Exception:
                pass
        return None

    def _save_last_pull(self, ts: str):
        try:
            os.makedirs(os.path.dirname(self.state_file), exist_ok=True)
            with open(self.state_file, "w") as f:
                json.dump({"last_pull_at": ts}, f)
        except Exception as e:
            log.warning(f"[VP SYNC] Could not save state: {e}")

    def _client(self) -> httpx.Client:
        return httpx.Client(
            verify=False,
            trust_env=False,
            timeout=httpx.Timeout(30.0, connect=15.0),
            headers={"X-Sync-API-Key": self.api_key},
        )

    def pull_and_sync(self) -> bool:
        """Pulls VP snapshot from shore and updates local database."""
        if not self.vessel_imo:
            log.warning("[VP SYNC] VESSEL_IMO not set, skipping sync.")
            return False

        url = f"{self.cloud_base}/api/v1/vessel-sync/vp/snapshot"
        params = {"vessel_imo": self.vessel_imo}
        last_pull = self._get_last_pull()
        if last_pull:
            params["since"] = last_pull
            log.info(f"[VP SYNC] Incremental sync since {last_pull} for IMO {self.vessel_imo}")
        else:
            log.info(f"[VP SYNC] Initial sync from {url} for IMO {self.vessel_imo}")

        try:
            with self._client() as client:
                resp = client.get(url, params=params)
                if resp.status_code != 200:
                    self.last_error = f"Shore HTTP {resp.status_code}: {resp.text[:200]}"
                    log.error(f"[VP SYNC] {self.last_error}")
                    self.failed_items = 1
                    self.send_heartbeat()
                    return False

                data = resp.json()
                snapshot = data.get("snapshot", {})
                self._apply_snapshot(snapshot)
                self.last_error = None
                self.failed_items = 0
                gen_at = data.get("generated_at")
                if gen_at:
                    self._save_last_pull(gen_at)
                log.info("[VP SYNC] Successfully applied snapshot to local DB.")
                self.send_heartbeat()
                return True

        except Exception as e:
            msg = str(e)
            self.last_error = f"Sync exception: {msg}"
            self.failed_items = 1
            if _is_transient(msg):
                log.warning(f"[VP SYNC] Transient network error (will retry): {msg}")
            else:
                log.error(f"[VP SYNC] Sync error: {traceback.format_exc()}")
            self.send_heartbeat()
            return False

    def send_heartbeat(self):
        """Sends telemetry / heartbeat to shore."""
        if not self.vessel_imo:
            return
        url = f"{self.cloud_base}/api/v1/vessel-sync/heartbeat"
        telemetry = {
            "failed_items_count": self.failed_items,
            "active_errors": [{"entity": "VP", "msg": self.last_error, "ts": datetime.utcnow().isoformat()}] if self.last_error else [],
            "last_local_error": self.last_error or "No local errors",
        }
        try:
            with self._client() as client:
                client.post(url, json={"vessel_imo": self.vessel_imo, "vessel_telemetry": telemetry}, timeout=10.0)
                log.info(f"[VP SYNC] Heartbeat sent to shore (failed={self.failed_items}).")
        except Exception as e:
            log.warning(f"[VP SYNC] Heartbeat failed (satellite offline?): {e}")

    def _apply_snapshot(self, snapshot: dict):
        """Upserts all models from the snapshot into the local database."""
        db = SessionLocal()
        try:
            # 1. Vessels
            self._upsert_rows(db, Vessel, snapshot.get("vessels", []), pk_cols=["imo_number"])

            # 2. Vessel Particulars
            self._upsert_rows(db, VesselParticulars, snapshot.get("vessel_particulars", []), pk_cols=["id"])

            # 3. AnalysisData
            self._upsert_rows(db, AnalysisData, snapshot.get("analysis_data", []), pk_cols=["id"])

            # 4. FleetStatusData
            self._upsert_rows(db, FleetStatusData, snapshot.get("fleet_status", []), pk_cols=["id"])

            # 5. VesselDesignData
            self._upsert_rows(db, VesselDesignData, snapshot.get("vessel_design", []), pk_cols=["id"])

            # 6. ISO19030Result
            self._upsert_rows(db, ISO19030Result, snapshot.get("iso19030_results", []), pk_cols=["id"])

            # 7. VesselCPConfig & Warranties
            self._upsert_rows(db, VesselCPConfig, snapshot.get("cp_config", []), pk_cols=["id"])
            self._upsert_rows(db, CPVesselDescription, snapshot.get("cp_vessel_description", []), pk_cols=["id"])
            self._upsert_rows(db, CPSeaWarranty, snapshot.get("cp_sea_warranties", []), pk_cols=["id"])
            self._upsert_rows(db, CPPortWarranty, snapshot.get("cp_port_warranties", []), pk_cols=["id"])

            # 8. MariAppsBunkerReport
            self._upsert_rows(db, MariAppsBunkerReport, snapshot.get("bunker_reports", []), pk_cols=["id"])

            # 9. Biofuel
            self._upsert_rows(db, BiofuelPoS, snapshot.get("biofuel_pos", []), pk_cols=["id"])
            self._upsert_rows(db, BiofuelBunkerStem, snapshot.get("biofuel_bunker_stems", []), pk_cols=["id"])

            # 10. Columns metadata & config
            self._upsert_rows(db, ExpandedColumnMetadata, snapshot.get("expanded_columns", []), pk_cols=["id"])
            self._upsert_rows(db, UserColumnPreference, snapshot.get("column_preferences", []), pk_cols=["id"])
            self._upsert_rows(db, VesselColumnDefault, snapshot.get("column_defaults", []), pk_cols=["id"])

            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    def _upsert_rows(self, db, model, rows: list, pk_cols: list):
        if not rows:
            return
        mapper = sa_inspect(model)
        valid_cols = {c.key: c for c in mapper.columns}

        for r in rows:
            clean_row = {}
            for k, v in r.items():
                if k in valid_cols:
                    col = valid_cols[k]
                    type_str = str(col.type).lower()
                    if "date" in type_str and "time" not in type_str:
                        clean_row[k] = _parse_date(v)
                    elif "timestamp" in type_str or "datetime" in type_str:
                        clean_row[k] = _parse_dt(v)
                    else:
                        clean_row[k] = v

            if not clean_row:
                continue

            update_dict = {k: v for k, v in clean_row.items() if k not in pk_cols}
            stmt = pg_insert(model).values(**clean_row)
            if update_dict:
                stmt = stmt.on_conflict_do_update(index_elements=pk_cols, set_=update_dict)
            else:
                stmt = stmt.on_conflict_do_nothing(index_elements=pk_cols)
            db.execute(stmt)
