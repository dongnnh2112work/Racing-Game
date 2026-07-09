/* Camera MediaPipe worker — served from /public/camera-worker.js */
import { FilesetResolver, HandLandmarker } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/+esm'

const WASM_PATH = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
const MODEL_PATH = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'

let landmarker = null
let lastVideoTime = -1

self.onmessage = async (event) => {
  const { type, data } = event.data

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
    const { bitmap, timestamp, width, height } = data
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
    let left = null
    let right = null
    const allLandmarks = []

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

    self.postMessage({ type: 'result', data: { left, right, allLandmarks } })
  }
}
