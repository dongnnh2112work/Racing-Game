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

export type ServerMessage =
  | { type: 'create_session'; sessionId: string; requiredSlots: string[] }
  | { type: 'claim_slot'; sessionId: string; slotId: string; deviceId: string }
  | { type: 'identify'; sessionId: string; deviceId: string }
  | { type: 'calibrate'; sessionId: string; deviceId: string }
  | { type: 'end_session'; sessionId: string }
  | { type: 'subscribe_session'; sessionId: string }

export type ServerResponse =
  | { type: 'session_created'; sessionId: string; requiredSlots: string[]; slots: Record<string, string | null> }
  | { type: 'unclaimed_devices'; devices: Array<{ deviceId: string; battery: number | null; lastSeenAt: number }> }
  | { type: 'slot_claimed'; sessionId: string; slotId: string; deviceId: string; slots: Record<string, string | null> }
  | { type: 'session_ready'; sessionId: string; slots: Record<string, string | null> }
  | { type: 'motion_frame'; frame: MotionFrame }
  | { type: 'device_status'; deviceId: string; status: 'idle' | 'claimed' | 'connected' | 'disconnected' }
  | { type: 'error'; message: string }

export const PACKET_SIZE = 32
