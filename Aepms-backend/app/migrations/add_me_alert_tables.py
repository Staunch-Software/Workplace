"""
Database migration to add ME alert categorization tables
"""

from sqlalchemy import create_engine, text
from app.database import engine
import logging

logger = logging.getLogger(__name__)

def upgrade():
    """Create ME alert tables"""
    logger.info("Creating ME alert tables...")
    
    with engine.connect() as conn:
        # Create me_normal_status table
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS me_normal_status (
                id SERIAL PRIMARY KEY,
                report_id INTEGER NOT NULL,
                metric_name VARCHAR(100) NOT NULL,
                baseline_value FLOAT NOT NULL,
                actual_value FLOAT NOT NULL,
                deviation FLOAT NOT NULL,
                deviation_pct FLOAT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_me_normal_report_id ON me_normal_status(report_id);
        """))
        
        # Create me_warning_alert table
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS me_warning_alert (
                id SERIAL PRIMARY KEY,
                report_id INTEGER NOT NULL,
                metric_name VARCHAR(100) NOT NULL,
                baseline_value FLOAT NOT NULL,
                actual_value FLOAT NOT NULL,
                deviation FLOAT NOT NULL,
                deviation_pct FLOAT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_me_warning_report_id ON me_warning_alert(report_id);
        """))
        
        # Create me_critical_alert table
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS me_critical_alert (
                id SERIAL PRIMARY KEY,
                report_id INTEGER NOT NULL,
                metric_name VARCHAR(100) NOT NULL,
                baseline_value FLOAT NOT NULL,
                actual_value FLOAT NOT NULL,
                deviation FLOAT NOT NULL,
                deviation_pct FLOAT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_me_critical_report_id ON me_critical_alert(report_id);
        """))
        
        conn.commit()
    
    logger.info("ME alert tables created successfully")


def downgrade():
    """Drop ME alert tables"""
    logger.info("Dropping ME alert tables...")
    
    with engine.connect() as conn:
        conn.execute(text("DROP TABLE IF EXISTS me_critical_alert CASCADE;"))
        conn.execute(text("DROP TABLE IF EXISTS me_warning_alert CASCADE;"))
        conn.execute(text("DROP TABLE IF EXISTS me_normal_status CASCADE;"))
        conn.commit()
    
    logger.info("ME alert tables dropped successfully")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    upgrade()
