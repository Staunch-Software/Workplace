from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase
from decouple import config

CONTROL_DATABASE_URL = config("CONTROL_DATABASE_URL")

engine_control = create_engine(CONTROL_DATABASE_URL, echo=False, pool_pre_ping=True)
SessionControl = sessionmaker(bind=engine_control, autocommit=False, autoflush=False)

class ControlBase(DeclarativeBase):
    pass

def get_control_db():
    db = SessionControl()
    try:
        yield db
    finally:
        db.close()