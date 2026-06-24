import smbus2
import bme280
import time

# I2C Settings
port = 1
address = 0x76 # CHANGE TO 0x77 IF i2cdetect SHOWS 77!

# Initialize bus
bus = smbus2.SMBus(port)

# BME280 sensor requires loading calibration parameters directly from the chip
try:
    calibration_params = bme280.load_calibration_params(bus, address)
except Exception as e:
    print(f"Error communicating with sensor: {e}")
    exit()

print("Measurement started... (Stop with Ctrl+C)")
print("=" * 30)

try:
    while True:
        # Read data (all at once)
        data = bme280.sample(bus, address, calibration_params)

        # Output data to terminal formatted to 2 decimal places
        print(f"Temperature: {data.temperature:.2f} °C")
        print(f"Humidity:    {data.humidity:.2f} %")
        print(f"Pressure:    {data.pressure:.2f} hPa")
        print("-" * 30)
        
        # Wait 2 seconds before next measurement
        time.sleep(2)

except KeyboardInterrupt:
    # This block catches Ctrl+C
    print("\nMeasurement ended. Goodbye!")
