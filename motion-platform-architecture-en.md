# Motion Interactive Platform — Next.js Implementation Architecture

> Scope: this document describes the concrete implementation architecture for the Next.js platform side, with 2 motion sources currently in scope: **Camera Tracking (MediaPipe)** and **ESP32-S3 + MPU6500**, connected primarily via **WebSocket (Motion Server)**, with **Bluetooth (Web Bluetooth)** as a secondary path for situations without a WiFi network. Supports at least 2 concurrent controllers in a single session (multiplayer / two-handed). This is meant to be a spec for engineers/AI to follow while coding, not a vision doc.

---

## 1. Core problem to resolve before coding

The original overview doc defines a single shared `MotionFrame` for every provider (`deviceId, timestamp, rotation, position, buttons, confidence`). This **doesn't hold up** against the two sources actually in scope:

| Source             | Raw data                                                                      | Natural shape                                                                              |
| ------------------ | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| ESP32-S3 + MPU6500 | Quaternion from Madgwick fusion (computed on firmware)                        | `{ w, x, y, z }` — orientation only, no position (MPU6500 can't measure absolute position) |
| Camera (MediaPipe) | Pose/Hand landmarks (33 or 21 points, each x/y/z normalized 0-1 + visibility) | Array of keypoints — a completely different shape from orientation                         |

The fix: **shared envelope + discriminated union payload**. The interface layer only needs to know "this is a motion frame from device X, at time Y"; interpreting the concrete payload is left to each game's own Input Mapper based on `type`. This principle drives everything below.

---

## 2. High-level architecture

```
┌──────────────────────────────────────────────────────────────┐
│                      Next.js App (Browser)                    │
│                                                                  │
│   Game Layer (per-game Input Mapper)                            │
│            │                                                     │
│   Input Abstraction Layer (MotionManager)                       │
│            │                                                     │
│   Motion SDK (packages/motion-sdk)                               │
│      ┌─────┼──────────────┐                                     │
│      │     │              │                                      │
│  CameraProvider   Esp32WsProvider   Esp32BleProvider              │
│  (in-browser,     (WS client        (Web Bluetooth,               │
│   MediaPipe        → Motion Server)   direct browser↔ESP32,       │
│   WASM, local,    │                   fallback when no WiFi)      │
│   no server hop)  │                  │                            │
└────────────────────┼──────────────────┼────────────────────────┘
                      │ WS (wss://)      │ Web Bluetooth (GATT)
                      ▼                  ▼ (direct connection, no server)
         ┌─────────────────────────────┐
         │   Motion Server (Node.js)    │
         │   - WS relay + auth token     │
         │   - Session & Slot registry   │
         │   - Pairing flow               │
         │   - Packet validation          │
         │   - Multiplayer broadcast       │
         └──────────────┬────────────────┘
                         │ WS (ws:// local network)
                         ▼
              ┌────────────────────┐
              │   ESP32-S3 Firmware │
              │   - MPU6500 read     │
              │   - Madgwick fusion  │
              │   - Quaternion out   │
              │   - WiFi WS client   │
              │   - BLE GATT server  │  (runs alongside, same firmware,
              │     (fallback)       │   no separate build needed)
              └────────────────────┘
```

Key points:

- **CameraProvider never goes through Motion Server** — MediaPipe runs directly in the browser (WASM).
- **Esp32WsProvider** goes through Motion Server — the primary path, supports centralized pairing, multiple concurrent sessions, spectator view.
- **Esp32BleProvider** connects browser ↔ ESP32 directly, bypassing Motion Server — used when there's no stable WiFi network (outdoor demos, events without a router on-site). Trade-off: loses centralized multi-session capability; a single browser tab can hold only one BLE connection to one device at a time (a Web Bluetooth limitation, not a design choice on our end).
- ESP32-S3 firmware runs **both the WS client and the BLE GATT server in parallel** (no need for two separate firmware builds) — the game/UI decides which path to use at pairing time, depending on actual network conditions on site.

---

## 3. Motion SDK — Core Interfaces (TypeScript)

```typescript
// packages/motion-sdk/src/types.ts

export type ProviderType = 'camera' | 'esp32-ws' | 'esp32-ble' | 'mobile' | 'vr'

/** Shared envelope - every provider has this */
export interface MotionFrameBase {
  deviceId: string
  providerType: ProviderType
  timestamp: number // ms, Date.now() at capture time, NOT at receive time
  confidence: number // 0-1, provider's own confidence estimate for this frame
}

/** Payload for orientation-based devices (ESP32 IMU, VR controller) */
export interface OrientationPayload {
  type: 'orientation'
  quaternion: { w: number; x: number; y: number; z: number }
  angularVelocity?: { x: number; y: number; z: number } // rad/s, used for velocity-based gestures (swing, punch)
  buttons?: Record<string, boolean>
  battery?: number // 0-100
}

/** Payload for landmark-based devices (Camera pose/hand tracking) */
export interface LandmarkPayload {
  type: 'landmarks'
  landmarkSetType: 'pose' | 'hand'
  landmarks: Array<{ x: number; y: number; z: number; visibility?: number }>
  handedness?: 'Left' | 'Right'
}

export type MotionPayload = OrientationPayload | LandmarkPayload
export type MotionFrame = MotionFrameBase & { payload: MotionPayload }
```

```typescript
// packages/motion-sdk/src/provider.ts

export interface MotionProvider {
  readonly id: string // = deviceId once pairing is done
  readonly type: ProviderType

  connect(): Promise<void>
  disconnect(): void

  onFrame(callback: (frame: MotionFrame) => void): () => void

  getStatus(): ProviderStatus
  onStatusChange(callback: (status: ProviderStatus) => void): () => void
}

export type ProviderStatus =
  | { state: 'idle' }
  | { state: 'connecting' }
  | { state: 'connected' }
  | { state: 'error'; message: string }
  | { state: 'disconnected'; reason?: string }
```

```typescript
// packages/motion-sdk/src/motion-manager.ts

export class MotionManager {
  private providers = new Map<string, MotionProvider>()
  private latestFrames = new Map<string, MotionFrame>()

  register(provider: MotionProvider): void {
    /* ... */
  }
  unregister(deviceId: string): void {
    /* ... */
  }

  /** Games subscribe by specific deviceId, NOT by providerType —
   *  a game must know exactly which device/slot it's listening to (multiple controllers) */
  subscribe(deviceId: string, callback: (frame: MotionFrame) => void): () => void {
    /* ... */
  }

  getLatestFrame(deviceId: string): MotionFrame | undefined {
    return this.latestFrames.get(deviceId)
  }

  listConnectedDevices(): Array<{ deviceId: string; type: ProviderType; status: ProviderStatus }> {
    /* ... */
  }
}
```

`MotionManager` doesn't care whether a device came in over WS or BLE — both `Esp32WsProvider` and `Esp32BleProvider` implement the same `MotionProvider` and emit the same `MotionFrame` shape. The WS/BLE difference only lives at the pairing/registration layer (section 5), never leaking up into game code.

---

## 4. ESP32-S3 — Protocol details (WS path)

### 4.1 Firmware → Motion Server (WebSocket, local WiFi, binary)

```
Packet format (binary, little-endian, 32 bytes/frame):

Offset  Size  Field
0       4     deviceId (uint32, fixed ID flashed on firmware)
4       4     timestamp (uint32, millis() since boot — Motion Server converts to epoch)
8       4     quat.w (float32)
12      4     quat.x (float32)
16      4     quat.y (float32)
20      4     quat.z (float32)
24      2     angularVelocity.x (int16, scaled *1000)
26      2     angularVelocity.y (int16, scaled *1000)
28      2     angularVelocity.z (int16, scaled *1000)
30      1     buttons (uint8 bitmask)
31      1     battery (uint8, 0-100)
```

Firmware sends at 60-100Hz (throttled from the actual 200Hz MPU6500 read rate). Binary is used because of the high frequency, avoiding continuous JSON serialization overhead.

### 4.2 Motion Server → Browser (WebSocket, JSON)

The server converts binary → `MotionFrame` JSON before broadcasting (the browser never parses raw binary IMU packets, keeping the client-side Motion SDK simple, with decode logic living in exactly one place: the server).

```json
{
  "deviceId": "esp32-a3f2",
  "providerType": "esp32-ws",
  "timestamp": 1735900000123,
  "confidence": 0.95,
  "payload": {
    "type": "orientation",
    "quaternion": { "w": 0.98, "x": 0.01, "y": 0.15, "z": 0.02 },
    "angularVelocity": { "x": 0.02, "y": 1.85, "z": 0.01 },
    "buttons": { "primary": false },
    "battery": 87
  }
}
```

### 4.3 Sensor fusion on firmware (decided: runs on ESP32-S3)

- Madgwick filter, run on every MPU6500 sample (200Hz), output throttled down to 60-100Hz over WS.
- **MPU6500 has no magnetometer** → yaw drifts over time, no absolute heading reference. Fine for swing/punch/tilt gameplay (using relative rotation or angular velocity). If a game needs absolute direction, it needs a re-calibration UX ("hold still for 2 seconds") — see section 5.3, which reuses the identify mechanism to also serve as the calibration trigger.

---

## 5. Multiplayer Session Routing & Controller Pairing

This is the most important addition compared to the earlier version — it decides how a game knows exactly "which physical controller is player 1's left hand" when ≥2 controllers are active at once, and how multiple game sessions (multiple exhibition booths) run in parallel without cross-talk.

### 5.1 Data model on Motion Server

```typescript
interface DeviceRecord {
  deviceId: string
  connectionType: 'esp32-ws'
  status: 'idle' | 'claimed' | 'connected' | 'disconnected'
  sessionId: string | null // null = not yet assigned to any session (unclaimed pool)
  slotId: string | null // e.g. 'p1_left', 'p1_right'
  lastSeenAt: number
  battery: number | null
}

interface GameSession {
  sessionId: string // created when the game starts a play session (booth/instance)
  requiredSlots: string[] // declared by the game itself, e.g. ['p1_left','p1_right']
  slots: Record<string, string | null> // slotId -> deviceId | null (not yet paired)
  createdAt: number
}
```

Key principle: **Motion Server has no knowledge of a slot's gameplay meaning** (it never hardcodes "boxing-left-glove"). Each game declares its own arbitrary `requiredSlots` string array at pairing-init time. Boxing declares `['left_hand','right_hand']`, a two-separate-players game declares `['player1','player2']` — Motion Server just routes by slotId, no semantics attached.

### 5.2 Pairing flow when entering a game

```
1. Browser generates a new sessionId (uuid), calls Motion Server:
   POST/WS "create_session" { sessionId, requiredSlots: ['left_hand','right_hand'] }
   → Server creates a GameSession, returns the list of open slots.

2. Browser shows the "Pairing" screen (mandatory before gameplay starts):
   - Subscribes to the "unclaimed_devices" channel on Motion Server
     → receives the list of ESP32-S3 devices that are connected but have sessionId = null
     (a device that just powered on, joined WiFi, connected via WS to the server,
      automatically lands in the unclaimed pool)

3. For each unclaimed device shown in the UI, the player taps "Identify":
   Browser sends a command via Motion Server → that specific firmware device
   → ESP32 blinks its LED / vibrates (if it has a motor) for 2 seconds
   → player visually/physically confirms this is the controller they're holding

4. Player drags (or taps) to assign that device into a specific slot
   (e.g. dragging "esp32-a3f2" into the "left_hand" slot):
   Browser sends "claim_slot" { sessionId, slotId: 'left_hand', deviceId: 'esp32-a3f2' }
   → Server sets DeviceRecord.sessionId/slotId, sets GameSession.slots.left_hand = deviceId
   → Rebroadcasts "unclaimed_devices" with this device removed, for other browsers
     (prevents two people at different booths from claiming the same device)

5. Once all requiredSlots are claimed → Server reports "session_ready"
   → Browser enables the Start Game button, MotionManager subscribes by
     the claimed deviceId for each slot.
```

### 5.3 Identify command — shared between pairing and calibration

The "identify" command (step 3 above) and the "calibrate" command (yaw reset, section 4.3) go through the same mechanism: Motion Server sends a control message down to the ESP32 over WS (`{ cmd: 'identify' }` or `{ cmd: 'calibrate' }`), firmware responds with a physical action (LED/vibration) or resets its internal offset. No need for two separate channels — the control channel is just a different message type on the same WS connection, distinguished by the `cmd` field.

### 5.4 Slot release rules

- Temporary disconnect (brief WiFi drop) → **does NOT** release the slot, only sets `status: 'disconnected'`, browser shows "Reconnecting…" — the slot binding is kept so pairing doesn't need to happen again mid-session.
- A slot only returns to the unclaimed pool when: (a) the session ends (game calls `end_session`), or (b) an admin/host manually taps "Reset pairing", or (c) a device stays disconnected past a timeout (suggested 5 minutes — long enough not to interrupt an in-progress game, short enough to free up the controller for another booth if it was forgotten).

### 5.5 Isolation between multiple sessions (multiple concurrent booths)

Motion Server uses `sessionId` as the standard room key (room-based WS relay pattern). A browser connecting to Motion Server over WS must include the `sessionId` created in step 5.2.1. The server only broadcasts packets from devices belonging to `session.slots` down to browsers subscribed to that session — two booths running the same game simultaneously will never cross-receive packets, even if two devices happen to share a display name.

---

## 6. Bluetooth Provider — secondary connection path (no-WiFi fallback)

### 6.1 When to use it

Use this when there's no stable WiFi network on site (outdoor demos, fairs with no router available, quick testing at home without setting up Motion Server). Do NOT use it as the primary path for a multi-player exhibition/booth setup, because of Web Bluetooth's limits: **a single browser tab can hold only one GATT connection to one device at a time**, and there's no centralized "room/session" concept like Motion Server — all pairing state lives only inside that browser tab and is lost on page refresh.

### 6.2 GATT design on firmware

Firmware runs BLE peripheral mode alongside WiFi (ESP32-S3 supports WiFi+BLE coexistence, though there's a mild impact on WiFi throughput when both are active simultaneously — acceptable since BLE is only used when WiFi is NOT available).

```
Service UUID:        custom 128-bit, e.g. 6e400001-...
Characteristic (Notify): motion data, same 32-byte binary layout as section 4.1
  → reuses the same packet decoder logic (only the transport differs, not the format)
Characteristic (Write):  control command (identify/calibrate), same { cmd } format as WS
Advertised name:     "MotionCtrl-<deviceId short hex>" e.g. "MotionCtrl-A3F2"
                      → so the browser picker shows a distinguishable name; the player
                        reads the code printed on the device casing to pick the right one.
```

### 6.3 BLE pairing flow (very different from WS — uses the browser-native picker)

```typescript
// packages/motion-sdk/src/providers/esp32-ble-provider.ts

async function pairBleController(slotId: string): Promise<Esp32BleProvider> {
  const device = await navigator.bluetooth.requestDevice({
    filters: [{ namePrefix: 'MotionCtrl-' }],
    optionalServices: [MOTION_SERVICE_UUID],
  })
  // → The browser automatically shows a device-picker dialog (OS-level UI),
  //   this IS the pairing step; Motion Server is not involved at all.
  const server = await device.gatt!.connect()
  // ... set up the notify characteristic, decode using the same shared packet-decoder as WS
  return new Esp32BleProvider(device /* slotId assigned client-side directly, no server round-trip */)
}
```

There's no "unclaimed pool" step like WS, because the Web Bluetooth browser picker already naturally serves that role — the player picks the right device by its displayed name in the dialog. Which `slotId` it's assigned to is driven directly by the game UI ("Pair controller for the left hand"), then calling `pairBleController('left_hand')`; all state lives in `MotionManager` on the client, with nothing synced through a server.

### 6.4 Limitations to know before choosing BLE for a specific demo

- No support for spectator/multi-viewer scenarios with multiple browsers watching at once (a BLE connection is 1:1 with a device).
- No isolation mechanism for multiple concurrent booths — if running several BLE demo tables in the same area at once, each table must use its own browser tab and players must pick the correct device by name (higher risk of mis-selection than WS, since there's no automatic identify LED/vibration step like section 5.3 before pairing — the control characteristic Write can still trigger identify AFTER GATT is connected, but it cannot be used to distinguish devices BEFORE selecting in the picker dialog, since the Web Bluetooth API doesn't allow sending commands to a device that isn't connected yet).
- Safari does not support Web Bluetooth (Chrome/Edge/Chromium-based only) — the UI should detect and clearly warn on an unsupported browser, guiding the user toward the WS/WiFi path instead of letting them tap the button and hit a confusing error.

---

## 7. Camera Provider — Implementation details

```typescript
// packages/motion-sdk/src/providers/camera-provider.ts

import { PoseLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'

export class CameraProvider implements MotionProvider {
  readonly type = 'camera' as const
  private landmarker?: PoseLandmarker
  private videoEl?: HTMLVideoElement

  async connect() {
    // 1. Request getUserMedia
    // 2. Load MediaPipe WASM inside a Web Worker (mandatory — see reasoning below)
    // 3. detectForVideo loop via requestAnimationFrame, throttled to actual camera fps (~30fps)
  }
}
```

**Mandatory**: MediaPipe detection must run inside a Web Worker (`OffscreenCanvas` + worker), never on the main thread. Pose detection costs 10-20ms/frame on an average machine; running it on the main thread will stutter the game loop, especially when Three.js/R3F is rendering at the same time.

**Throttle**: cameras typically run at 30fps — no need to detect faster than the video source itself.

**Confidence**: derived from the average `visibility` of the landmarks that matter for a given game (e.g. a hand-based game uses wrist/elbow visibility). Sustained low confidence (player stepping out of frame) is handled by each game's own Input Mapper (freeze/pause), not the SDK's responsibility.

---

## 8. Input Mapper — where the game interprets the payload

```typescript
// apps/game-boxing/src/input/boxing-input-mapper.ts
function mapEsp32ToPunchEvent(frame: MotionFrame): PunchEvent | null {
  if (frame.payload.type !== 'orientation') return null
  const { angularVelocity } = frame.payload
  if (!angularVelocity) return null
  const speed = Math.hypot(angularVelocity.x, angularVelocity.y, angularVelocity.z)
  if (speed > PUNCH_THRESHOLD_RAD_S) {
    return { type: 'punch', power: normalizeSpeed(speed), direction: quatToDirection(frame.payload.quaternion) }
  }
  return null
}
```

```typescript
// apps/game-rhythm/src/input/rhythm-input-mapper.ts
function mapCameraToHandPosition(frame: MotionFrame): { x: number; y: number } | null {
  if (frame.payload.type !== 'landmarks' || frame.payload.landmarkSetType !== 'hand') return null
  const wrist = frame.payload.landmarks[0]
  return { x: wrist.x, y: wrist.y }
}
```

Each game writes its own mapper, with real type-safety (discriminated union) instead of assuming a single fixed schema.

---

## 9. State Management (Zustand)

```typescript
// apps/game-boxing/src/store/motion-store.ts
interface MotionStore {
  leftGloveFrame: MotionFrame | null
  rightGloveFrame: MotionFrame | null
  connectionStatus: Record<string, ProviderStatus>
  setFrame: (deviceId: string, frame: MotionFrame) => void
  setStatus: (deviceId: string, status: ProviderStatus) => void
}
```

The store only holds the **latest frame per device**, no history (gesture-recognition history is handled by a separate ring buffer inside each Input Mapper, not pushed into Zustand, since that would trigger re-renders 60-100 times/second — only update Zustand state when a real UI re-render is needed, e.g. a punch counter).

---

## 10. Project Structure

```
apps/
  game-boxing/
    src/
      input/
      scenes/
      store/
  game-rhythm/
  game-racing/

packages/
  motion-sdk/
    src/
      types.ts
      provider.ts
      motion-manager.ts
      packet-decoder.ts        # shared decoder, used by both WS server-side and BLE client-side
      providers/
        camera-provider.ts
        esp32-ws-provider.ts   # WS client to Motion Server
        esp32-ble-provider.ts  # direct Web Bluetooth
  game-engine/
  network/
  ui/
    pairing/                  # PairingScreen, UnclaimedDeviceList, SlotAssignUI

server/
  motion-server/
    src/
      ws-relay.ts
      session-registry.ts      # GameSession + DeviceRecord (section 5.1)
      pairing-handler.ts       # create_session / claim_slot / identify (section 5.2-5.3)
      packet-decoder.ts        # binary → MotionFrame JSON
      auth.ts

firmware/
  esp32-s3-motion-controller/
    src/
      mpu6500_driver.cpp
      madgwick_filter.cpp
      ws_client.cpp
      ble_gatt_server.cpp      # runs alongside ws_client, same firmware
      identify_handler.cpp     # LED/vibration, shared between pairing + calibrate
```

---

## 11. Error Handling & Reconnection

| Situation                                                                                     | Handling                                                                                                                                                                                                                                                                                     |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ESP32 (WS) loses WiFi mid-session                                                             | Firmware auto-reconnects with exponential backoff (1s→2s→4s→max 10s). Server marks `disconnected` after 3s with no packets, does NOT release the slot (section 5.4)                                                                                                                          |
| Motion Server crashes/restarts                                                                | Browser + firmware reconnect independently, no ordering dependency                                                                                                                                                                                                                           |
| BLE GATT disconnect (out of range, interference)                                              | `Esp32BleProvider` listens for the `gattserverdisconnected` event, retries `device.gatt.connect()` a few times; if it keeps failing, prompts the UI to ask the player to re-pair manually (Web Bluetooth can't auto-reconnect without a user gesture — a browser limitation, not a code bug) |
| Camera permission denied                                                                      | `connect()` rejects clearly, UI falls back with permission guidance, keyboard input fallback available for dev/testing                                                                                                                                                                       |
| Two people tap "claim" on the same unclaimed device at the same time (pairing race condition) | Server processes claims in received order (first-write-wins), immediately rebroadcasts the unclaimed list; the browser that arrives second sees the updated state and the device auto-disappears from its list                                                                               |
| Sustained low confidence                                                                      | Handled by each game's own Input Mapper, not the SDK                                                                                                                                                                                                                                         |

---

## 12. Testing / Mock Providers

`motion-sdk` must include a `MockProvider implements MotionProvider` so gameplay logic can be developed without plugging in an ESP32 or turning on the camera. The mock provider emits synthetic frames (sine wave for orientation, a scripted landmark sequence for camera), plugging straight into `MotionManager` just like a real provider.

A `MockPairingServer` (running locally, no real Motion Server needed) is also recommended, to test the pairing UI flow (section 5.2) in isolation.

---

## 13. Open items — need to be settled before coding the related parts

- **Full-body pose landmark set**: `LandmarkPayload` already supports `landmarkSetType: 'pose'`, but there's no concrete mapper example yet — needed once a game uses full-body tracking instead of just hands.
- **Max slots per session**: currently designed with no hard limit, but needs confirmation of the real-world maximum concurrent controllers (the original ask said "at least 2" — if there's a scenario with 4 players / 8 controllers, Motion Server throughput needs review; not yet benchmarked).
- **5-minute slot-release timeout** (section 5.4c) is a proposed number — needs confirmation against actual booth operations (how long a reset between guests realistically takes).
