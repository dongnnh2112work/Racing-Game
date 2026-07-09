import type { MotionFrame } from '../types'
import type { MotionProvider, ProviderStatus } from '../provider'

export class MockProvider implements MotionProvider {
  readonly type = 'mock' as const
  private status: ProviderStatus = { state: 'idle' }
  private frameCallbacks = new Set<(frame: MotionFrame) => void>()
  private statusCallbacks = new Set<(status: ProviderStatus) => void>()
  private intervalId: ReturnType<typeof setInterval> | null = null
  private t = 0

  constructor(readonly id: string, private mode: 'orientation' | 'landmarks' = 'orientation', private handedness?: 'Left' | 'Right') {}

  async connect(): Promise<void> {
    this.setStatus({ state: 'connecting' })
    this.setStatus({ state: 'connected' })
    this.intervalId = setInterval(() => {
      this.t += 0.05
      this.emitFrame()
    }, 16)
  }

  disconnect(): void {
    if (this.intervalId) clearInterval(this.intervalId)
    this.intervalId = null
    this.setStatus({ state: 'disconnected' })
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

  private emitFrame(): void {
    const frame: MotionFrame =
      this.mode === 'orientation'
        ? {
            deviceId: this.id,
            providerType: 'mock',
            timestamp: Date.now(),
            confidence: 0.9,
            payload: {
              type: 'orientation',
              quaternion: {
                w: Math.cos(this.t * 0.5),
                x: 0,
                y: Math.sin(this.t * 0.5) * 0.3,
                z: 0,
              },
              angularVelocity: { x: 0, y: Math.sin(this.t) * 2, z: 0 },
              battery: 80,
            },
          }
        : {
            deviceId: this.id,
            providerType: 'mock',
            timestamp: Date.now(),
            confidence: 0.85,
            payload: {
              type: 'landmarks',
              landmarkSetType: 'hand',
              handedness: this.handedness ?? 'Left',
              landmarks: Array.from({ length: 21 }, (_, i) => ({
                x: 0.3 + (this.handedness === 'Right' ? 0.4 : 0) + Math.sin(this.t + i * 0.1) * 0.02,
                y: 0.5 + Math.sin(this.t * 0.8 + i * 0.05) * 0.05,
                z: 0,
                visibility: 0.9,
              })),
            },
          }

    for (const cb of this.frameCallbacks) cb(frame)
  }
}
