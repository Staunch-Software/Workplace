import asyncio
import asyncpg

CANDIDATES = [
    # (db, user, pw)
    ("orb_platform", "postgres", "sujil123"),
    ("orb_platform", "postgres", "postgres123"),
    ("orb_platform", "postgres", "maritime123"),
    ("orb_platform", "postgres", "root"),
    ("orb_platform", "postgres", "postgres"),
    ("workplace_orb", "postgres", "maritime123"),
    ("workplace_orb", "postgres", "sujil123"),
    ("workplace_orb", "postgres", "postgres123"),
]

async def clean():
    conn = None
    for db, user, pw in CANDIDATES:
        try:
            conn = await asyncpg.connect(f"postgresql://{user}:{pw}@localhost:5432/{db}")
            print(f"Connected to local DB: {db} (user: {user})")
            break
        except Exception:
            pass

    if not conn:
        print("ERROR: Could not connect to local PostgreSQL. Check password.")
        return

    # 1. Delete test alert c0ffee...
    r1 = await conn.execute("DELETE FROM orb_alerts WHERE id = 'c0ffee01-9481-6590-0000-000000000001'")
    
    # 2. Delete test threads and thread reads
    r2_tr = await conn.execute("DELETE FROM orb_alert_thread_reads WHERE alert_id = 'c0ffee01-9481-6590-0000-000000000001'")
    r2_th = await conn.execute("DELETE FROM orb_alert_threads WHERE alert_id = 'c0ffee01-9481-6590-0000-000000000001'")
    
    # 3. Delete orphaned feed events (events whose alert was deleted)
    r3 = await conn.execute("""
        DELETE FROM orb_feed_events 
        WHERE alert_id = 'c0ffee01-9481-6590-0000-000000000001' 
           OR (alert_id IS NOT NULL AND alert_id NOT IN (SELECT id FROM orb_alerts))
    """)
    
    # 4. Delete orphaned notifications
    r4 = await conn.execute("""
        DELETE FROM orb_notifications 
        WHERE alert_id = 'c0ffee01-9481-6590-0000-000000000001' 
           OR (alert_id IS NOT NULL AND alert_id NOT IN (SELECT id FROM orb_alerts))
    """)
    
    # 5. Clear failed / stuck sync_queue items
    r5 = await conn.execute("""
        DELETE FROM sync_queue 
        WHERE entity_id = 'c0ffee01-9481-6590-0000-000000000001' 
           OR (status = 'FAILED' AND error_message LIKE '%c0ffee%')
           OR (status = 'FAILED' AND error_message LIKE '%belongs to another vessel%')
    """)
    
    print("\n--- Cleanup Results ---")
    print(f"Test alerts deleted: {r1}")
    print(f"Test threads deleted: {r2_th}, thread_reads: {r2_tr}")
    print(f"Feed events deleted: {r3}")
    print(f"Notifications deleted: {r4}")
    print(f"Stuck sync queue items deleted: {r5}")
    print("------------------------\n")
    
    remaining_alerts = await conn.fetchval("SELECT count(*) FROM orb_alerts")
    remaining_feeds = await conn.fetchval("SELECT count(*) FROM orb_feed_events")
    remaining_notifs = await conn.fetchval("SELECT count(*) FROM orb_notifications")
    print(f"Vessel DB Status: Total Alerts={remaining_alerts}, Feeds={remaining_feeds}, Notifications={remaining_notifs}")
    
    await conn.close()

if __name__ == "__main__":
    asyncio.run(clean())
