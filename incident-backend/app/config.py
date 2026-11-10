from functools import lru_cache
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

_ENV_FILE = Path(__file__).resolve().parent.parent / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=_ENV_FILE, env_file_encoding="utf-8", extra="ignore")

    DATABASE_URL: str
    # Workplace control database: users, vessels and permissions live here (read-only for this service).
    CONTROL_DATABASE_URL: str = ""
    # Must match workplace-backend: tokens are issued there and only verified here.
    SECRET_KEY: str = ""
    ALGORITHM: str = "HS256"
    CORS_ORIGINS: str = "http://localhost:5173"

    # Where evidence files and chat attachments are kept: "blob" (Azure Blob, like DRS/ORB; the default) or
    # "local" (a folder under UPLOAD_DIR, for a throwaway dev machine only). In blob mode an upload is refused when
    # no connection string is set, rather than quietly falling back to the local disk.
    FILE_STORAGE: str = "blob"
    UPLOAD_DIR: str = "uploads"
    MAX_FILE_MB: int = 25
    MAX_CHAT_ATTACHMENT_MB: int = 10

    # Same storage account as DRS / ORB (or Azurite locally: UseDevelopmentStorage=true). Wrap it in double quotes in .env.
    AZURE_STORAGE_CONNECTION_STRING: str = ""
    AZURE_STORAGE_INCIDENT_CONTAINER: str = "incident-files"
    AZURE_STORAGE_INCIDENT_CHAT_CONTAINER: str = "incident-chat"

    @property
    def use_blob(self) -> bool:
        return self.FILE_STORAGE.strip().lower() != "local"

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
