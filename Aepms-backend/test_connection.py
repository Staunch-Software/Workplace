#!/usr/bin/env python3
"""
Simple AEPMS Database Connection Test
===================================
Tests basic database connection and setup.
"""

import sys
from pathlib import Path

# Add current directory to path
sys.path.append(str(Path(__file__).parent))

def test_env_file():
    """Check if .env file exists and has required settings"""
    from dotenv import load_dotenv
    import os
    
    load_dotenv()
    
    print("🔧 Checking .env configuration...")
    
    required_vars = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD']
    missing = []
    
    for var in required_vars:
        value = os.getenv(var)
        if var == 'DB_PASSWORD':
            print(f"   {var}: {'***SET***' if value else '❌ MISSING'}")
        else:
            print(f"   {var}: {value or '❌ MISSING'}")
        
        if not value:
            missing.append(var)
    
    if missing:
        print(f"❌ Missing variables: {', '.join(missing)}")
        return False
    
    print("✅ .env file configuration looks good")
    return True

def test_database():
    """Test database connection and setup"""
    try:
        from database import test_connection, initialize_database, execute_query
        
        print("\n🔗 Testing database connection...")
        if not test_connection():
            print("❌ Database connection failed!")
            return False
        
        print("✅ Database connection successful!")
        
        print("\n🏗️  Initializing database schema...")
        if not initialize_database():
            print("❌ Schema initialization failed!")
            return False
        
        print("✅ Schema initialized successfully!")
        
        print("\n📊 Checking tables...")
        tables = execute_query("""
            SELECT table_name FROM information_schema.tables 
            WHERE table_schema = 'public' ORDER BY table_name;
        """, fetch=True)
        
        if tables:
            print(f"✅ Found {len(tables)} tables:")
            for table in tables:
                print(f"   - {table['table_name']}")
        else:
            print("❌ No tables found!")
            return False
        
        return True
        
    except ImportError as e:
        print(f"❌ Import error: {e}")
        print("Make sure you have installed: pip install psycopg2-binary python-dotenv")
        return False
    except Exception as e:
        print(f"❌ Database test failed: {e}")
        return False

def main():
    """Main test function"""
    print("🚀 AEPMS Database Setup Test")
    print("=" * 40)
    
    # Test 1: Environment file
    if not test_env_file():
        print("\n💡 Fix your .env file first:")
        print("1. Create .env file in your project root")
        print("2. Add database configuration:")
        print("   DB_HOST=localhost")
        print("   DB_PORT=5432")
        print("   DB_NAME=aepms_db")
        print("   DB_USER=aepms_Deepa")
        print("   DB_PASSWORD=your_actual_password")
        return
    
    # Test 2: Database connection
    if not test_database():
        print("\n💡 Troubleshooting:")
        print("1. Make sure PostgreSQL is running")
        print("2. Check database name 'aepms_db' exists")
        print("3. Check user 'aepms_Deepa' exists and has permissions")
        print("4. Verify password is correct")
        return
    
    print("\n🎉 All tests passed! Your AEPMS database is ready!")
    print("\n📝 Next steps:")
    print("1. You can now use the database in your application")
    print("2. Import with: from database import db, execute_query")
    print("3. Test queries with execute_query() function")

if __name__ == "__main__":
    main()