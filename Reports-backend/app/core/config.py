# app/core/config.py
import os
from pydantic_settings import BaseSettings
from urllib.parse import quote_plus


class Settings(BaseSettings):
    PROJECT_NAME: str = "SmartPAL Report Tracker"
    API_V1_STR: str = "/api/v1"

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

    # Path to Excel file containing vessel/report mapping (used only to
    # regenerate DEFAULT_REPORTS_JSON_PATH offline, not read on every request)
    REPORT_EXCEL_PATH: str = "./data/reports_config.xlsx"

    # Path to the JSON snapshot of the 45 default report configs, used by the
    # "Assign 45 Defaults" action. Reading a static file (rather than parsing
    # the Excel workbook on every request) avoids re-parsing overhead/failures.
    DEFAULT_REPORTS_JSON_PATH: str = "./data/default_reports_config.json"

    @property
    def SQLALCHEMY_DATABASE_URI(self) -> str:
        encoded_password = quote_plus(self.DB_PASSWORD)
        return f"postgresql+asyncpg://{self.DB_USER}:{encoded_password}@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}"

    class Config:
        env_file = os.environ.get("ENV_FILE", ".env")
        case_sensitive = True
        extra = "ignore"


settings = Settings()
print("--- REPORT TRACKER BACKEND STARTING (SHORE MODE) ---")
