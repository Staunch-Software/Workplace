import asyncio
import sys
from app.database import engine, Base  
try:
    import app.luboil_model
    # If your models are spread across multiple files, import them all here:
    # import app.models.luboil_reports
    # import app.models.luboil_samples
except ImportError as e:
    print(f"❌ Error importing models: {e}")
    sys.exit(1)

async def create_luboil_tables():
    print("⏳ Creating Luboil Analysis database tables...")
    
    try:
        async with engine.begin() as conn:
            # This line looks at Base.metadata and creates tables for 
            # every class that inherits from Base and has been imported.
            await conn.run_sync(Base.metadata.create_all)
        print("✅ Luboil Tables created successfully!")
    except Exception as e:
        print(f"❌ Failed to create tables: {e}")

if __name__ == "__main__":
    asyncio.run(create_luboil_tables())