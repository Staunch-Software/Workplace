from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    PROJECT_NAME: str = "Workplace Platform"
    CONTROL_DATABASE_URL: str
    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 10080  # 7 days — matches DRS
    SYNC_API_KEY: str = "change-me-in-env"  # ← ADD
    AZURE_TENANT_ID: str = ""
    AZURE_CLIENT_ID: str = ""
    AZURE_CLIENT_SECRET: str = ""
    MAIL_SENDER: str = "defect.reporting@ozellar.com"
    PLATFORM_URL: str = "https://workplace.ozellar.com"
    
    class Config:
        env_file = ".env"
        extra = "ignore"

settings = Settings()