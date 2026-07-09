import { Euler, Quaternion, Vector3 } from 'three'
import type { PublicApi } from '@react-three/cannon'

import type { RacingInputSource } from './input/racing-input-mapper'
import { recoverVehicleToTrack } from './trackWaypoints'

const up = new Vector3(0, 1, 0)
const euler = new Euler()

export type StuckPhase = 'normal' | 'reversing' | 'recovering'

export const RECOVERY_HEIGHT = 0.75

export function isMotionDriveMode(source: RacingInputSource): boolean {
  return source === 'hands' || source === 'wheel'
}

export function isVehicleOverturned(quaternion: Quaternion): boolean {
  up.set(0, 1, 0).applyQuaternion(quaternion)
  if (up.y < 0.6) return true

  euler.setFromQuaternion(quaternion, 'YXZ')
  const tilt = Math.abs(euler.x) + Math.abs(euler.z)
  return tilt > (45 * Math.PI) / 180
}

export function recoverVehicle(api: PublicApi, px: number, pz: number, height = RECOVERY_HEIGHT): void {
  recoverVehicleToTrack(api, px, height, pz)
}
