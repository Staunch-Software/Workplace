"""
Database connection and session management for ship engine performance monitoring.
"""

import os
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, declarative_base
from sqlalchemy.exc import SQLAlchemyError
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Base class for ORM models
Base = declarative_base()

class DatabaseManager:
    """Manages database connections and sessions."""
    
    def __init__(self, database_url=None):
        """
        Initialize database manager.
        
        Args:
            database_url (str): PostgreSQL connection URL
                Format: postgresql://user:password@host:port/database
        """
        if database_url is None:
            # Default connection from environment variables
            database_url = self._build_url_from_env()
        
        self.database_url = database_url
        self.engine = None
        self.SessionLocal = None
        self._initialize_engine()
    
    def _build_url_from_env(self):
        """Build database URL from environment variables."""
        user = os.getenv('DB_USER', 'postgres')
        password = os.getenv('DB_PASSWORD', 'password')
        host = os.getenv('DB_HOST', 'localhost')
        port = os.getenv('DB_PORT', '5432')
        database = os.getenv('DB_NAME', 'ship_performance')
        
        return f"postgresql://{user}:{password}@{host}:{port}/{database}"
    
    def _initialize_engine(self):
        """Initialize SQLAlchemy engine and session factory."""
        try:
            self.engine = create_engine(
                self.database_url,
                pool_pre_ping=True,
                pool_recycle=300,
                echo=False  # Set to True for SQL debugging
            )
            
            self.SessionLocal = sessionmaker(
                autocommit=False,
                autoflush=False,
                bind=self.engine
            )
            
            logger.info("Database engine initialized successfully")
            
        except Exception as e:
            logger.error(f"Failed to initialize database engine: {e}")
            raise
    
    def create_tables(self):
        """Create all database tables."""
        try:
            from models import Base
            Base.metadata.create_all(bind=self.engine)
            logger.info("Database tables created successfully")
        except Exception as e:
            logger.error(f"Failed to create database tables: {e}")
            raise
    
    def get_session(self):
        """Get a new database session."""
        return self.SessionLocal()
    
    def test_connection(self):
        """Test database connection."""
        try:
            with self.engine.connect() as conn:
                result = conn.execute(text("SELECT version()"))
                version = result.fetchone()[0]
                logger.info(f"Database connection successful. PostgreSQL version: {version}")
                return True
        except Exception as e:
            logger.error(f"Database connection failed: {e}")
            return False
    
    def close(self):
        """Close database engine."""
        if self.engine:
            self.engine.dispose()
            logger.info("Database engine closed")

# Global database manager instance
db_manager = DatabaseManager()

def get_db_session():
    """
    Get a database session with automatic cleanup.
    Use as context manager: with get_db_session() as session:
    """
    class SessionManager:
        def __enter__(self):
            self.session = db_manager.get_session()
            return self.session
        
        def __exit__(self, exc_type, exc_val, exc_tb):
            if exc_type is not None:
                self.session.rollback()
            else:
                self.session.commit()
            self.session.close()
    
    return SessionManager()

def init_database(database_url=None, create_tables=True):
    """
    Initialize database with optional table creation.
    
    Args:
        database_url (str): PostgreSQL connection URL
        create_tables (bool): Whether to create tables
    
    Returns:
        bool: True if successful
    """
    global db_manager
    
    try:
        if database_url:
            db_manager = DatabaseManager(database_url)
        
        # Test connection
        if not db_manager.test_connection():
            return False
        
        # Create tables if requested
        if create_tables:
            db_manager.create_tables()
        
        return True
        
    except Exception as e:
        logger.error(f"Database initialization failed: {e}")
        return False

def execute_sql_file(sql_file_path):
    """Execute SQL commands from a file."""
    try:
        with open(sql_file_path, 'r', encoding='utf-8') as file:
            sql_commands = file.read()
        
        with db_manager.engine.connect() as conn:
            # Split and execute each command
            commands = [cmd.strip() for cmd in sql_commands.split(';') if cmd.strip()]
            
            for command in commands:
                if command:
                    conn.execute(text(command))
                    conn.commit()
        
        logger.info(f"SQL file executed successfully: {sql_file_path}")
        return True
        
    except Exception as e:
        logger.error(f"Failed to execute SQL file {sql_file_path}: {e}")
        return False