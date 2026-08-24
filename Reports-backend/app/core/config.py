# app/core/config.py
import os
from pydantic_settings import BaseSettings
from urllib.parse import quote_plus
from enum import Enum


class StorageMode(str, Enum):
    OFFLINE = "offline"  # Vessel deployment
    ONLINE = "online"    # Shore/cloud deployment


class Settings(BaseSettings):
    PROJECT_NAME: str = "SmartPAL Report Tracker"
    API_V1_STR: str = "/api/v1"

    # Defaults to ONLINE (shore) so existing deployments are unaffected
    # unless STORAGE_MODE=offline is explicitly set in .env for a vessel
    # instance.
    STORAGE_MODE: StorageMode = StorageMode.ONLINE

    # Shared JWT secret with workplace-backend
    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7

    # Control plane DB (Users, Vessels — shared with workplace)
    CONTROL_DATABASE_URL: str

    # Report tracker DB
    DB_USER: str
    DB_PASSWORD: str
    DB_HOST: str
    DB_PORT: str = "5432"
    DB_NAME: str

    # Azure Blob Storage
    AZURE_STORAGE_CONNECTION_STRING: str = ""
    AZURE_CONTAINER_NAME: str = "smartpal-reports"

    # SmartPAL credentials for scraper
    SMARTPAL_EMAIL: str = ""
    SMARTPAL_PASSWORD: str = ""
    SMARTPAL_BASE_URL: str = "https://smartpal.ozellar.com"

    # Cron schedule (default: 2 AM daily)
    SCRAPER_CRON_HOUR: int = 2
    SCRAPER_CRON_MINUTE: int = 0

    # AEPMS (Engine Performance) push -- after a scrape, ME/AE monthly
    # report PDFs are pushed here automatically instead of being manually
    # re-uploaded. AEPMS derives the vessel from the PDF itself, so no
    # vessel_id is sent -- only a service-account login to satisfy its
    # auth.get_current_user dependency (VESSEL-role users are rejected by
    # the upload endpoints, so this must be a SHORE/ADMIN service account).
    AEPMS_BASE_URL: str = ""
    AEPMS_SERVICE_EMAIL: str = ""
    AEPMS_SERVICE_PASSWORD: str = ""

    # Path to Excel file containing vessel/report mapping (used only to
    # regenerate DEFAULT_REPORTS_JSON_PATH offline, not read on every request)
    REPORT_EXCEL_PATH: str = "./data/reports_config.xlsx"

    # Path to the JSON snapshot of the 45 default report configs, used by the
    # "Assign 45 Defaults" action. Reading a static file (rather than parsing
    # the Excel workbook on every request) avoids re-parsing overhead/failures.
    DEFAULT_REPORTS_JSON_PATH: str = "./data/default_reports_config.json"

    # --- NETWORK / SYNC (vessel <-> shore, same pattern as Drs-backend) ---
    # URL of the shore Reports-backend to check connectivity from a vessel instance
    CLOUD_HEALTH_URL: str = "https://workplace.ozellar.com/reports/health"
    NETWORK_TIMEOUT_SECONDS: float = 3.0
    SYNC_RETRY_INTERVAL: int = 10

    CLOUD_BASE_URL: str = "https://workplace.ozellar.com/reports/api/v1"
    MAX_SYNC_RETRIES: int = 5
    SYNC_BATCH_SIZE: int = 50
    SYNC_API_KEY: str = "change-me-in-production"
    VESSEL_IMO: str = ""

    # Cloud blob account used for local (Azurite) -> cloud blob promotion
    # during sync, mirroring Drs-backend's _handle_blob_upload.
    CLOUD_STORAGE_ACCOUNT_NAME: str = "deploymentvmstorage"
    CLOUD_AZURE_CONTAINER_NAME: str = "smartpal-reports"
    AZURE_TENANT_ID: str = ""
    AZURE_CLIENT_ID: str = ""
    AZURE_CLIENT_SECRET: str = ""

    @property
    def SQLALCHEMY_DATABASE_URI(self) -> str:
        encoded_password = quote_plus(self.DB_PASSWORD)
        return f"postgresql+asyncpg://{self.DB_USER}:{encoded_password}@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}"

    @property
    def is_offline_vessel(self) -> bool:
        return self.STORAGE_MODE == StorageMode.OFFLINE

    class Config:
        env_file = os.environ.get("ENV_FILE", ".env")
        case_sensitive = True
        extra = "ignore"


settings = Settings()
print(f"--- REPORT TRACKER BACKEND STARTING ({settings.STORAGE_MODE.upper()} MODE) ---")
