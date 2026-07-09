import type { MotionFrame } from './types'
import { PACKET_SIZE } from './types'

export type DecodedPacket = {
  deviceId: string
  firmwareTimestamp: number
  quaternion: { w: number; x: number; y: number; z: number }
  angularVelocity: { x: number; y: number; z: number }
  buttons: Record<string, boolean>
  battery: number
}

export function decodeMotionPacket(buffer: ArrayBuffer | Uint8Array, bootEpochOffset = 0): DecodedPacket {
  const view = buffer instanceof ArrayBuffer ? new DataView(buffer) : new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  if (view.byteLength < PACKET_SIZE) {
    throw new Error(`Packet too small: ${view.byteLength} < ${PACKET_SIZE}`)
  }

  const deviceIdNum = view.getUint32(0, true)
  const firmwareTimestamp = view.getUint32(4, true)
  const w = view.getFloat32(8, true)
  const x = view.getFloat32(12, true)
  const y = view.getFloat32(16, true)
  const z = view.getFloat32(20, true)
  const avx = view.getInt16(24, true) / 1000
  const avy = view.getInt16(26, true) / 1000
  const avz = view.getInt16(28, true) / 1000
  const buttonsMask = view.getUint8(30)
  const battery = view.getUint8(31)

  return {
    deviceId: `esp32-${deviceIdNum.toString(16).padStart(4, '0')}`,
    firmwareTimestamp,
    quaternion: { w, x, y, z },
    angularVelocity: { x: avx, y: avy, z: avz },
    buttons: { primary: (buttonsMask & 0x01) !== 0 },
    battery,
  }
}

export function packetToMotionFrame(decoded: DecodedPacket, providerType: 'esp32-ws' | 'esp32-ble', bootEpochOffset = 0): MotionFrame {
  return {
    deviceId: decoded.deviceId,
    providerType,
    timestamp: bootEpochOffset + decoded.firmwareTimestamp,
    confidence: 0.95,
    payload: {
      type: 'orientation',
      quaternion: decoded.quaternion,
      angularVelocity: decoded.angularVelocity,
      buttons: decoded.buttons,
      battery: decoded.battery,
    },
  }
}

export function encodeControlCommand(cmd: 'identify' | 'calibrate'): Uint8Array {
  const json = JSON.stringify({ cmd })
  return new TextEncoder().encode(json)
}
