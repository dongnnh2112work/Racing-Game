import type { MotionFrame, ProviderType } from './types'
import type { MotionProvider, ProviderStatus } from './provider'

type FrameCallback = (frame: MotionFrame) => void

export class MotionManager {
  private providers = new Map<string, MotionProvider>()
  private latestFrames = new Map<string, MotionFrame>()
  private subscribers = new Map<string, Set<FrameCallback>>()
  private unsubscribers = new Map<string, () => void>()

  register(provider: MotionProvider): void {
    if (this.providers.has(provider.id)) {
      this.unregister(provider.id)
    }
    this.providers.set(provider.id, provider)
    const unsub = provider.onFrame((frame) => {
      this.latestFrames.set(frame.deviceId, frame)
      const subs = this.subscribers.get(frame.deviceId)
      if (subs) {
        for (const cb of subs) cb(frame)
      }
    })
    this.unsubscribers.set(provider.id, unsub)
  }

  unregister(deviceId: string): void {
    const provider = this.providers.get(deviceId)
    if (!provider) return
    this.unsubscribers.get(deviceId)?.()
    this.unsubscribers.delete(deviceId)
    provider.disconnect()
    this.providers.delete(deviceId)
    this.latestFrames.delete(deviceId)
    this.subscribers.delete(deviceId)
  }

  subscribe(deviceId: string, callback: FrameCallback): () => void {
    if (!this.subscribers.has(deviceId)) {
      this.subscribers.set(deviceId, new Set())
    }
    this.subscribers.get(deviceId)!.add(callback)
    const latest = this.latestFrames.get(deviceId)
    if (latest) callback(latest)
    return () => {
      this.subscribers.get(deviceId)?.delete(callback)
    }
  }

  getLatestFrame(deviceId: string): MotionFrame | undefined {
    return this.latestFrames.get(deviceId)
  }

  listConnectedDevices(): Array<{ deviceId: string; type: ProviderType; status: ProviderStatus }> {
    return [...this.providers.values()].map((p) => ({
      deviceId: p.id,
      type: p.type,
      status: p.getStatus(),
    }))
  }

  getProvider(deviceId: string): MotionProvider | undefined {
    return this.providers.get(deviceId)
  }

  disconnectAll(): void {
    for (const id of [...this.providers.keys()]) {
      this.unregister(id)
    }
  }
}

export const motionManager = new MotionManager()
