import smbus2
import bme280
import time

# Nastavení I2C
port = 1
address = 0x76 # ZMĚŇ NA 0x77, POKUD TI i2cdetect UKÁZAL 77!

# Inicializace sběrnice
bus = smbus2.SMBus(port)

# Senzor BME280 vyžaduje načtení kalibračních dat přímo z jeho čipu
try:
    calibration_params = bme280.load_calibration_params(bus, address)
except Exception as e:
    print(f"Chyba při komunikaci se senzorem: {e}")
    exit()

print("Měření spuštěno... (Zastavíš pomocí Ctrl+C)")
print("=" * 30)

try:
    while True:
        # Přečtení dat (vše najednou)
        data = bme280.sample(bus, address, calibration_params)

        # Výpis dat do terminálu s formátováním na 2 desetinná místa
        print(f"Teplota: {data.temperature:.2f} °C")
        print(f"Vlhkost: {data.humidity:.2f} %")
        print(f"Tlak:    {data.pressure:.2f} hPa")
        print("-" * 30)
        
        # Program počká 2 sekundy, než změří další hodnoty
        time.sleep(2)

except KeyboardInterrupt:
    # Tento blok zachytí, když zmáčkneš Ctrl+C
    print("\nKonec měření. Měj se!")
