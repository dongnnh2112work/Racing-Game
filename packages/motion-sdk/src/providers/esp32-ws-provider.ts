import type { MotionFrame, ServerMessage, ServerResponse } from '../types'
import type { MotionProvider, ProviderStatus } from '../provider'

export type Esp32WsProviderOptions = {
  serverUrl: string
  sessionId: string
  deviceIds: string[]
}

export class Esp32WsProvider implements MotionProvider {
  readonly type = 'esp32-ws' as const
  readonly id: string
  private ws: WebSocket | null = null
  private status: ProviderStatus = { state: 'idle' }
  private frameCallbacks = new Set<(frame: MotionFrame) => void>()
  private statusCallbacks = new Set<(status: ProviderStatus) => void>()
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectDelay = 1000

  constructor(private options: Esp32WsProviderOptions, primaryDeviceId?: string) {
    this.id = primaryDeviceId ?? options.deviceIds[0] ?? 'esp32-ws-session'
  }

  async connect(): Promise<void> {
    this.setStatus({ state: 'connecting' })
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.options.serverUrl)
        this.ws.binaryType = 'arraybuffer'

        this.ws.onopen = () => {
          this.reconnectDelay = 1000
          this.send({ type: 'subscribe_session', sessionId: this.options.sessionId })
          this.setStatus({ state: 'connected' })
          resolve()
        }

        this.ws.onmessage = (event) => {
          if (typeof event.data !== 'string') return
          try {
            const msg = JSON.parse(event.data) as ServerResponse
            if (msg.type === 'motion_frame' && this.options.deviceIds.includes(msg.frame.deviceId)) {
              for (const cb of this.frameCallbacks) cb(msg.frame)
            }
          } catch {
            // ignore malformed
          }
        }

        this.ws.onerror = () => {
          this.setStatus({ state: 'error', message: 'WebSocket error' })
          reject(new Error('WebSocket connection failed'))
        }

        this.ws.onclose = () => {
          this.setStatus({ state: 'disconnected', reason: 'connection closed' })
          this.scheduleReconnect()
        }
      } catch (err) {
        reject(err)
      }
    })
  }

  disconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.ws?.close()
    this.ws = null
    this.setStatus({ state: 'disconnected' })
  }

  send(message: ServerMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message))
    }
  }

  onFrame(callback: (frame: MotionFrame) => void): () => void {
    this.frameCallbacks.add(callback)
    return () => this.frameCallbacks.delete(callback)
  }

  getStatus(): ProviderStatus {
    return this.status
  }

  onStatusChange(callback: (status: ProviderStatus) => void): () => void {
    this.statusCallbacks.add(callback)
    callback(this.status)
    return () => this.statusCallbacks.delete(callback)
  }

  private setStatus(status: ProviderStatus): void {
    this.status = status
    for (const cb of this.statusCallbacks) cb(status)
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      void this.connect().catch(() => {
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, 10000)
        this.scheduleReconnect()
      })
    }, this.reconnectDelay)
  }
}

export async function createSession(serverUrl: string, sessionId: string, requiredSlots: string[]): Promise<ServerResponse & { type: 'session_created' }> {
  const ws = new WebSocket(serverUrl)
  return new Promise((resolve, reject) => {
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'create_session', sessionId, requiredSlots } as ServerMessage))
    }
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data as string) as ServerResponse
      if (msg.type === 'session_created') {
        ws.close()
        resolve(msg)
      } else if (msg.type === 'error') {
        ws.close()
        reject(new Error(msg.message))
      }
    }
    ws.onerror = () => reject(new Error('Failed to create session'))
  })
}

export function openPairingSocket(serverUrl: string, onMessage: (msg: ServerResponse) => void): WebSocket {
  const ws = new WebSocket(serverUrl)
  ws.onmessage = (event) => {
    try {
      onMessage(JSON.parse(event.data as string) as ServerResponse)
    } catch {
      // ignore
    }
  }
  return ws
}
