import { useEffect, useRef } from 'react'
import {
  CAMERA_LEFT_ID,
  CAMERA_RIGHT_ID,
  CameraProvider,
  Esp32WsProvider,
  MockProvider,
  motionManager,
  RACING_SLOTS,
  type SlotAssignments,
} from '@howls/motion-sdk'
import { useKeyboardAdapter } from './KeyboardAdapter'
import { mapMotionToRacingInput } from './racing-input-mapper'
import { getMotionState, useMotionStore } from '../store/motion-store'
import { getState, mutation, setState } from '../store'

const MOTION_SERVER_URL = process.env.NEXT_PUBLIC_MOTION_SERVER_URL ?? 'ws://localhost:8080'

function keyboardSteering(): number {
  const { controls } = getState()
  if (controls.left && !controls.right) return -1
  if (controls.right && !controls.left) return 1
  return 0
}

export function MotionRuntime() {
  useKeyboardAdapter()
  const slotAssignments = useMotionStore((s) => s.slotAssignments)
  const cameraRef = useRef<CameraProvider | null>(null)
  const wsProviderRef = useRef<Esp32WsProvider | null>(null)
  const startedRef = useRef(false)

  useEffect(() => {
    if (!slotAssignments || startedRef.current) return
    startedRef.current = true

    const sessionId = getMotionState().sessionId ?? crypto.randomUUID()
    const useMock = getState().racingInputConfig.useMock

    const registerProvider = (provider: Parameters<typeof motionManager.register>[0]) => {
      motionManager.register(provider)
      provider.onStatusChange((status) => getMotionState().setStatus(provider.id, status))
      provider.onFrame((frame) => getMotionState().setFrame(frame.deviceId, frame))
    }

    if (useMock) {
      registerProvider(new MockProvider(slotAssignments.steering_wheel ?? 'mock-wheel', 'orientation'))
      registerProvider(new MockProvider(CAMERA_LEFT_ID, 'landmarks', 'Left'))
      registerProvider(new MockProvider(CAMERA_RIGHT_ID, 'landmarks', 'Right'))
      return () => motionManager.disconnectAll()
    }

    const camera = new CameraProvider()
    cameraRef.current = camera
    registerProvider(camera)
    void camera.connect()

    const wheelId = slotAssignments.steering_wheel
    if (wheelId && wheelId.startsWith('esp32-')) {
      const ws = new Esp32WsProvider({ serverUrl: MOTION_SERVER_URL, sessionId, deviceIds: [wheelId] }, wheelId)
      wsProviderRef.current = ws
      registerProvider(ws)
      void ws.connect()
    }

    return () => {
      motionManager.disconnectAll()
      cameraRef.current = null
      wsProviderRef.current = null
      startedRef.current = false
    }
  }, [slotAssignments])

  useEffect(() => {
    let raf = 0
    const tick = () => {
      const assignments = getMotionState().slotAssignments
      const config = getState().racingInputConfig
      if (assignments) {
        const wheelFrame = motionManager.getLatestFrame(assignments.steering_wheel ?? '')
        const leftFrame = motionManager.getLatestFrame(assignments.left_hand ?? CAMERA_LEFT_ID)
        const rightFrame = motionManager.getLatestFrame(assignments.right_hand ?? CAMERA_RIGHT_ID)
        const input = mapMotionToRacingInput(wheelFrame, leftFrame, rightFrame, keyboardSteering(), config)
        mutation.racingInput = input
        setState({
          steering: input.steering,
          activeInputSource: input.source === 'wheel' ? 'wheel' : input.source === 'hands' ? 'hands' : 'keyboard',
          handWheelRotation: input.handWheelRotation,
          handTrackingHands: input.handCount,
        })
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  return null
}

export function startMotionSession(assignments: SlotAssignments, sessionId: string): void {
  getMotionState().setSessionId(sessionId)
  getMotionState().setSlotAssignments(assignments)
  getMotionState().setPairingComplete(true)
}

export { MOTION_SERVER_URL, RACING_SLOTS }
