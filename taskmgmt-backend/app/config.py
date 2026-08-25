# app/config.py
from dotenv import load_dotenv
from pydantic_settings import BaseSettings

load_dotenv()


class Settings(BaseSettings):
    """Task Management service configuration."""
    CONTROL_DATABASE_URL: str
    TASKMGMT_DATABASE_URL: str
    APP_JWT_SECRET: str
    APP_JWT_ALGORITHM: str = "HS256"
    SECRET_KEY: str = ""
    FRONTEND_URL: str = "http://localhost:5173"

    class Config:
        env_file = ".env"
        case_sensitive = True
        extra = "ignore"


settings = Settings()
