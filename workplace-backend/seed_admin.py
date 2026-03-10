import asyncio
from app.core.database_control import AsyncSessionControl
from app.core.security import hash_password
from app.models.control.user import User

async def main():
    async with AsyncSessionControl() as db:
        admin = User(
            full_name="Super Admin",
            email="admin@workplace.com",
            password_hash=hash_password("admin123"),
            role="ADMIN",
            is_active=True,
            permissions={"drs": True, "jira": True, "voyage": True, "lubeoil": True, "engine_performance": True},
        )
        db.add(admin)
        await db.commit()
        print("Admin seeded.")

asyncio.run(main())