# BreatheSensi - Air Quality Monitoring System

A lightweight, high-performance environmental dashboard designed to run on a **Raspberry Pi 4B** gateway connected to local and remote IoT sensor nodes (like **SCD41** and **ESP32 + BME280**).

---

## Features
* **Multi-Room Layout:** Sleek dark-mode dashboard with a slideable left drawer for switching between different room nodes (with mobile touch swipe gestures).
* **Unified Graph View:** A single Plotly graph with toggles (`[CO2] [Temp] [Hum] [Pressure]`) that automatically filters options depending on which sensors are active in the selected room.
* **API Downsampling:** Caps graph database responses to a maximum of 500 points (using bucket averaging) to prevent network lag and browser crashes.
* **Deadband Filter:** Value-based delta checks drop redundant data writes at the source (only writes to DB if values shift significantly or after a 15-minute heartbeat).

---

## ESP32 BME280 Node Flashing Tutorial (PlatformIO)
This tutorial guides you through configuring, compiling, and flashing your remote ESP32 BME280 sensor nodes on **Arch Linux** using the terminal.

### 1. Wiring the Hardware
Connect your BME280 sensor breakout to the ESP32 board using I2C:

| BME280 Pin | ESP32 Pin | Description |
| :--- | :--- | :--- |
| **VCC** | **3.3V** | Power (Do NOT use 5V) |
| **GND** | **GND** | Ground |
| **SCL** | **GPIO 22** | I2C Serial Clock |
| **SDA** | **GPIO 21** | I2C Serial Data |

*Note: Leave the **SDO** pin disconnected to default the sensor's I2C address to `0x76`.*

---

### 2. Configure Permissions (Arch Linux)
On Arch Linux, access to serial ports belongs to the `uucp` group. Add yourself to it:
```bash
sudo usermod -aG uucp $USER
newgrp uucp # Applies group changes to current terminal session
```

---

### 3. Connect the Board (Troubleshooting Cable)
Plug your ESP32 into your laptop using a **USB data cable** (not a charging-only cable). 

Verify that your computer registers the chip connection:
```bash
lsusb
```
*(Look for `Silicon Labs CP210x` or `CH340` in the list).*

If the chip is detected, you should see a device node created at `/dev/ttyUSB0` or `/dev/ttyACM0`:
```bash
ls /dev/ttyUSB*
```

---

### 4. Set Configurations in Code
Open `esp32_sensor_node/src/main.cpp` in your text editor and update:
* `ssid`: Your Wi-Fi network name.
* `password`: Your Wi-Fi password.
* `serverUrl`: The static local IP of your Raspberry Pi 4B server (e.g., `http://192.168.0.172:6900/api/report`).
* `roomId`: Unique name for the room (e.g., `"bedroom"` or `"kitchen"`).

---

### 5. Flash the Firmware
Change to the PlatformIO project directory:
```bash
cd esp32_sensor_node
```

Compile and flash the code directly:
```bash
pio run --target upload --upload-port /dev/ttyUSB0
```

> [!NOTE]
> * **High Baud Verification Error:** To prevent flashing errors (`Unable to verify flash chip connection`), we lock the upload speed in `platformio.ini` to a stable `upload_speed = 115200`.
> * **Boot Loader Handshake:** If the console hangs on `Connecting.......___`, press and hold the physical **BOOT** (or **IO0**) button on your ESP32 board until the flashing progress starts, then release it.

---

### 6. Monitor Output
Read the sensor outputs, Wi-Fi connections, and server posting status directly in your terminal:
```bash
picocom -b 115200 /dev/ttyUSB0
```
*(To exit `picocom`, press `Ctrl + A` then `Ctrl + X`).*
