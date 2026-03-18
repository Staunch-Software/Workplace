#!/usr/bin/env python3
"""
AEPMS SQLAlchemy Database Test
============================
Test SQLAlchemy setup with PostgreSQL
"""

import sys
from pathlib import Path
from datetime import date, datetime

# Add current directory to path
sys.path.append(str(Path(__file__).parent))

def test_sqlalchemy_setup():
    """Test SQLAlchemy database setup"""
    try:
        print("🔗 Testing SQLAlchemy database connection...")
        
        from database import test_connection, create_all_tables, get_db
        from models import VesselInfo, ShopTrialSession, MonthlyReportHeader
        
        # Test connection
        if not test_connection():
            print("❌ Database connection failed!")
            return False
        
        print("✅ Database connection successful!")
        
        # Create all tables
        print("\n🏗️  Creating database tables...")
        if not create_all_tables():
            print("❌ Failed to create tables!")
            return False
        
        print("✅ All tables created successfully!")
        
        # Test basic CRUD operations
        print("\n🧪 Testing CRUD operations...")
        db = get_db()
        
        try:
            # Test 1: Create a vessel
            vessel = VesselInfo(
                vessel_name="MV Test Vessel SQLAlchemy",
                imo_number="IMO7654321",
                engine_no="TEST_SQLA_001",
                hull_no="HULL_SQLA_001",
                owner="Test Maritime Ltd.",
                engine_maker="MAN Energy Solutions",
                engine_type="ME-GI",
                engine_model="6G70ME-C10.5-GI",
                number_of_cylinders=6,
                mcr_power_kw=16800.0,
                mcr_rpm=76.0,
                sfoc_target_gm_kwh=165.0
            )
            
            db.add(vessel)
            db.commit()
            db.refresh(vessel)
            print(f"✅ Vessel created: ID={vessel.vessel_id}, Engine={vessel.engine_no}")
            
            # Test 2: Create shop trial session
            session = ShopTrialSession(
                engine_no=vessel.engine_no,
                trial_date=date.today(),
                trial_type="SHOP_TRIAL",
                conducted_by="Test Engineer SQLAlchemy",
                document_title="SQLAlchemy Test Session",
                status="COMPLETED"
            )
            
            db.add(session)
            db.commit()
            db.refresh(session)
            print(f"✅ Shop trial session created: ID={session.session_id}")
            
            # Test 3: Create monthly report
            monthly_report = MonthlyReportHeader(
                engine_no=vessel.engine_no,
                report_month="Dec-2025",
                report_date=date.today(),
                load_percent=78.5,
                shaft_power_kw=13200.0,
                measured_by="Test Measurer SQLAlchemy",
                chief_engineer_name="Chief SQLAlchemy Engineer"
            )
            
            db.add(monthly_report)
            db.commit()
            db.refresh(monthly_report)
            print(f"✅ Monthly report created: ID={monthly_report.report_id}")
            
            # Test 4: Query data with relationships
            print("\n🔍 Testing queries with relationships...")
            
            # Get vessel with related data
            vessel_with_data = db.query(VesselInfo).filter(
                VesselInfo.engine_no == vessel.engine_no
            ).first()
            
            if vessel_with_data:
                print(f"📋 Vessel: {vessel_with_data.vessel_name}")
                print(f"   Shop Trials: {len(vessel_with_data.shop_trial_sessions)}")
                print(f"   Monthly Reports: {len(vessel_with_data.monthly_reports)}")
            
            # Test 5: Clean up test data
            print("\n🧹 Cleaning up test data...")
            db.delete(vessel)  # Cascading deletes will remove related records
            db.commit()
            print("✅ Test data cleaned up")
            
            return True
            
        except Exception as e:
            db.rollback()
            print(f"❌ CRUD operations failed: {e}")
            return False
        
        finally:
            db.close()
            
    except ImportError as e:
        print(f"❌ Import error: {e}")
        print("Make sure you have installed SQLAlchemy: pip install sqlalchemy")
        return False
    except Exception as e:
        print(f"❌ SQLAlchemy test failed: {e}")
        return False

def show_model_info():
    """Show information about the models"""
    try:
        from models import VesselInfo, ShopTrialSession, ShopTrialPerformanceData, MonthlyReportHeader
        
        print("\n📊 AEPMS SQLAlchemy Models:")
        print("=" * 50)
        
        models = [
            VesselInfo,
            ShopTrialSession, 
            ShopTrialPerformanceData,
            MonthlyReportHeader
        ]
        
        for model in models:
            print(f"📋 {model.__name__}")
            print(f"   Table: {model.__tablename__}")
            
            # Count columns
            columns = [col.name for col in model.__table__.columns]
            print(f"   Columns ({len(columns)}): {', '.join(columns[:5])}{'...' if len(columns) > 5 else ''}")
            
            # Show relationships if any
            if hasattr(model, '__mapper__'):
                relationships = [rel.key for rel in model.__mapper__.relationships]
                if relationships:
                    print(f"   Relationships: {', '.join(relationships)}")
            print()
            
    except Exception as e:
        print(f"❌ Failed to show model info: {e}")

def main():
    """Main test function"""
    print("🚀 AEPMS SQLAlchemy Database Test")
    print("=" * 50)
    
    # Check environment first
    try:
        from dotenv import load_dotenv
        import os
        
        load_dotenv()
        
        if not os.getenv('DB_PASSWORD'):
            print("❌ DB_PASSWORD not set in .env file")
            print("Please set your database password in .env file")
            return
        
        print("✅ Environment configuration loaded")
        
    except Exception as e:
        print(f"❌ Environment check failed: {e}")
        return
    
    # Test SQLAlchemy setup
    if test_sqlalchemy_setup():
        print("\n🎉 SQLAlchemy setup test passed!")
        show_model_info()
        
        print("\n💡 Usage Examples:")
        print("# Get database session")
        print("from database import get_db")
        print("from models import VesselInfo")
        print("")
        print("# Create new vessel")
        print("db = get_db()")
        print("vessel = VesselInfo(vessel_name='My Vessel', engine_no='ENG001')")
        print("db.add(vessel)")
        print("db.commit()")
        print("")
        print("# Query vessels")
        print("vessels = db.query(VesselInfo).all()")
        print("db.close()")
        
    else:
        print("\n❌ SQLAlchemy setup test failed!")
        print("\n💡 Troubleshooting:")
        print("1. Make sure PostgreSQL is running")