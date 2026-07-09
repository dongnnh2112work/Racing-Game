export type ProviderType = 'camera' | 'esp32-ws' | 'esp32-ble' | 'mobile' | 'vr' | 'mock'

export interface MotionFrameBase {
  deviceId: string
  providerType: ProviderType
  timestamp: number
  confidence: number
}

export interface OrientationPayload {
  type: 'orientation'
  quaternion: { w: number; x: number; y: number; z: number }
  angularVelocity?: { x: number; y: number; z: number }
  buttons?: Record<string, boolean>
  battery?: number
}

export interface LandmarkPayload {
  type: 'landmarks'
  landmarkSetType: 'pose' | 'hand'
  landmarks: Array<{ x: number; y: number; z: number; visibility?: number }>
  handedness?: 'Left' | 'Right'
}

export type MotionPayload = OrientationPayload | LandmarkPayload
export type MotionFrame = MotionFrameBase & { payload: MotionPayload }

export const CAMERA_LEFT_ID = 'camera-left'
export const CAMERA_RIGHT_ID = 'camera-right'

export const RACING_SLOTS = ['steering_wheel', 'left_hand', 'right_hand'] as const
export type RacingSlotId = typeof RACING_SLOTS[number]

export type SlotAssignments = Record<RacingSlotId, string | null>

export type ServerMessage =
  | { type: 'create_session'; sessionId: string; requiredSlots: string[] }
  | { type: 'claim_slot'; sessionId: string; slotId: string; deviceId: string }
  | { type: 'identify'; sessionId: string; deviceId: string }
  | { type: 'calibrate'; sessionId: string; deviceId: string }
  | { type: 'end_session'; sessionId: string }
  | { type: 'subscribe_session'; sessionId: string }

export type ServerResponse =
  | { type: 'session_created'; sessionId: string; requiredSlots: string[]; slots: Record<string, string | null> }
  | { type: 'unclaimed_devices'; devices: UnclaimedDevice[] }
  | { type: 'slot_claimed'; sessionId: string; slotId: string; deviceId: string; slots: Record<string, string | null> }
  | { type: 'session_ready'; sessionId: string; slots: Record<string, string | null> }
  | { type: 'motion_frame'; frame: MotionFrame }
  | { type: 'device_status'; deviceId: string; status: 'idle' | 'claimed' | 'connected' | 'disconnected' }
  | { type: 'error'; message: string }

export type UnclaimedDevice = {
  deviceId: string
  battery: number | null
  lastSeenAt: number
}

export const MOTION_SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e'
export const MOTION_NOTIFY_CHAR_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'
export const MOTION_WRITE_CHAR_UUID = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'

export const PACKET_SIZE = 32
