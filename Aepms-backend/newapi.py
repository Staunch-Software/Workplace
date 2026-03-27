from app.core.database_control import get_control_db
from sqlalchemy import text

# Getting the database session
db = next(get_control_db())

# The exact UUID for goguldev28@gmail.com from your screenshot
user_id = "4eec635a-e071-464d-bf59-2060672d84e9"

# Running the raw SQL query
query = text("SELECT vessel_imo FROM user_vessel_link WHERE user_id = CAST(:uid AS UUID)")
result = db.execute(query, {"uid": user_id}).fetchall()

# Printing the results
print("Raw DB Result:", result)
print("Cleaned IMOs:", [int(row[0]) for row in result])

# Close the session
db.close()