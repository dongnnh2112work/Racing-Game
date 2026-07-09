/* Camera MediaPipe worker — classic worker (MediaPipe uses importScripts internally) */
const MEDIAPIPE_VERSION = '0.10.36-rc.20260613'
const MEDIAPIPE_BUNDLE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/vision_bundle.js`
const WASM_PATH = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`
const MODEL_PATH = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'

importScripts(MEDIAPIPE_BUNDLE)

const { FilesetResolver, HandLandmarker } = self.Vision

let landmarker = null
let lastVideoTime = -1

async function createLandmarker() {
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

function assignHandsByPosition(allLandmarks) {
  if (allLandmarks.length === 0) return { left: null, right: null }
  if (allLandmarks.length === 1) {
    const wrist = allLandmarks[0][0]
    if (wrist.x < 0.5) return { left: allLandmarks[0], right: null }
    return { left: null, right: allLandmarks[0] }
  }
  const sorted = [...allLandmarks].sort((a, b) => a[0].x - b[0].x)
  return { left: sorted[0], right: sorted[sorted.length - 1] }
}

self.onmessage = async (event) => {
  const { type, data } = event.data

  if (type === 'init') {
    try {
      landmarker = await createLandmarker()
      self.postMessage({ type: 'ready' })
    } catch (error) {
      self.postMessage({ type: 'error', message: error?.message || String(error) })
    }
    return
  }

  if (type === 'detect' && landmarker) {
    try {
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
      const allLandmarks = []

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
      self.postMessage({ type: 'result', data: { left, right, allLandmarks } })
    } catch (error) {
      self.postMessage({ type: 'error', message: error?.message || String(error) })
    }
  }
}
