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

self.onmessage = async (event: MessageEvent) => {
  const { type, data } = event.data as { type: string; data?: unknown }

  if (type === 'init') {
    const vision = await FilesetResolver.forVisionTasks(WASM_PATH)
    landmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL_PATH, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numHands: 2,
    })
    self.postMessage({ type: 'ready' })
    return
  }

  if (type === 'detect' && landmarker) {
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
    let left: WorkerLandmark[] | null = null
    let right: WorkerLandmark[] | null = null
    const allLandmarks: WorkerLandmark[][] = []

    for (let i = 0; i < result.landmarks.length; i++) {
      const landmarks = result.landmarks[i].map((lm) => ({
        x: lm.x,
        y: lm.y,
        z: lm.z,
        visibility: lm.visibility,
      }))
      allLandmarks.push(landmarks)
      const label = result.handednesses[i]?.[0]?.categoryName
      if (label === 'Left') left = landmarks
      if (label === 'Right') right = landmarks
    }

    const payload: WorkerHandResult = { left, right, allLandmarks }
    self.postMessage({ type: 'result', data: payload })
  }
}

export {}
