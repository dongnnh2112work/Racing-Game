# ESP32-S3 Motion Controller

Firmware for MPU6500 + Madgwick orientation streaming over WebSocket and BLE.

## Features

- Binary 32-byte motion packets (architecture doc §4.1)
- WebSocket client to Motion Server (primary path)
- BLE GATT server alongside WiFi (fallback path)
- `identify` and `calibrate` control commands

## Setup

1. Install Arduino ESP32 board support + WebSockets library
2. Edit WiFi and Motion Server IP in `src/main.cpp`
3. Flash to ESP32-S3

## Packet format

See `motion-platform-architecture-en.md` section 4.1.
