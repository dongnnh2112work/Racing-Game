import { useCallback, useEffect, useRef, useState } from 'react'
import {
  CAMERA_LEFT_ID,
  CAMERA_RIGHT_ID,
  RACING_SLOTS,
  type RacingSlotId,
  type SlotAssignments,
  type UnclaimedDevice,
  openPairingSocket,
  isWebBluetoothSupported,
  isSafari,
  Esp32BleProvider,
} from '@howls/motion-sdk'
import type { ServerMessage, ServerResponse } from '@howls/motion-sdk'

export type PairingScreenProps = {
  serverUrl: string
  sessionId: string
  onSessionReady: (assignments: SlotAssignments) => void
  onCameraSlotsReady?: () => void
  useMock?: boolean
}

const SLOT_LABELS: Record<RacingSlotId, string> = {
  steering_wheel: 'Steering Wheel (ESP32)',
  left_hand: 'Left Hand (Camera)',
  right_hand: 'Right Hand (Camera)',
}

export function PairingScreen({ serverUrl, sessionId, onSessionReady, onCameraSlotsReady, useMock }: PairingScreenProps) {
  const [slots, setSlots] = useState<SlotAssignments>({
    steering_wheel: null,
    left_hand: CAMERA_LEFT_ID,
    right_hand: CAMERA_RIGHT_ID,
  })
  const [unclaimed, setUnclaimed] = useState<UnclaimedDevice[]>([])
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [connectionPath, setConnectionPath] = useState<'ws' | 'ble'>('ws')
  const wsRef = useRef<WebSocket | null>(null)

  const checkReady = useCallback(
    (nextSlots: SlotAssignments) => {
      const espReady = nextSlots.steering_wheel !== null
      const handsReady = nextSlots.left_hand !== null && nextSlots.right_hand !== null
      if (espReady && handsReady) {
        setReady(true)
        onSessionReady(nextSlots)
      }
    },
    [onSessionReady],
  )

  useEffect(() => {
    if (useMock) {
      const mockSlots: SlotAssignments = {
        steering_wheel: 'mock-wheel',
        left_hand: CAMERA_LEFT_ID,
        right_hand: CAMERA_RIGHT_ID,
      }
      setSlots(mockSlots)
      setReady(true)
      onSessionReady(mockSlots)
      onCameraSlotsReady?.()
      return
    }

    const ws = openPairingSocket(serverUrl, (msg: ServerResponse) => {
      if (msg.type === 'unclaimed_devices') setUnclaimed(msg.devices)
      if (msg.type === 'slot_claimed') {
        setSlots((prev) => {
          const next = { ...prev, ...msg.slots, left_hand: CAMERA_LEFT_ID, right_hand: CAMERA_RIGHT_ID }
          checkReady(next)
          return next
        })
      }
      if (msg.type === 'session_ready') {
        setReady(true)
        onSessionReady({ ...msg.slots, left_hand: CAMERA_LEFT_ID, right_hand: CAMERA_RIGHT_ID } as SlotAssignments)
      }
      if (msg.type === 'error') setError(msg.message)
    })
    wsRef.current = ws

    ws.addEventListener('open', () => {
      ws.send(
        JSON.stringify({
          type: 'create_session',
          sessionId,
          requiredSlots: ['steering_wheel'],
        } as ServerMessage),
      )
      onCameraSlotsReady?.()
    })

    return () => ws.close()
  }, [serverUrl, sessionId, useMock, onSessionReady, onCameraSlotsReady, checkReady])

  const claimSlot = (slotId: string, deviceId: string) => {
    wsRef.current?.send(JSON.stringify({ type: 'claim_slot', sessionId, slotId, deviceId } as ServerMessage))
  }

  const identify = (deviceId: string) => {
    wsRef.current?.send(JSON.stringify({ type: 'identify', sessionId, deviceId } as ServerMessage))
  }

  const pairBle = async () => {
    try {
      const provider = await Esp32BleProvider.pair('steering_wheel')
      setSlots((prev) => {
        const next = { ...prev, steering_wheel: provider.id }
        checkReady(next)
        return next
      })
      setConnectionPath('ble')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'BLE pairing failed')
    }
  }

  return (
    <div className="pairing-screen">
      <h2>Controller Pairing</h2>
      <p>Assign controllers before starting the race.</p>
      {error && <p className="pairing-error">{error}</p>}
      {isSafari() && <p className="pairing-warn">Safari does not support Web Bluetooth. Use WiFi/WebSocket for the steering wheel.</p>}

      <div className="pairing-slots">
        {RACING_SLOTS.map((slotId) => (
          <div key={slotId} className={`pairing-slot ${slots[slotId] ? 'filled' : ''}`}>
            <strong>{SLOT_LABELS[slotId]}</strong>
            <span>{slots[slotId] ?? 'Not assigned'}</span>
            {slotId === 'steering_wheel' && slots[slotId] && (
              <button type="button" onClick={() => identify(slots.steering_wheel!)}>
                Identify
              </button>
            )}
          </div>
        ))}
      </div>

      {connectionPath === 'ws' && (
        <div className="pairing-unclaimed">
          <h3>Available ESP32 devices</h3>
          {unclaimed.length === 0 && <p>Waiting for devices… Power on ESP32 and connect to WiFi.</p>}
          {unclaimed.map((device) => (
            <div key={device.deviceId} className="pairing-device">
              <span>{device.deviceId}</span>
              {device.battery !== null && <span>{device.battery}%</span>}
              <button type="button" onClick={() => identify(device.deviceId)}>
                Identify
              </button>
              <button type="button" onClick={() => claimSlot('steering_wheel', device.deviceId)}>
                Assign to Wheel
              </button>
            </div>
          ))}
        </div>
      )}

      {isWebBluetoothSupported() && !isSafari() && (
        <button type="button" className="pairing-ble-btn" onClick={() => void pairBle()}>
          Pair Steering Wheel via Bluetooth (no WiFi)
        </button>
      )}

      {ready && <p className="pairing-ready">Session ready — you can start the game.</p>}
    </div>
  )
}

export { UnclaimedDeviceList } from './UnclaimedDeviceList'
export { SlotAssignUI } from './SlotAssignUI'
