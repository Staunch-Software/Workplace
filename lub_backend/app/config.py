
# config.py
import os
from dotenv import load_dotenv
from pathlib import Path
from pydantic_settings import BaseSettings
from urllib.parse import quote_plus
from decouple import config

# Load environment variables
load_dotenv()

class DatabaseConfig:
    """Database configuration"""
    HOST = os.getenv('DB_HOST', 'localhost')
    PORT = int(os.getenv('DB_PORT', '5432'))
    NAME = os.getenv('DB_NAME', 'aepms_db')
    USER = os.getenv('DB_USER', 'aepms_deepa_login')
    PASSWORD = os.getenv('DB_PASSWORD')
    
    @classmethod
    def get_connection_params(cls):
        """Get database connection parameters"""
        return {
            'host': cls.HOST,
            'port': cls.PORT,
            'database': cls.NAME,
            'user': cls.USER,
            'password': cls.PASSWORD
        }

class AppConfig:
    """Application configuration"""
    DEBUG = os.getenv('DEBUG', 'True').lower() == 'true'
    SECRET_KEY = os.getenv('SECRET_KEY', 'aepms_secret_key_2024')
    LOG_LEVEL = os.getenv('LOG_LEVEL', 'INFO')
    LOG_FILE = os.getenv('LOG_FILE', 'ship_performance.log')
    DATA_DIR = os.getenv('DATA_DIR', 'data')

# ⭐ ADD THIS NEW CLASS FOR SSO ⭐
class SSOSettings(BaseSettings):
    """SSO/Authentication configuration"""
    AZURE_CLIENT_ID: str
    AZURE_TENANT_ID: str
    AZURE_CLIENT_SECRET: str
    APP_JWT_SECRET: str
    APP_JWT_ALGORITHM: str = "HS256"
    APP_JWT_EXPIRE_MINUTES: int = 60
    FRONTEND_URL: str = "http://localhost:5173"
    SECRET_KEY: str = ""
    CONTROL_DATABASE_URL: str = ""
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 10080

    # Luboil DB
    LUBOIL_DATABASE_URL: str = ""

    # Blob Storage
    AZURE_STORAGE_CONNECTION_STRING: str = ""
    AZURE_CONTAINER_NAME: str = "pdf-repository"
    AZURITE_CONNECTION_STRING: str = ""
    IS_VESSEL_INSTANCE: bool = False

    # Sync
    SYNC_API_KEY: str = ""
    CLOUD_BASE_URL: str = "https://workplace.ozellar.com/lub/api"
    WORKPLACE_BASE_URL: str = "https://workplace.ozellar.com/api/v1"
    CLOUD_HEALTH_URL: str = "https://workplace.ozellar.com/health"
    VESSEL_IMO: str = ""
    NETWORK_TIMEOUT_SECONDS: int = 10
    SYNC_RETRY_INTERVAL: int = 30
    MAX_SYNC_RETRIES: int = 5
    SYNC_BATCH_SIZE: int = 20
    CONFIG_SYNC_INTERVAL: int = 86400

    class Config:
        env_file = ".env"
        case_sensitive = True
        extra = "ignore" 




def get_database_url(include_password: bool = True) -> str:
    """Get database URL for SQLAlchemy (handles special characters in password)."""
    password = quote_plus(db_config.PASSWORD) if include_password else "****"
    return f"postgresql+psycopg2://{db_config.USER}:{password}@{db_config.HOST}:{db_config.PORT}/{db_config.NAME}"


def ensure_data_dir() -> Path:
    """Ensure data directory exists."""
    data_path = Path("data")
    data_path.mkdir(exist_ok=True)
    return data_path

# Global config instances
db_config = DatabaseConfig()
print("Loaded DB config:", db_config.HOST, db_config.USER, db_config.NAME)
app_config = AppConfig()
settings = SSOSettings()  