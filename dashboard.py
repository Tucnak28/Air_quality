import time
import sqlite3
import threading
import sys
import csv
import io
from flask import Flask, render_template, jsonify, request, Response
from datetime import datetime, timedelta

# --- KONFIGURACE ---
DB_FILE = "air_quality.db"
PORT = 6900
SKIP_FIRST_N = 6  # 6 cyklů * 60s = 6 minut stabilizace

CONFIG = { "interval": 60 }

# --- IMPORT KNIHOVEN SENSORU ---
try:
    from sensirion_i2c_driver import LinuxI2cTransceiver, I2cConnection
    from sensirion_i2c_scd.scd4x.device import Scd4xI2cDevice
except ImportError as e:
    # Pro testování bez HW senzoru
    print("CRITICAL WARNING: Knihovna sensirion_i2c_scd nenalezena. Senzor SCD41 nebude měřit lokálně.")
    Scd4xI2cDevice = None

# --- DATABÁZE A MIGRACE ---
def init_db():
    with sqlite3.connect(DB_FILE) as conn:
        cursor = conn.cursor()
        # Vytvoření tabulky s room_id a pressure (tlak z BME280)
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
        
        # Migrace: Pokud sloupec 'room_id' nebo 'pressure' neexistuje (např. stará DB), přidáme jej
        cursor.execute("PRAGMA table_info(readings)")
        columns = [info[1] for info in cursor.fetchall()]
        
        if 'room_id' not in columns:
            print("MIGRACE: Přidávám sloupec 'room_id' do tabulky readings.")
            cursor.execute("ALTER TABLE readings ADD COLUMN room_id TEXT DEFAULT 'living_room'")
        if 'pressure' not in columns:
            print("MIGRACE: Přidávám sloupec 'pressure' do tabulky readings.")
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

# Deadband Filter: Vrací True, pokud by se hodnota měla uložit
def should_save_reading(room_id, co2, temp, hum, pressure=None, max_interval_minutes=15):
    last = get_last_reading(room_id)
    if last is None:
        return True  # První záznam vždy uložit
    
    try:
        last_time = datetime.strptime(last["timestamp"], "%Y-%m-%d %H:%M:%S")
        elapsed_seconds = (datetime.now() - last_time).total_seconds()
    except Exception:
        return True
    
    # 1. Časový limit (heartbeat) - pokud uběhlo více než max_interval_minutes, uložíme
    if elapsed_seconds >= max_interval_minutes * 60:
        return True
        
    # 2. Změna CO2 (práh 15 ppm)
    if co2 is not None and last["co2"] is not None:
        if abs(co2 - last["co2"]) >= 15:
            return True
    elif co2 is not None or last["co2"] is not None:
        return True  # Stav se změnil (např. začal/skončil sběr CO2)

    # 3. Změna teploty (práh 0.15 °C)
    if temp is not None and last["temp"] is not None:
        if abs(temp - last["temp"]) >= 0.15:
            return True
    elif temp is not None or last["temp"] is not None:
        return True

    # 4. Změna vlhkosti (práh 1.0 %)
    if hum is not None and last["hum"] is not None:
        if abs(hum - last["hum"]) >= 1.0:
            return True
    elif hum is not None or last["hum"] is not None:
        return True

    # 5. Změna tlaku (práh 0.5 hPa)
    if pressure is not None and last["pressure"] is not None:
        if abs(pressure - last["pressure"]) >= 0.5:
            return True
    elif pressure is not None or last["pressure"] is not None:
        return True

    return False  # Hodnoty jsou stabilní, neukládáme duplicitní body

def save_reading(room_id, co2, temp, hum, pressure=None):
    with sqlite3.connect(DB_FILE) as conn:
        cursor = conn.cursor()
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        cursor.execute('''
            INSERT INTO readings (timestamp, room_id, co2, temp, hum, pressure) 
            VALUES (?, ?, ?, ?, ?, ?)
        ''', (now, room_id, co2, temp, hum, pressure))
        conn.commit()

# LTTB / Rychlý kbelíkový průměr pro downsampling (zabraňuje zasekávání grafu)
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
        
        # Získání platných čísel pro průměrování
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
    # Pokud hours == 0, vezmeme vše (např. 1 rok zpětně)
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

# --- MĚŘÍCÍ VLÁKNO (LOKÁLNÍ SENZOR SCD41) ---
def sensor_loop():
    if Scd4xI2cDevice is None:
        print("--- MĚŘÍCÍ VLÁKNO SPUŠTĚNO V SIMULAČNÍM MÓDU (Chybí HW) ---")
        # Simulátor pro vývoj
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
                
                if should_save_reading('living_room', sim_co2, sim_temp, sim_hum):
                    save_reading('living_room', sim_co2, sim_temp, sim_hum)
                    print(f"[Simulátor] Měřeno & Uloženo: CO2: {sim_co2:.0f} ppm | T: {sim_temp:.1f} °C | H: {sim_hum:.1f} %")
                else:
                    print(f"[Simulátor] Změřeno (Stabilní, neuloženo): CO2: {sim_co2:.0f} ppm")
            except Exception as e:
                print(f"Simulátor Chyba: {e}")
        return

    print("--- STARTUJI MĚŘÍCÍ VLÁKNO PRO SCD41 ---")
    measurements_taken = 0
    scd41 = None
    last_measure_time = 0

    while scd41 is None:
        try:
            transceiver = LinuxI2cTransceiver('/dev/i2c-1')
            scd41 = Scd4xI2cDevice(I2cConnection(transceiver))
            scd41.stop_periodic_measurement()
            time.sleep(1)
            scd41.start_periodic_measurement()
            print(">>> SENZOR SCD41 PŘIPOJEN <<<")
        except Exception as e:
            print(f"CHYBA PŘIPOJENÍ SENZORU: {e}")
            time.sleep(10)

    while True:
        try:
            now = time.time()
            current_interval = CONFIG["interval"]
            
            if now - last_measure_time >= current_interval:
                if scd41.get_data_ready_status():
                    data = scd41.read_measurement()
                    co2_obj, temp_obj, hum_obj = data
                    co2 = co2_obj.co2
                    temp = temp_obj.degrees_celsius
                    hum = hum_obj.percent_rh
                    
                    # LOGIKA ZAHŘÍVÁNÍ
                    if measurements_taken < SKIP_FIRST_N:
                        measurements_taken += 1
                        print(f"ZAHŘÍVÁNÍ SCD41 ({measurements_taken}/{SKIP_FIRST_N}): CO2: {co2:.0f} | T: {temp:.1f} | H: {hum:.1f}")
                    else:
                        print(f"MĚŘENO SCD41: CO2: {co2:.0f} ppm | T: {temp:.1f} | H: {hum:.1f} (Int: {current_interval}s)")
                        # Použijeme deadband filtr před zápisem do DB
                        if should_save_reading('living_room', co2, temp, hum):
                            save_reading('living_room', co2, temp, hum)
                            print(" -> Zapsáno do databáze (překročen práh změn)")
                        else:
                            print(" -> Přeskočeno (hodnoty jsou beze změny)")
                    
                    last_measure_time = now
                else:
                    time.sleep(0.5)
            else:
                time.sleep(1)
        except Exception as e:
            print(f"CHYBA SENZORU SCD41: {e}")
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
    # Načteme historii s downsamplingem na max 500 bodů
    return jsonify(get_history(hours=hours, room_id=room_id, max_points=500))

# Seznam aktivních místností
@app.route('/api/rooms')
def api_rooms():
    with sqlite3.connect(DB_FILE) as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT DISTINCT room_id FROM readings')
        rooms = [r[0] for r in cursor.fetchall() if r[0]]
    
    # Výchozí místnost musí být vždy v seznamu
    if 'living_room' not in rooms:
        rooms.insert(0, 'living_room')
    return jsonify(rooms)

# --- UNIVERZÁLNÍ KONEKTOR PRO ZAŘÍZENÍ (ESP32 atd.) ---
@app.route('/api/report', methods=['POST'])
def api_report():
    data = request.json
    if not data or 'room_id' not in data:
        return jsonify({"error": "Chybí 'room_id' ve zprávě."}), 400
        
    room_id = data['room_id']
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
        return jsonify({"error": "Neplatný formát číselných hodnot."}), 400
        
    # Uplatnění filtru změn (deadband)
    if should_save_reading(room_id, co2, temp, hum, pressure):
        save_reading(room_id, co2, temp, hum, pressure)
        return jsonify({"status": "saved", "message": "Záznam byl uložen."})
    else:
        return jsonify({"status": "skipped", "message": "Záznam přeskočen (změna je pod prahem citlivosti)."})

# --- CSV EXPORT (PRO KONKRÉTNÍ MÍSTNOST) ---
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
                print(f"Interval měření změněn na: {new_interval}s")
    return jsonify(CONFIG)

@app.route('/api/reset', methods=['POST'])
def api_reset():
    room_id = request.args.get('room', 'living_room')
    clear_room_history(room_id)
    return jsonify({"status": "cleared", "room": room_id})

if __name__ == "__main__":
    init_db()
    t = threading.Thread(target=sensor_loop)
    t.daemon = True
    t.start()
    print(f"WEB SERVER RUNNING ON http://0.0.0.0:{PORT}")
    app.run(host='0.0.0.0', port=PORT, debug=False)
