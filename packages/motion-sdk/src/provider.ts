import type { ProviderType } from './types'

export type ProviderStatus =
  | { state: 'idle' }
  | { state: 'connecting' }
  | { state: 'connected' }
  | { state: 'error'; message: string }
  | { state: 'disconnected'; reason?: string }

export interface MotionProvider {
  readonly id: string
  readonly type: ProviderType

  connect(): Promise<void>
  disconnect(): void

  onFrame(callback: (frame: import('./types').MotionFrame) => void): () => void
  getStatus(): ProviderStatus
  onStatusChange(callback: (status: ProviderStatus) => void): () => void
}
