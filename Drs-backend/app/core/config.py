# app/core/config.py
import os
from pydantic_settings import BaseSettings
from urllib.parse import quote_plus
import logging
from enum import Enum

class StorageMode(str, Enum):
    OFFLINE = "offline"  # Vessel Deployment
    ONLINE = "online"    # Shore/Cloud Deployment

class Settings(BaseSettings):
    # --- APP INFO ---
    PROJECT_NAME: str = "Maritime DRS"
    API_V1_STR: str = "/api/v1"

    STORAGE_MODE: StorageMode = StorageMode.ONLINE 

    # --- SECURITY ---
    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7
    AZURE_TENANT_ID: str = ""
    AZURE_CLIENT_ID: str = ""
    AZURE_CLIENT_SECRET: str = ""

    # --- CONTROL PLANE ---
    CONTROL_DATABASE_URL: str 
 
    CLOUD_STORAGE_ACCOUNT_NAME: str = "deploymentvmstorage"
    # --- DATABASE ---
    DB_USER: str
    DB_PASSWORD: str
    DB_HOST: str
    DB_PORT: str
    DB_NAME: str

    # --- AZURE STORAGE ---
    AZURE_STORAGE_CONNECTION_STRING: str = ""
    AZURE_CONTAINER_NAME: str = "pdf-repository"
    # STORAGE_MODE: str = "online"

    # --- EMAIL ---
    MAIL_USERNAME: str = ""
    MAIL_PASSWORD: str = ""
    MAIL_FROM: str = ""
    MAIL_PORT: int = 587
    MAIL_SERVER: str = ""
    MAIL_FROM_NAME: str = "Maritime DRS"

    # --- NETWORK / SYNC ---
    # The URL of the Cloud Backend to check connectivity
    CLOUD_HEALTH_URL: str = "https://drs.ozellar.com/health"
    # Timeout in seconds for network checks (Maritime connections are slow, but we need fast fail)
    NETWORK_TIMEOUT_SECONDS: float = 3.0
    # How often to check network when waiting (in seconds)
    SYNC_RETRY_INTERVAL: int = 10

    # --- SYNC SETTINGS ---
    CLOUD_BASE_URL: str = "https://drs.ozellar.com/api/v1" # Base API for sync
    WORKPLACE_BASE_URL: str = "https://workplace.ozellar.com/api/v1"
    MAX_SYNC_RETRIES: int = 5
    CONFIG_SYNC_INTERVAL: int = 86400  
    SYNC_BATCH_SIZE: int = 50
    SYNC_API_KEY: str = "change-me-in-production"
    VESSEL_IMO: str = ""

    # Local storage path (where Azurite/Local files are stored)
    LOCAL_STORAGE_PATH: str = "./storage/blobs"

    @property
    def SQLALCHEMY_DATABASE_URI(self) -> str:
        encoded_password = quote_plus(self.DB_PASSWORD)
        return f"postgresql+asyncpg://{self.DB_USER}:{encoded_password}@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}"

    @property
    def is_offline_vessel(self) -> bool:
        return self.STORAGE_MODE == StorageMode.OFFLINE

    class Config:
        # ✅ FIXED: Respect the ENV_FILE environment variable.
        # If not set, fall back to ".env"
        env_file = os.environ.get("ENV_FILE", ".env")
        case_sensitive = True
        extra = "ignore"


settings = Settings()
print(f"--- SYSTEM STARTING IN {settings.STORAGE_MODE.upper()} MODE ---")