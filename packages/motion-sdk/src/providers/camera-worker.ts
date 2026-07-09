/// <reference lib="webworker" />

import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'

const WASM_PATH = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
const MODEL_PATH = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'

export type WorkerLandmark = { x: number; y: number; z: number; visibility?: number }

export type WorkerHandResult = {
  left: WorkerLandmark[] | null
  right: WorkerLandmark[] | null
  allLandmarks: WorkerLandmark[][]
}

let landmarker: HandLandmarker | null = null
let lastVideoTime = -1

async function createLandmarker(): Promise<HandLandmarker> {
  const vision = await FilesetResolver.forVisionTasks(WASM_PATH)
  try {
    return await HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL_PATH, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numHands: 2,
    })
  } catch {
    return await HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL_PATH, delegate: 'CPU' },
      runningMode: 'VIDEO',
      numHands: 2,
    })
  }
}

function assignHandsByPosition(allLandmarks: WorkerLandmark[][]): Pick<WorkerHandResult, 'left' | 'right'> {
  if (allLandmarks.length === 0) return { left: null, right: null }
  if (allLandmarks.length === 1) {
    const wrist = allLandmarks[0][0]
    if (wrist.x < 0.5) return { left: allLandmarks[0], right: null }
    return { left: null, right: allLandmarks[0] }
  }
  const sorted = [...allLandmarks].sort((a, b) => a[0].x - b[0].x)
  return { left: sorted[0], right: sorted[sorted.length - 1] }
}

self.onmessage = async (event: MessageEvent) => {
  const { type, data } = event.data as { type: string; data?: unknown }

  if (type === 'init') {
    try {
      landmarker = await createLandmarker()
      self.postMessage({ type: 'ready' })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      self.postMessage({ type: 'error', message })
    }
    return
  }

  if (type === 'detect' && landmarker) {
    try {
      const { bitmap, timestamp, width, height } = data as {
        bitmap: ImageBitmap
        timestamp: number
        width: number
        height: number
      }
      if (timestamp === lastVideoTime) {
        bitmap.close()
        return
      }
      lastVideoTime = timestamp

      const offscreen = new OffscreenCanvas(width, height)
      const ctx = offscreen.getContext('2d')
      if (!ctx) {
        bitmap.close()
        return
      }
      ctx.drawImage(bitmap, 0, 0, width, height)
      bitmap.close()

      const result = landmarker.detectForVideo(offscreen, timestamp)
      const allLandmarks: WorkerLandmark[][] = []

      for (let i = 0; i < result.landmarks.length; i++) {
        allLandmarks.push(
          result.landmarks[i].map((lm) => ({
            x: lm.x,
            y: lm.y,
            z: lm.z,
            visibility: lm.visibility,
          })),
        )
      }

      const { left, right } = assignHandsByPosition(allLandmarks)
      const payload: WorkerHandResult = { left, right, allLandmarks }
      self.postMessage({ type: 'result', data: payload })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      self.postMessage({ type: 'error', message })
    }
  }
}

export {}
