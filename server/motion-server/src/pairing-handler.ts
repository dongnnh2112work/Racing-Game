import { decodeMotionPacket, packetToMotionFrame } from './packet-decoder'
import type { ServerMessage, ServerResponse } from './protocol'
import type { WebSocket } from 'ws'
import type { SessionRegistry } from './session-registry'

export function handleBrowserMessage(registry: SessionRegistry, ws: WebSocket, message: ServerMessage, sessionIdRef: { current: string | null }): void {
  switch (message.type) {
    case 'create_session': {
      const session = registry.createSession(message.sessionId, message.requiredSlots)
      sessionIdRef.current = message.sessionId
      registry.subscribeBrowser(message.sessionId, ws)
      const response: ServerResponse = {
        type: 'session_created',
        sessionId: session.sessionId,
        requiredSlots: session.requiredSlots,
        slots: { ...session.slots },
      }
      ws.send(JSON.stringify(response))
      registry.broadcastUnclaimed()
      break
    }
    case 'subscribe_session': {
      registry.subscribeBrowser(message.sessionId, ws)
      sessionIdRef.current = message.sessionId
      const session = registry.getSession(message.sessionId)
      if (session) {
        ws.send(
          JSON.stringify({
            type: 'session_created',
            sessionId: session.sessionId,
            requiredSlots: session.requiredSlots,
            slots: { ...session.slots },
          } as ServerResponse),
        )
      }
      registry.broadcastUnclaimed()
      break
    }
    case 'claim_slot': {
      const result = registry.claimSlot(message.sessionId, message.slotId, message.deviceId)
      if (!result.ok) {
        ws.send(JSON.stringify({ type: 'error', message: result.error ?? 'Claim failed' } as ServerResponse))
        return
      }
      ws.send(
        JSON.stringify({
          type: 'slot_claimed',
          sessionId: message.sessionId,
          slotId: message.slotId,
          deviceId: message.deviceId,
          slots: result.slots!,
        } as ServerResponse),
      )
      registry.broadcastUnclaimed()
      if (registry.isSessionReady(message.sessionId)) {
        registry.broadcastToSession(message.sessionId, {
          type: 'session_ready',
          sessionId: message.sessionId,
          slots: result.slots ?? {},
        } as ServerResponse)
      }
      break
    }
    case 'identify':
    case 'calibrate': {
      registry.sendControlToDevice(message.deviceId, message.type)
      break
    }
    case 'end_session': {
      registry.endSession(message.sessionId)
      sessionIdRef.current = null
      break
    }
  }
}

export function handleEsp32Binary(registry: SessionRegistry, ws: WebSocket, data: Buffer): string | null {
  try {
    const decoded = decodeMotionPacket(data)
    const device = registry.registerDevice(decoded.deviceId, ws)
    registry.updateDeviceSeen(decoded.deviceId, decoded.battery)

    if (device.sessionId) {
      const frame = packetToMotionFrame(decoded, 'esp32-ws')
      registry.broadcastToSession(device.sessionId, { type: 'motion_frame', frame } as ServerResponse)
    }

    return decoded.deviceId
  } catch {
    return null
  }
}
