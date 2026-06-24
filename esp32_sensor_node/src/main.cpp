#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <Wire.h>
#include <Adafruit_Sensor.h>
#include <Adafruit_BME280.h>
#include <ArduinoJson.h>

// --- CONFIGURATION ---
#ifndef WIFI_SSID
  #define WIFI_SSID "YOUR_WIFI_SSID"
#endif
#ifndef WIFI_PASS
  #define WIFI_PASS "YOUR_WIFI_PASSWORD"
#endif
#ifndef SERVER_URL
  #define SERVER_URL "http://192.168.1.100:6900/api/report"
#endif

const char* ssid = WIFI_SSID;
const char* password = WIFI_PASS;
const char* serverUrl = SERVER_URL;

// Unique ID generated dynamically from ESP32 MAC address
String roomIdStr;
const char* roomId;

// Time to sleep between measurements (in seconds)
const int sleepSeconds = 60; 

// I2C pins (Default for ESP32 is SDA=21, SCL=22)
#define I2C_SDA 21
#define I2C_SCL 22

Adafruit_BME280 bme; // I2C sensor instance

// Function prototypes
void connectWiFi();
void readAndPostData();
void goToSleep();

void setup() {
  Serial.begin(115200);
  delay(100);
  Serial.println("\n--- ESP32 Air Quality Node starting ---");

  // 0. Auto-generate unique ID from MAC address
  uint64_t chipid = ESP.getEfuseMac();
  char idStr[30];
  snprintf(idStr, sizeof(idStr), "esp32_%04X%08X", (uint16_t)(chipid >> 32), (uint32_t)chipid);
  roomIdStr = String(idStr);
  roomId = roomIdStr.c_str();
  Serial.printf("Device Unique ID: %s\n", roomId);

  // 1. Initialize BME280
  Wire.begin(I2C_SDA, I2C_SCL);
  if (!bme.begin(0x76, &Wire)) { // 0x76 is default. Switch to 0x77 if needed.
    Serial.println("Could not find a valid BME280 sensor, check wiring!");
    goToSleep();
  }

  // 2. Connect to Wi-Fi
  connectWiFi();

  // 3. Read Sensors & Post Data
  if (WiFi.status() == WL_CONNECTED) {
    readAndPostData();
  } else {
    Serial.println("Wi-Fi not connected. Skipping report.");
  }

  // 4. Enter Deep Sleep
  goToSleep();
}

void loop() {
  // This is never reached because the ESP32 sleeps at the end of setup()
}

void connectWiFi() {
  Serial.print("Connecting to Wi-Fi: ");
  Serial.println(ssid);
  
  WiFi.begin(ssid, password);
  
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 30) {
    delay(500);
    Serial.print(".");
    attempts++;
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWi-Fi Connected!");
    Serial.print("IP Address: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("\nWi-Fi Connection failed (timeout).");
  }
}

void readAndPostData() {
  bme.takeForcedMeasurement(); // Useful if sensor is configured in sleep mode
  
  float temp = bme.readTemperature();
  float hum = bme.readHumidity();
  float press = bme.readPressure() / 100.0F;

  if (isnan(temp) || isnan(hum) || isnan(press)) {
    Serial.println("Failed to read from BME280 sensor (got NaN).");
    return;
  }

  Serial.printf("Readings: Temp=%.2fC | Hum=%.2f%% | Press=%.2fhPa\n", temp, hum, press);

  StaticJsonDocument<200> doc;
  doc["room_id"] = roomId;
  doc["temp"] = temp;
  doc["hum"] = hum;
  doc["pressure"] = press;

  String jsonString;
  serializeJson(doc, jsonString);
  Serial.println("Sending payload: " + jsonString);

  HTTPClient http;
  http.begin(serverUrl);
  http.addHeader("Content-Type", "application/json");

  int httpResponseCode = http.POST(jsonString);

  if (httpResponseCode > 0) {
    String response = http.getString();
    Serial.printf("HTTP Response code: %d\n", httpResponseCode);
    Serial.println("Server response: " + response);
  } else {
    Serial.printf("Error sending POST request. Error code: %s\n", http.errorToString(httpResponseCode).c_str());
  }
  
  http.end();
}

void goToSleep() {
  Serial.printf("Sleeping for %d seconds...\n", sleepSeconds);
  WiFi.disconnect(true);
  WiFi.mode(WIFI_OFF);
  
  esp_sleep_enable_timer_wakeup(sleepSeconds * 1000000ULL);
  esp_deep_sleep_start();
}
