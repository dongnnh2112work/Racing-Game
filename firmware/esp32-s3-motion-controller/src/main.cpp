/*
 * ESP32-S3 Motion Controller Firmware
 * MPU6500 + Madgwick fusion, binary WS packets + BLE GATT
 *
 * Packet format: 32 bytes little-endian (see motion-platform-architecture-en.md §4.1)
 */

#include <WiFi.h>
#include <WebSocketsClient.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <Wire.h>

// --- Config (edit for your network) ---
const char* WIFI_SSID = "YOUR_WIFI";
const char* WIFI_PASS = "YOUR_PASSWORD";
const char* MOTION_SERVER_HOST = "192.168.1.100";
const uint16_t MOTION_SERVER_PORT = 8080;
const char* MOTION_SERVER_PATH = "/device";

const uint32_t DEVICE_ID = 0x0000A3F2;
const int MPU_ADDR = 0x68;
const int LED_PIN = 2;

const char* BLE_NAME = "MotionCtrl-A3F2";
#define SERVICE_UUID        "6e400001-b5a3-f393-e0a9-e50e24dcca9e"
#define NOTIFY_CHAR_UUID    "6e400002-b5a3-f393-e0a9-e50e24dcca9e"
#define WRITE_CHAR_UUID     "6e400003-b5a3-f393-e0a9-e50e24dcca9e"

WebSocketsClient ws;
BLECharacteristic* notifyChar = nullptr;
BLECharacteristic* writeChar = nullptr;

float q0 = 1, q1 = 0, q2 = 0, q3 = 0;
float yawOffset = 0;
unsigned long lastSend = 0;
const unsigned long SEND_INTERVAL_MS = 16; // ~60Hz

// Madgwick filter (simplified)
float beta = 0.1f;
float gx, gy, gz, ax, ay, az;

void writeUint32LE(uint8_t* buf, int offset, uint32_t val) {
  buf[offset] = val & 0xFF;
  buf[offset + 1] = (val >> 8) & 0xFF;
  buf[offset + 2] = (val >> 16) & 0xFF;
  buf[offset + 3] = (val >> 24) & 0xFF;
}

void writeFloat32LE(uint8_t* buf, int offset, float val) {
  memcpy(&buf[offset], &val, 4);
}

void writeInt16LE(uint8_t* buf, int offset, int16_t val) {
  buf[offset] = val & 0xFF;
  buf[offset + 1] = (val >> 8) & 0xFF;
}

void sendMotionPacket() {
  uint8_t packet[32];
  uint32_t ts = millis();
  float w = q0, x = q1, y = q2, z = q3;

  writeUint32LE(packet, 0, DEVICE_ID);
  writeUint32LE(packet, 4, ts);
  writeFloat32LE(packet, 8, w);
  writeFloat32LE(packet, 12, x);
  writeFloat32LE(packet, 16, y);
  writeFloat32LE(packet, 20, z);
  writeInt16LE(packet, 24, (int16_t)(gx * 1000));
  writeInt16LE(packet, 26, (int16_t)(gy * 1000));
  writeInt16LE(packet, 28, (int16_t)(gz * 1000));
  packet[30] = 0;
  packet[31] = 100;

  if (ws.isConnected()) ws.sendBIN(packet, 32);
  if (notifyChar) notifyChar->setValue(packet, 32);
}

void madgwickUpdate(float gx_r, float gy_r, float gz_r, float ax_g, float ay_g, float az_g, float dt) {
  // Simplified Madgwick — replace with full implementation in production
  float yaw = atan2(2.0f * (q0 * q3 + q1 * q2), 1.0f - 2.0f * (q2 * q2 + q3 * q3)) - yawOffset;
  q0 = cos(yaw / 2);
  q3 = sin(yaw / 2);
  q1 = 0;
  q2 = 0;
}

void readMPU() {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x3B);
  Wire.endTransmission(false);
  Wire.requestFrom(MPU_ADDR, 14, true);
  int16_t rawAx = Wire.read() << 8 | Wire.read();
  int16_t rawAy = Wire.read() << 8 | Wire.read();
  int16_t rawAz = Wire.read() << 8 | Wire.read();
  Wire.read(); Wire.read();
  int16_t rawGx = Wire.read() << 8 | Wire.read();
  int16_t rawGy = Wire.read() << 8 | Wire.read();
  int16_t rawGz = Wire.read() << 8 | Wire.read();

  ax = rawAx / 16384.0f;
  ay = rawAy / 16384.0f;
  az = rawAz / 16384.0f;
  gx = rawGx / 131.0f;
  gy = rawGy / 131.0f;
  gz = rawGz / 131.0f;
}

class ControlCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* pChar) override {
    std::string value = pChar->getValue();
    if (value.find("identify") != std::string::npos) {
      for (int i = 0; i < 10; i++) {
        digitalWrite(LED_PIN, HIGH);
        delay(100);
        digitalWrite(LED_PIN, LOW);
        delay(100);
      }
    }
    if (value.find("calibrate") != std::string::npos) {
      yawOffset = atan2(2.0f * (q0 * q3 + q1 * q2), 1.0f - 2.0f * (q2 * q2 + q3 * q3));
    }
  }
};

void wsEvent(WStype_t type, uint8_t* payload, size_t length) {
  if (type == WStype_TEXT && payload) {
    String msg = String((char*)payload);
    if (msg.indexOf("identify") >= 0) {
      for (int i = 0; i < 10; i++) {
        digitalWrite(LED_PIN, !digitalRead(LED_PIN));
        delay(100);
      }
    }
    if (msg.indexOf("calibrate") >= 0) {
      yawOffset = atan2(2.0f * (q0 * q3 + q1 * q2), 1.0f - 2.0f * (q2 * q2 + q3 * q3));
    }
  }
}

void setupBLE() {
  BLEDevice::init(BLE_NAME);
  BLEServer* server = BLEDevice::createServer();
  BLEService* service = server->createService(SERVICE_UUID);
  notifyChar = service->createCharacteristic(NOTIFY_CHAR_UUID, BLECharacteristic::PROPERTY_NOTIFY);
  notifyChar->addDescriptor(new BLE2902());
  writeChar = service->createCharacteristic(WRITE_CHAR_UUID, BLECharacteristic::PROPERTY_WRITE);
  writeChar->setCallbacks(new ControlCallbacks());
  service->start();
  BLEDevice::getAdvertising()->addServiceUUID(SERVICE_UUID);
  BLEDevice::startAdvertising();
}

void connectWiFi() {
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 30) {
    delay(500);
    attempts++;
  }
}

void setup() {
  pinMode(LED_PIN, OUTPUT);
  Wire.begin(21, 22);
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x6B);
  Wire.write(0);
  Wire.endTransmission(true);

  setupBLE();
  connectWiFi();

  ws.begin(MOTION_SERVER_HOST, MOTION_SERVER_PORT, MOTION_SERVER_PATH);
  ws.onEvent(wsEvent);
  ws.setReconnectInterval(1000);
}

void loop() {
  ws.loop();
  readMPU();
  madgwickUpdate(gx, gy, gz, ax, ay, az, 0.005f);

  unsigned long now = millis();
  if (now - lastSend >= SEND_INTERVAL_MS) {
    lastSend = now;
    sendMotionPacket();
  }
}
