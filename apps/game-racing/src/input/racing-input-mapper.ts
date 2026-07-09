import type { MotionFrame } from '@howls/motion-sdk'

export type RacingInputSource = 'wheel' | 'hands' | 'keyboard' | 'none'

export type RacingInput = {
  steering: number
  throttle: number
  source: RacingInputSource
  handWheelRotation: number
  handCount: number
}

export type RacingInputConfig = {
  steeringDeadzone: number
  steeringSensitivity: number
  steeringInvert: boolean
  handMaxAngleDeg: number
  wheelYawOffset: number
  useMock: boolean
}

export const defaultRacingInputConfig: RacingInputConfig = {
  steeringDeadzone: 0.08,
  steeringSensitivity: 1,
  steeringInvert: false,
  handMaxAngleDeg: 90,
  wheelYawOffset: 0,
  useMock: process.env.NEXT_PUBLIC_USE_MOCK === 'true',
}

export function clampSteering(value: number): number {
  return Math.max(-1, Math.min(1, value))
}

export function applyDeadzone(value: number, deadzone: number): number {
  const abs = Math.abs(value)
  if (abs <= deadzone) return 0
  const sign = value < 0 ? -1 : 1
  return sign * ((abs - deadzone) / (1 - deadzone))
}

export function getTwoHandBarAngle(leftWrist: { x: number; y: number }, rightWrist: { x: number; y: number }): number {
  const dx = rightWrist.x - leftWrist.x
  const dy = rightWrist.y - leftWrist.y
  const span = Math.max(Math.abs(dx), 0.08)
  return Math.atan2(dy, span)
}

export function mapTwoHandBarToSteering(barAngleRad: number, maxAngleDeg: number, sensitivity: number): number {
  const maxAngle = (maxAngleDeg * Math.PI) / 180
  if (maxAngle <= 0) return 0
  return clampSteering((barAngleRad / maxAngle) * sensitivity)
}

export function quaternionToSteering(q: { w: number; x: number; y: number; z: number }, yawOffset = 0): number {
  const siny = 2 * (q.w * q.y + q.x * q.z)
  const cosy = 1 - 2 * (q.y * q.y + q.z * q.z)
  const yaw = Math.atan2(siny, cosy) - yawOffset
  return clampSteering(yaw / (Math.PI / 4))
}

export function mapMotionToRacingInput(
  wheelFrame: MotionFrame | null | undefined,
  leftFrame: MotionFrame | null | undefined,
  rightFrame: MotionFrame | null | undefined,
  keyboardSteering: number,
  config: RacingInputConfig,
): RacingInput {
  const finalize = (steering: number, source: RacingInputSource, extras: Partial<RacingInput> = {}): RacingInput => {
    let s = steering * config.steeringSensitivity
    s = applyDeadzone(s, config.steeringDeadzone)
    if (config.steeringInvert) s *= -1
    return {
      steering: clampSteering(s),
      throttle: source === 'hands' ? 0.2 : source === 'wheel' ? 1 : keyboardSteering !== 0 ? 1 : 0,
      source,
      handWheelRotation: extras.handWheelRotation ?? 0,
      handCount: extras.handCount ?? 0,
    }
  }

  if (wheelFrame?.payload.type === 'orientation' && wheelFrame.providerType !== 'mock' && !wheelFrame.deviceId.startsWith('mock')) {
    const steering = quaternionToSteering(wheelFrame.payload.quaternion, config.wheelYawOffset)
    return finalize(steering, 'wheel')
  }

  if (
    leftFrame?.payload.type === 'landmarks' &&
    rightFrame?.payload.type === 'landmarks' &&
    leftFrame.payload.landmarks.length > 0 &&
    rightFrame.payload.landmarks.length > 0
  ) {
    const leftWrist = leftFrame.payload.landmarks[0]
    const rightWrist = rightFrame.payload.landmarks[0]
    const barAngle = getTwoHandBarAngle(leftWrist, rightWrist)
    const steering = mapTwoHandBarToSteering(barAngle, config.handMaxAngleDeg, config.steeringSensitivity)
    return finalize(steering, 'hands', { handWheelRotation: barAngle, handCount: 2 })
  }

  if (leftFrame?.payload.type === 'landmarks' || rightFrame?.payload.type === 'landmarks') {
    return finalize(0, 'hands', { handCount: 1 })
  }

  if (Math.abs(keyboardSteering) > 0) {
    return finalize(keyboardSteering, 'keyboard')
  }

  return finalize(0, 'none')
}
