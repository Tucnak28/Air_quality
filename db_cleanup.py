import sqlite3
from datetime import datetime
import os

# --- CONFIGURATION ---
DB_FILE = "air_quality.db"
MIN_INTERVAL_SECONDS = 300  # 2 minutes window

def clean_database():
    if not os.path.exists(DB_FILE):
        print(f"Error: Database file '{DB_FILE}' not found.")
        return

    print(f"Connecting to {DB_FILE}...")
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()

    # 1. Get initial count
    cursor.execute("SELECT COUNT(*) FROM readings")
    initial_count = cursor.fetchone()[0]
    print(f"Initial record count: {initial_count}")

    if initial_count == 0:
        print("Database is empty. Nothing to clean.")
        conn.close()
        return

    # 2. Fetch all IDs and Timestamps sorted by time
    # We only need ID and Timestamp to make the decision
    print("Fetching records for analysis...")
    cursor.execute("SELECT id, timestamp FROM readings ORDER BY timestamp ASC")
    rows = cursor.fetchall()

    ids_to_delete = []
    last_kept_time = None
    kept_count = 0

    print("Analyzing intervals...")

    for row in rows:
        row_id = row[0]
        timestamp_str = row[1]
        
        try:
            # Parse the timestamp string back to a datetime object
            current_time = datetime.strptime(timestamp_str, "%Y-%m-%d %H:%M:%S")
        except ValueError:
            print(f"Warning: Skipping invalid timestamp format at ID {row_id}: {timestamp_str}")
            continue

        if last_kept_time is None:
            # Always keep the very first record
            last_kept_time = current_time
            kept_count += 1
        else:
            # Calculate time difference in seconds
            delta = (current_time - last_kept_time).total_seconds()
            
            if delta < MIN_INTERVAL_SECONDS:
                # Interval is too short (e.g., 5s < 120s) -> Mark for deletion
                ids_to_delete.append(row_id)
            else:
                # Interval is sufficient -> Keep this record and update reference time
                last_kept_time = current_time
                kept_count += 1

    delete_count = len(ids_to_delete)
    print(f"Analysis complete.")
    print(f" -> Keeping: {kept_count}")
    print(f" -> Deleting: {delete_count}")

    # 3. Perform Deletion
    if delete_count > 0:
        confirm = input(f"Are you sure you want to delete {delete_count} records? (y/n): ")
        if confirm.lower() != 'y':
            print("Operation cancelled.")
            conn.close()
            return

        print("Deleting records...")
        
        # SQLite limits variables, so we delete in batches of 900
        batch_size = 900
        total_deleted = 0
        
        for i in range(0, len(ids_to_delete), batch_size):
            batch = ids_to_delete[i:i + batch_size]
            # Create a string of placeholders (?,?,?)
            placeholders = ','.join(['?'] * len(batch))
            sql = f"DELETE FROM readings WHERE id IN ({placeholders})"
            cursor.execute(sql, batch)
            total_deleted += len(batch)
            print(f"Deleted batch {i // batch_size + 1}...")

        conn.commit()
        print(f"Successfully deleted {total_deleted} records.")

        # 4. Vacuum (Optimize file size)
        print("Vacuuming database (reclaiming disk space)...")
        cursor.execute("VACUUM")
    else:
        print("Database is already optimized. No records found closer than 2 minutes.")

    # 5. Final Stats
    cursor.execute("SELECT COUNT(*) FROM readings")
    final_count = cursor.fetchone()[0]
    conn.close()

    print("-" * 30)
    print("SUMMARY")
    print(f"Before: {initial_count}")
    print(f"After:  {final_count}")
    print(f"Reduction: {round((1 - final_count/initial_count) * 100, 1)}%")
    print("-" * 30)

if __name__ == "__main__":
    clean_database()
