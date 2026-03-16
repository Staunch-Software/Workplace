# core/config.py
from pydantic_settings import BaseSettings
from urllib.parse import quote_plus


class Settings(BaseSettings):
    # Database
    DB_USER: str
    DB_PASSWORD: str
    DB_HOST: str = "localhost"
    DB_PORT: str = "5432"
    DB_NAME: str

    # Security
    JWT_SECRET: str
    JWT_EXPIRE_MINUTES: int = 480

    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    
    # Control Plane DB
    CONTROL_DATABASE_URL: str
    
    # Jira
    JIRA_BASE_URL: str = "https://mariapps.atlassian.net"
    JIRA_EMAIL: str = ""
    JIRA_PASSWORD: str = ""
    JIRA_PROJECT_KEY: str = "OZLR"
    JIRA_COOKIES_PATH: str = "C:/tmp/jira-cookies.json"
    JIRA_SCREENSHOT_DIR: str = "C:/tmp"

    # Azure Blob Storage
    AZURE_STORAGE_CONNECTION_STRING: str = ""
    AZURE_CONTAINER_NAME: str = "ozellar-attachments"

    # Offline / Online Sync
    STORAGE_MODE: str = "online"
    SYNC_API_KEY: str = ""
    SHORE_URL: str = ""
    VESSEL_NAME: str = ""

    CLOUD_BASE_URL: str = ""           # e.g. https://jira.ozellar.com/api/jira
    WORKPLACE_BASE_URL: str = ""       # e.g. https://workplace.ozellar.com/api/v1
    VESSEL_IMO: str = ""               # e.g. 9481659
    CLOUD_HEALTH_URL: str = ""         # e.g. https://jira.ozellar.com/
    NETWORK_TIMEOUT_SECONDS: int = 10
    SYNC_RETRY_INTERVAL: int = 30
    MAX_SYNC_RETRIES: int = 5
    SYNC_BATCH_SIZE: int = 20
    CONFIG_SYNC_INTERVAL: int = 86400  # 24h in seconds
    
    @property
    def SQLALCHEMY_DATABASE_URI(self) -> str:
        encoded_password = quote_plus(self.DB_PASSWORD)
        return (
            f"postgresql+asyncpg://{self.DB_USER}:{encoded_password}"
            f"@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}"
        )

    @property
    def is_offline_vessel(self) -> bool:
        return self.STORAGE_MODE == "offline"

    @property
    def is_online_shore(self) -> bool:
        return self.STORAGE_MODE == "online"

    class Config:
        env_file = ".env"
        case_sensitive = True
        extra = "ignore"


settings = Settings()