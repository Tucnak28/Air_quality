import time
import sqlite3
import threading
import sys
import csv
import io
import json
import os
from flask import Flask, render_template, jsonify, request, Response
from datetime import datetime, timedelta

# --- CONFIGURATION ---
DB_FILE = "air_quality.db"
PORT = 6900
SKIP_FIRST_N = 6  # 6 cyklů * 60s = 6 minut stabilizace
DEVICE_NAMES_FILE = "device_names.json"

CONFIG = { "interval": 60 }
DEVICE_NAMES = {}
DEVICE_LAST_SEEN = {}
SENSOR_STATUS = {
    "is_warming_up": False,
    "remaining_cycles": 0,
    "remaining_seconds": 0
}

def load_device_names():
    global DEVICE_NAMES
    if os.path.exists(DEVICE_NAMES_FILE):
        try:
            with open(DEVICE_NAMES_FILE, 'r', encoding='utf-8') as f:
                DEVICE_NAMES = json.load(f)
        except Exception as e:
            print(f"Error loading device_names.json: {e}")
            DEVICE_NAMES = {}
    else:
        DEVICE_NAMES = {"living_room": "Living Room"}
        save_device_names()

def save_device_names():
    try:
        with open(DEVICE_NAMES_FILE, 'w', encoding='utf-8') as f:
            json.dump(DEVICE_NAMES, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"Error saving device_names.json: {e}")

load_device_names()

# --- SENSOR LIBRARIES IMPORT ---
try:
    from sensirion_i2c_driver import LinuxI2cTransceiver, I2cConnection
    from sensirion_i2c_scd.scd4x.device import Scd4xI2cDevice
except ImportError as e:
    # For testing without HW sensor
    print("CRITICAL WARNING: sensirion_i2c_scd library not found. SCD41 sensor will not measure locally.")
    Scd4xI2cDevice = None

# --- DATABASE AND MIGRATIONS ---
def init_db():
    with sqlite3.connect(DB_FILE) as conn:
        cursor = conn.cursor()
        # Create table with room_id and pressure (from BME280)
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS readings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp DATETIME,
                room_id TEXT DEFAULT 'living_room',
                co2 REAL,
                temp REAL,
                hum REAL,
                pressure REAL
            )
        ''')
        
        # Migration: If column 'room_id' or 'pressure' does not exist, add it
        cursor.execute("PRAGMA table_info(readings)")
        columns = [info[1] for info in cursor.fetchall()]
        
        if 'room_id' not in columns:
            print("MIGRATION: Adding column 'room_id' to readings table.")
            cursor.execute("ALTER TABLE readings ADD COLUMN room_id TEXT DEFAULT 'living_room'")
        if 'pressure' not in columns:
            print("MIGRATION: Adding column 'pressure' to readings table.")
            cursor.execute("ALTER TABLE readings ADD COLUMN pressure REAL")
            
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_room_timestamp ON readings(room_id, timestamp)')
        conn.commit()

def get_last_reading(room_id):
    with sqlite3.connect(DB_FILE) as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute('''
            SELECT timestamp, co2, temp, hum, pressure 
            FROM readings 
            WHERE room_id = ? 
            ORDER BY timestamp DESC LIMIT 1
        ''', (room_id,))
        return cursor.fetchone()

def is_sensor_warm(room_id='living_room', threshold_minutes=15):
    last = get_last_reading(room_id)
    if last is None:
        return False
    try:
        last_time = datetime.strptime(last["timestamp"], "%Y-%m-%d %H:%M:%S")
        elapsed_seconds = (datetime.now() - last_time).total_seconds()
        return elapsed_seconds < threshold_minutes * 60
    except Exception as e:
        print(f"Error evaluating sensor status: {e}")
        return False

# Deadband Filter: Returns True if the reading should be saved
def should_save_reading(room_id, co2, temp, hum, pressure=None, max_interval_minutes=15):
    last = get_last_reading(room_id)
    if last is None:
        return True  # Always save the first reading
    
    try:
        last_time = datetime.strptime(last["timestamp"], "%Y-%m-%d %H:%M:%S")
        elapsed_seconds = (datetime.now() - last_time).total_seconds()
    except Exception:
        return True
    
    # 1. Time limit (heartbeat) - if elapsed seconds is greater than max_interval_minutes, save
    if elapsed_seconds >= max_interval_minutes * 60:
        return True
        
    # 2. CO2 change (threshold 15 ppm)
    if co2 is not None and last["co2"] is not None:
        if abs(co2 - last["co2"]) >= 15:
            return True
    elif co2 is not None or last["co2"] is not None:
        return True  # State changed (e.g. CO2 data started/stopped)

    # 3. Temperature change (threshold 0.15 °C)
    if temp is not None and last["temp"] is not None:
        if abs(temp - last["temp"]) >= 0.15:
            return True
    elif temp is not None or last["temp"] is not None:
        return True

    # 4. Humidity change (threshold 1.0 %)
    if hum is not None and last["hum"] is not None:
        if abs(hum - last["hum"]) >= 1.0:
            return True
    elif hum is not None or last["hum"] is not None:
        return True

    # 5. Pressure change (threshold 0.5 hPa)
    if pressure is not None and last["pressure"] is not None:
        if abs(pressure - last["pressure"]) >= 0.5:
            return True
    elif pressure is not None or last["pressure"] is not None:
        return True

    return False  # Values are stable, do not save duplicate points

def save_reading(room_id, co2, temp, hum, pressure=None):
    with sqlite3.connect(DB_FILE) as conn:
        cursor = conn.cursor()
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        cursor.execute('''
            INSERT INTO readings (timestamp, room_id, co2, temp, hum, pressure) 
            VALUES (?, ?, ?, ?, ?, ?)
        ''', (now, room_id, co2, temp, hum, pressure))
        conn.commit()

# LTTB / Fast bucket average for downsampling (prevents chart locking)
def downsample_data(rows, max_points=500):
    total_points = len(rows)
    if total_points <= max_points:
        return rows
    
    bucket_size = total_points / max_points
    downsampled = []
    
    for i in range(max_points):
        start = int(i * bucket_size)
        end = int((i + 1) * bucket_size)
        bucket = rows[start:end]
        if not bucket:
            continue
            
        middle_row = bucket[len(bucket) // 2]
        
        # Get valid numbers for averaging
        co2s = [r["co2"] for r in bucket if r["co2"] is not None]
        temps = [r["temp"] for r in bucket if r["temp"] is not None]
        hums = [r["hum"] for r in bucket if r["hum"] is not None]
        pressures = [r["pressure"] for r in bucket if r["pressure"] is not None]
        
        avg_co2 = sum(co2s) / len(co2s) if co2s else None
        avg_temp = sum(temps) / len(temps) if temps else None
        avg_hum = sum(hums) / len(hums) if hums else None
        avg_press = sum(pressures) / len(pressures) if pressures else None
        
        downsampled.append({
            "timestamp": middle_row["timestamp"],
            "co2": avg_co2,
            "temp": avg_temp,
            "hum": avg_hum,
            "pressure": avg_press
        })
        
    return downsampled

def get_history(hours=168, room_id='living_room', max_points=500): 
    # If hours == 0, take everything (e.g. 1 year back)
    if hours == 0:
        hours = 8760
        
    with sqlite3.connect(DB_FILE) as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        time_limit = (datetime.now() - timedelta(hours=hours)).strftime("%Y-%m-%d %H:%M:%S")
        cursor.execute('''
            SELECT timestamp, co2, temp, hum, pressure 
            FROM readings 
            WHERE room_id = ? AND timestamp > ? 
            ORDER BY timestamp ASC
        ''', (room_id, time_limit))
        rows = cursor.fetchall()
        
        downsampled = downsample_data(rows, max_points)
        
        return {
            "timestamp": [r["timestamp"] for r in downsampled],
            "co2": [r["co2"] for r in downsampled],
            "temp": [r["temp"] for r in downsampled],
            "hum": [r["hum"] for r in downsampled],
            "pressure": [r["pressure"] for r in downsampled]
        }

def clear_room_history(room_id):
    with sqlite3.connect(DB_FILE) as conn:
        cursor = conn.cursor()
        cursor.execute('DELETE FROM readings WHERE room_id = ?', (room_id,))
        conn.commit()

# --- MEASUREMENT THREAD (LOCAL SCD41 SENSOR) ---
def sensor_loop():
    global SENSOR_STATUS
    if Scd4xI2cDevice is None:
        print("--- MEASUREMENT THREAD RUNNING IN SIMULATION MODE (No HW) ---")
        SENSOR_STATUS["is_warming_up"] = False
        SENSOR_STATUS["remaining_cycles"] = 0
        SENSOR_STATUS["remaining_seconds"] = 0
        # Simulator for development
        import random
        sim_co2 = 600
        sim_temp = 22.0
        sim_hum = 45.0
        while True:
            try:
                time.sleep(CONFIG["interval"])
                sim_co2 += random.randint(-40, 40)
                sim_co2 = max(400, min(2500, sim_co2))
                sim_temp += random.uniform(-0.3, 0.3)
                sim_hum += random.uniform(-1.0, 1.0)
                sim_hum = max(20, min(80, sim_hum))
                
                DEVICE_LAST_SEEN['living_room'] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                if should_save_reading('living_room', sim_co2, sim_temp, sim_hum):
                    save_reading('living_room', sim_co2, sim_temp, sim_hum)
                    print(f"[Simulator] Measured & Saved: CO2: {sim_co2:.0f} ppm | T: {sim_temp:.1f} °C | H: {sim_hum:.1f} %")
                else:
                    print(f"[Simulator] Measured (Stable, not saved): CO2: {sim_co2:.0f} ppm")
            except Exception as e:
                print(f"Simulator Error: {e}")
        return

    print("--- STARTING MEASUREMENT THREAD FOR SCD41 ---")
    
    # Decide whether to skip the warm-up phase based on the last DB entry
    if is_sensor_warm('living_room', threshold_minutes=15):
        print(">>> SCD41 sensor is likely still warm (last DB entry is newer than 15 minutes). Skipping warm-up phase. <<<")
        measurements_taken = SKIP_FIRST_N
        SENSOR_STATUS["is_warming_up"] = False
        SENSOR_STATUS["remaining_cycles"] = 0
        SENSOR_STATUS["remaining_seconds"] = 0
    else:
        print(">>> Starting full warm-up phase (6 minutes) for SCD41 sensor. <<<")
        measurements_taken = 0
        SENSOR_STATUS["is_warming_up"] = True
        SENSOR_STATUS["remaining_cycles"] = SKIP_FIRST_N
        SENSOR_STATUS["remaining_seconds"] = SKIP_FIRST_N * CONFIG["interval"]

    scd41 = None
    last_measure_time = 0

    while True:
        try:
            # Reconnect if the sensor is not currently connected
            if scd41 is None:
                try:
                    transceiver = LinuxI2cTransceiver('/dev/i2c-1')
                    scd41 = Scd4xI2cDevice(I2cConnection(transceiver))
                    scd41.stop_periodic_measurement()
                    time.sleep(1)
                    scd41.start_periodic_measurement()
                    print(">>> SCD41 SENSOR CONNECTED <<<")
                except Exception as e:
                    print(f"SENSOR CONNECTION ERROR: {e}")
                    scd41 = None
                    time.sleep(10)
                    continue

            now = time.time()
            current_interval = CONFIG["interval"]
            
            if now - last_measure_time >= current_interval:
                if scd41.get_data_ready_status():
                    data = scd41.read_measurement()
                    co2_obj, temp_obj, hum_obj = data
                    co2 = co2_obj.co2
                    temp = temp_obj.degrees_celsius
                    hum = hum_obj.percent_rh
                    
                    # Update local sensor network contact timestamp
                    DEVICE_LAST_SEEN['living_room'] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                    
                    # WARM-UP LOGIC
                    if measurements_taken < SKIP_FIRST_N:
                        measurements_taken += 1
                        remaining = SKIP_FIRST_N - measurements_taken
                        SENSOR_STATUS["is_warming_up"] = remaining > 0
                        SENSOR_STATUS["remaining_cycles"] = remaining
                        SENSOR_STATUS["remaining_seconds"] = remaining * current_interval
                        print(f"SCD41 WARM-UP ({measurements_taken}/{SKIP_FIRST_N}): CO2: {co2:.0f} | T: {temp:.1f} | H: {hum:.1f}")
                    else:
                        SENSOR_STATUS["is_warming_up"] = False
                        SENSOR_STATUS["remaining_cycles"] = 0
                        SENSOR_STATUS["remaining_seconds"] = 0
                        print(f"MEASURED SCD41: CO2: {co2:.0f} ppm | T: {temp:.1f} | H: {hum:.1f} (Int: {current_interval}s)")
                        # Use deadband filter before writing to DB
                        if should_save_reading('living_room', co2, temp, hum):
                            save_reading('living_room', co2, temp, hum)
                            print(" -> Saved to database (change threshold exceeded)")
                        else:
                            print(" -> Skipped (values are unchanged)")
                    
                    last_measure_time = now
                else:
                    time.sleep(0.5)
            else:
                time.sleep(1)
        except Exception as e:
            print(f"SCD41 SENSOR ERROR: {e}")
            scd41 = None  # Force re-connection on next iteration
            time.sleep(5)

# --- WEB SERVER ---
app = Flask(__name__, template_folder='templates', static_folder='static')

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/data')
def api_data():
    room_id = request.args.get('room', 'living_room')
    hours = float(request.args.get('hours', 168))
    
    # Dynamic downsampling based on timeframe (matching broker-style resolutions)
    if hours == 0:
        max_points = 365         # ALL: daily/weekly resolution (smooth long-term)
    elif hours <= 1.0:
        max_points = 60          # 1H: raw data (1 min intervals)
    elif hours <= 24.0:
        max_points = 144         # 1D: 10 min averages (144 points total)
    elif hours <= 168.0:
        max_points = 168         # 1W: 1 hour averages (168 points total)
    elif hours <= 720.0:
        max_points = 180         # 1M: 4 hour averages (180 points total)
    else:
        max_points = 300
        
    data = get_history(hours=hours, room_id=room_id, max_points=max_points)
    
    data["last_seen"] = DEVICE_LAST_SEEN.get(room_id)
    data["is_warming_up"] = (room_id == 'living_room' and SENSOR_STATUS["is_warming_up"])
    data["remaining_cycles"] = SENSOR_STATUS["remaining_cycles"] if room_id == 'living_room' else 0
    data["remaining_seconds"] = SENSOR_STATUS["remaining_seconds"] if room_id == 'living_room' else 0
    return jsonify(data)

# List of active rooms with their last activity timestamp
@app.route('/api/rooms')
def api_rooms():
    with sqlite3.connect(DB_FILE) as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute('SELECT room_id, MAX(timestamp) as last_seen FROM readings GROUP BY room_id')
        rows = cursor.fetchall()
    
    rooms_data = {r["room_id"]: r["last_seen"] for r in rows if r["room_id"]}
    
    # Default room must always be in the list
    if 'living_room' not in rooms_data:
        rooms_data['living_room'] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        
    result = []
    for r_id, db_last_seen in rooms_data.items():
        # Prefer the actual network contact timestamp if available
        last_seen = DEVICE_LAST_SEEN.get(r_id, db_last_seen)
        display_name = DEVICE_NAMES.get(r_id, r_id.replace('_', ' ').title())
        room_info = {
            "id": r_id,
            "name": display_name,
            "last_seen": last_seen
        }
        if r_id == 'living_room':
            room_info["is_warming_up"] = SENSOR_STATUS["is_warming_up"]
            room_info["remaining_cycles"] = SENSOR_STATUS["remaining_cycles"]
            room_info["remaining_seconds"] = SENSOR_STATUS["remaining_seconds"]
        result.append(room_info)
    return jsonify(result)

# Endpoint to rename a room
@app.route('/api/rename', methods=['POST'])
def api_rename():
    data = request.json
    if not data or 'id' not in data or 'name' not in data:
        return jsonify({"error": "Missing 'id' or 'name' in request."}), 400
        
    device_id = data['id']
    new_name = data['name']
    
    DEVICE_NAMES[device_id] = new_name
    save_device_names()
    print(f"Device '{device_id}' renamed to '{new_name}'")
    return jsonify({"status": "success"})

# --- UNIVERSAL CONNECTOR FOR DEVICES (ESP32 etc.) ---
@app.route('/api/report', methods=['POST'])
def api_report():
    data = request.json
    if not data or 'room_id' not in data:
        return jsonify({"error": "Missing 'room_id' in request payload."}), 400
        
    room_id = data['room_id']
    DEVICE_LAST_SEEN[room_id] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    co2 = data.get('co2')
    temp = data.get('temp')
    hum = data.get('hum')
    pressure = data.get('pressure')
    
    try:
        co2 = float(co2) if co2 is not None else None
        temp = float(temp) if temp is not None else None
        hum = float(hum) if hum is not None else None
        pressure = float(pressure) if pressure is not None else None
    except ValueError:
        return jsonify({"error": "Invalid format of numerical values."}), 400
        
    # Apply change filter (deadband)
    if should_save_reading(room_id, co2, temp, hum, pressure):
        save_reading(room_id, co2, temp, hum, pressure)
        return jsonify({"status": "saved", "message": "Reading was saved."})
    else:
        return jsonify({"status": "skipped", "message": "Reading skipped (change is below threshold)."})

# --- CSV EXPORT (FOR SPECIFIC ROOM) ---
@app.route('/api/export')
def api_export():
    room_id = request.args.get('room', 'living_room')
    with sqlite3.connect(DB_FILE) as conn:
        cursor = conn.cursor()
        cursor.execute('''
            SELECT timestamp, co2, temp, hum, pressure 
            FROM readings 
            WHERE room_id = ? 
            ORDER BY timestamp ASC
        ''', (room_id,))
        rows = cursor.fetchall()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(['Timestamp', 'CO2 (ppm)', 'Temperature (C)', 'Humidity (%)', 'Pressure (hPa)'])
    writer.writerows(rows)
    
    return Response(
        output.getvalue(),
        mimetype="text/csv",
        headers={"Content-Disposition": f"attachment;filename=air_quality_{room_id}.csv"}
    )

@app.route('/api/settings', methods=['GET', 'POST'])
def api_settings():
    if request.method == 'POST':
        data = request.json
        if 'interval' in data:
            new_interval = int(data['interval'])
            if 5 <= new_interval <= 3600:
                CONFIG["interval"] = new_interval
                print(f"Measurement interval changed to: {new_interval}s")
    return jsonify(CONFIG)

@app.route('/api/reset', methods=['POST'])
def api_reset():
    room_id = request.args.get('room', 'living_room')
    clear_room_history(room_id)
    
    # Remove custom name from device_names.json (if exists)
    if room_id in DEVICE_NAMES:
        del DEVICE_NAMES[room_id]
        save_device_names()
        print(f"Alias for device '{room_id}' was deleted.")
        
    return jsonify({"status": "cleared", "room": room_id})

if __name__ == "__main__":
    init_db()
    t = threading.Thread(target=sensor_loop)
    t.daemon = True
    t.start()
    print(f"WEB SERVER RUNNING ON http://0.0.0.0:{PORT}")
    app.run(host='0.0.0.0', port=PORT, debug=False)
