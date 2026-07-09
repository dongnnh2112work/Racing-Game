import { CAMERA_LEFT_ID, CAMERA_RIGHT_ID } from '../types'
import type { MotionFrame } from '../types'
import type { MotionProvider, ProviderStatus } from '../provider'
import type { WorkerHandResult } from './camera-worker'

function wristElbowConfidence(landmarks: Array<{ visibility?: number }>): number {
  const vis = landmarks.slice(0, 5).map((l) => l.visibility ?? 0)
  if (vis.length === 0) return 0
  return vis.reduce((a, b) => a + b, 0) / vis.length
}

function toLandmarkFrame(
  deviceId: string,
  handedness: 'Left' | 'Right',
  landmarks: Array<{ x: number; y: number; z: number; visibility?: number }>,
): MotionFrame {
  return {
    deviceId,
    providerType: 'camera',
    timestamp: Date.now(),
    confidence: wristElbowConfidence(landmarks),
    payload: {
      type: 'landmarks',
      landmarkSetType: 'hand',
      handedness,
      landmarks,
    },
  }
}

export class CameraProvider implements MotionProvider {
  readonly type = 'camera' as const
  readonly id = 'camera-session'
  private status: ProviderStatus = { state: 'idle' }
  private frameCallbacks = new Set<(frame: MotionFrame) => void>()
  private statusCallbacks = new Set<(status: ProviderStatus) => void>()
  private video: HTMLVideoElement | null = null
  private worker: Worker | null = null
  private rafId = 0
  private latestResult: WorkerHandResult | null = null

  getVideoElement(): HTMLVideoElement | null {
    return this.video
  }

  getLatestHandResult(): WorkerHandResult | null {
    return this.latestResult
  }

  private createWorker(): Worker {
    return new Worker('/camera-worker.js', { type: 'module' })
  }

  async connect(): Promise<void> {
    this.setStatus({ state: 'connecting' })

    this.video = document.createElement('video')
    this.video.playsInline = true
    this.video.muted = true
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    })
    this.video.srcObject = stream
    await this.video.play()

    this.worker = this.createWorker()
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Camera worker init timeout')), 30000)
      this.worker!.onmessage = (event) => {
        if (event.data.type === 'ready') {
          clearTimeout(timeout)
          resolve()
        }
      }
      this.worker!.postMessage({ type: 'init' })
    })

    this.worker.onmessage = (event) => {
      if (event.data.type === 'result') {
        this.latestResult = event.data.data as WorkerHandResult
        this.emitFrames(this.latestResult)
      }
    }

    this.setStatus({ state: 'connected' })
    this.loop()
  }

  disconnect(): void {
    cancelAnimationFrame(this.rafId)
    this.worker?.terminate()
    this.worker = null
    if (this.video?.srcObject) {
      const tracks = (this.video.srcObject as MediaStream).getTracks()
      tracks.forEach((t) => t.stop())
    }
    this.video = null
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

  private loop = (): void => {
    this.rafId = requestAnimationFrame(this.loop)
    if (!this.video || !this.worker || this.video.readyState < 2) return
    const width = this.video.videoWidth
    const height = this.video.videoHeight
    if (width <= 0 || height <= 0) return

    createImageBitmap(this.video).then((bitmap) => {
      this.worker?.postMessage(
        {
          type: 'detect',
          data: { bitmap, timestamp: performance.now(), width, height },
        },
        [bitmap],
      )
    })
  }

  private emitFrames(result: WorkerHandResult): void {
    if (result.left) {
      const frame = toLandmarkFrame(CAMERA_LEFT_ID, 'Left', result.left)
      for (const cb of this.frameCallbacks) cb(frame)
    }
    if (result.right) {
      const frame = toLandmarkFrame(CAMERA_RIGHT_ID, 'Right', result.right)
      for (const cb of this.frameCallbacks) cb(frame)
    }
  }

  private setStatus(status: ProviderStatus): void {
    this.status = status
    for (const cb of this.statusCallbacks) cb(status)
  }
}
