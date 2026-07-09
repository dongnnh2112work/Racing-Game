export type DeviceRecord = {
  deviceId: string
  connectionType: 'esp32-ws'
  status: 'idle' | 'claimed' | 'connected' | 'disconnected'
  sessionId: string | null
  slotId: string | null
  lastSeenAt: number
  battery: number | null
  ws: import('ws').WebSocket | null
}

export type GameSession = {
  sessionId: string
  requiredSlots: string[]
  slots: Record<string, string | null>
  createdAt: number
  browserSockets: Set<import('ws').WebSocket>
}

export class SessionRegistry {
  private devices = new Map<string, DeviceRecord>()
  private sessions = new Map<string, GameSession>()
  private readonly disconnectTimeoutMs = 5 * 60 * 1000

  createSession(sessionId: string, requiredSlots: string[]): GameSession {
    const slots: Record<string, string | null> = {}
    for (const slot of requiredSlots) slots[slot] = null
    const session: GameSession = {
      sessionId,
      requiredSlots,
      slots,
      createdAt: Date.now(),
      browserSockets: new Set(),
    }
    this.sessions.set(sessionId, session)
    return session
  }

  getSession(sessionId: string): GameSession | undefined {
    return this.sessions.get(sessionId)
  }

  endSession(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    for (const deviceId of Object.values(session.slots)) {
      if (deviceId) this.releaseDevice(deviceId)
    }
    for (const ws of session.browserSockets) ws.close()
    this.sessions.delete(sessionId)
  }

  registerDevice(deviceId: string, ws: import('ws').WebSocket): DeviceRecord {
    const existing = this.devices.get(deviceId)
    const record: DeviceRecord = {
      deviceId,
      connectionType: 'esp32-ws',
      status: 'connected',
      sessionId: existing?.sessionId ?? null,
      slotId: existing?.slotId ?? null,
      lastSeenAt: Date.now(),
      battery: existing?.battery ?? null,
      ws,
    }
    this.devices.set(deviceId, record)
    return record
  }

  updateDeviceSeen(deviceId: string, battery: number | null): void {
    const device = this.devices.get(deviceId)
    if (!device) return
    device.lastSeenAt = Date.now()
    device.status = device.sessionId ? 'claimed' : 'connected'
    if (battery !== null) device.battery = battery
  }

  markDeviceDisconnected(deviceId: string): void {
    const device = this.devices.get(deviceId)
    if (!device) return
    device.status = 'disconnected'
    device.ws = null
    setTimeout(() => {
      const d = this.devices.get(deviceId)
      if (d && d.status === 'disconnected' && Date.now() - d.lastSeenAt > this.disconnectTimeoutMs) {
        this.releaseDevice(deviceId)
      }
    }, this.disconnectTimeoutMs)
  }

  getUnclaimedDevices(): DeviceRecord[] {
    return [...this.devices.values()].filter((d) => !d.sessionId && d.status !== 'disconnected')
  }

  claimSlot(sessionId: string, slotId: string, deviceId: string): { ok: boolean; slots?: Record<string, string | null>; error?: string } {
    const session = this.sessions.get(sessionId)
    const device = this.devices.get(deviceId)
    if (!session) return { ok: false, error: 'Session not found' }
    if (!device) return { ok: false, error: 'Device not found' }
    if (device.sessionId && device.sessionId !== sessionId) return { ok: false, error: 'Device already claimed' }
    if (!(slotId in session.slots)) return { ok: false, error: 'Invalid slot' }

    for (const [s, d] of Object.entries(session.slots)) {
      if (d === deviceId) session.slots[s] = null
    }

    session.slots[slotId] = deviceId
    device.sessionId = sessionId
    device.slotId = slotId
    device.status = 'claimed'
    return { ok: true, slots: { ...session.slots } }
  }

  isSessionReady(sessionId: string): boolean {
    const session = this.sessions.get(sessionId)
    if (!session) return false
    return session.requiredSlots.every((slot) => session.slots[slot] !== null)
  }

  getDeviceForSession(sessionId: string, deviceId: string): boolean {
    const session = this.sessions.get(sessionId)
    if (!session) return false
    return Object.values(session.slots).includes(deviceId)
  }

  releaseDevice(deviceId: string): void {
    const device = this.devices.get(deviceId)
    if (!device) return
    if (device.sessionId) {
      const session = this.sessions.get(device.sessionId)
      if (session) {
        for (const [slot, id] of Object.entries(session.slots)) {
          if (id === deviceId) session.slots[slot] = null
        }
      }
    }
    device.sessionId = null
    device.slotId = null
    if (device.ws) device.status = 'connected'
    else device.status = 'disconnected'
  }

  subscribeBrowser(sessionId: string, ws: import('ws').WebSocket): void {
    const session = this.sessions.get(sessionId)
    session?.browserSockets.add(ws)
  }

  unsubscribeBrowser(sessionId: string, ws: import('ws').WebSocket): void {
    const session = this.sessions.get(sessionId)
    session?.browserSockets.delete(ws)
  }

  broadcastToSession(sessionId: string, message: unknown): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    const data = JSON.stringify(message)
    for (const ws of session.browserSockets) {
      if (ws.readyState === ws.OPEN) ws.send(data)
    }
  }

  broadcastUnclaimed(): void {
    const devices = this.getUnclaimedDevices().map((d) => ({
      deviceId: d.deviceId,
      battery: d.battery,
      lastSeenAt: d.lastSeenAt,
    }))
    for (const session of this.sessions.values()) {
      this.broadcastToSession(session.sessionId, { type: 'unclaimed_devices', devices })
    }
  }

  sendControlToDevice(deviceId: string, cmd: 'identify' | 'calibrate'): boolean {
    const device = this.devices.get(deviceId)
    if (!device?.ws || device.ws.readyState !== device.ws.OPEN) return false
    device.ws.send(JSON.stringify({ cmd }))
    return true
  }
}
