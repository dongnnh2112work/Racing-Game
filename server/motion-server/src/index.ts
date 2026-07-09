import { WebSocketServer, WebSocket } from 'ws'
import type { ServerMessage } from './protocol'
import { SessionRegistry } from './session-registry'
import { handleBrowserMessage, handleEsp32Binary } from './pairing-handler'

const PORT = Number(process.env.MOTION_SERVER_PORT ?? 8080)

export function createMotionServer(port = PORT): WebSocketServer {
  const registry = new SessionRegistry()
  const wss = new WebSocketServer({ port })

  console.log(`Motion Server listening on ws://localhost:${port}`)

  wss.on('connection', (ws, req) => {
    const isEsp32 = req.url?.includes('/device') ?? false
    const sessionIdRef = { current: null as string | null }
    let esp32DeviceId: string | null = null

    ws.on('message', (raw) => {
      if (raw instanceof Buffer && (isEsp32 || raw.byteLength === 32)) {
        esp32DeviceId = handleEsp32Binary(registry, ws, raw)
        if (esp32DeviceId) registry.broadcastUnclaimed()
        return
      }

      try {
        const message = JSON.parse(raw.toString()) as ServerMessage
        handleBrowserMessage(registry, ws, message, sessionIdRef)
      } catch {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid message' }))
      }
    })

    ws.on('close', () => {
      if (sessionIdRef.current) {
        registry.unsubscribeBrowser(sessionIdRef.current, ws)
      }
      if (esp32DeviceId) {
        registry.markDeviceDisconnected(esp32DeviceId)
        registry.broadcastUnclaimed()
      }
    })
  })

  return wss
}

if (require.main === module) {
  createMotionServer()
}
