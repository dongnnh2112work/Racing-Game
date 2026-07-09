import { useEffect, useRef } from 'react'
import { motionManager, CameraProvider } from '@howls/motion-sdk'
import { useMotionStore } from '../store/motion-store'
import { useStore } from '../store'

function drawOverlay(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  left: Array<{ x: number; y: number }> | null,
  right: Array<{ x: number; y: number }> | null,
) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const width = video.clientWidth || video.videoWidth || 320
  const height = video.clientHeight || video.videoHeight || 240
  if (width <= 0 || height <= 0) return

  canvas.width = width
  canvas.height = height
  ctx.clearRect(0, 0, width, height)

  const cx = width / 2
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)'
  ctx.lineWidth = 2
  ctx.setLineDash([5, 4])
  ctx.beginPath()
  ctx.moveTo(cx, 0)
  ctx.lineTo(cx, height)
  ctx.stroke()
  ctx.setLineDash([])

  const drawHand = (landmarks: Array<{ x: number; y: number }>, color: string) => {
    for (const lm of landmarks) {
      ctx.beginPath()
      ctx.arc(lm.x * width, lm.y * height, 3.5, 0, Math.PI * 2)
      ctx.fillStyle = color
      ctx.fill()
    }
    if (landmarks.length > 0) {
      const wrist = landmarks[0]
      ctx.beginPath()
      ctx.arc(wrist.x * width, wrist.y * height, 7, 0, Math.PI * 2)
      ctx.strokeStyle = color
      ctx.lineWidth = 2
      ctx.stroke()
    }
  }

  if (left) drawHand(left, 'rgba(96, 165, 250, 0.95)')
  if (right) drawHand(right, 'rgba(251, 191, 36, 0.95)')

  if (left && right) {
    const l = left[0]
    const r = right[0]
    ctx.strokeStyle = 'rgba(250, 204, 21, 0.9)'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(l.x * width, l.y * height)
    ctx.lineTo(r.x * width, r.y * height)
    ctx.stroke()
  }
}

export function HandPreview() {
  const useMock = useStore((s) => s.racingInputConfig.useMock)
  const handCount = useStore((s) => s.handTrackingHands)
  const activeInputSource = useStore((s) => s.activeInputSource)
  const leftFrame = useMotionStore((s) => s.frames['camera-left'])
  const rightFrame = useMotionStore((s) => s.frames['camera-right'])
  const cameraStatus = useMotionStore((s) => s.connectionStatus['camera-session'])
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (useMock) return

    const attachVideo = () => {
      const provider = motionManager.getProvider('camera-session') as CameraProvider | undefined
      const srcVideo = provider?.getVideoElement()
      const dest = videoRef.current
      if (!srcVideo?.srcObject || !dest) return false
      if (dest.srcObject !== srcVideo.srcObject) {
        dest.srcObject = srcVideo.srcObject
        void dest.play().catch(() => {})
      }
      return true
    }

    if (!attachVideo()) {
      const timer = setInterval(() => {
        if (attachVideo()) clearInterval(timer)
      }, 300)
      return () => clearInterval(timer)
    }
  }, [useMock, cameraStatus?.state])

  useEffect(() => {
    if (useMock) return
    let raf = 0
    const tick = () => {
      const video = videoRef.current
      const canvas = canvasRef.current
      if (video && canvas) {
        const left = leftFrame?.payload.type === 'landmarks' ? leftFrame.payload.landmarks.map((l) => ({ x: l.x, y: l.y })) : null
        const right = rightFrame?.payload.type === 'landmarks' ? rightFrame.payload.landmarks.map((l) => ({ x: l.x, y: l.y })) : null
        drawOverlay(canvas, video, left, right)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [useMock, leftFrame, rightFrame])

  if (useMock) {
    return (
      <div className="hand-preview">
        <div className="hand-preview-label">Camera tắt — đang dùng MockProvider</div>
        <div className="hand-preview-hint">Tắt &quot;Use MockProvider&quot; trong Settings (phím O) rồi tải lại trang</div>
      </div>
    )
  }

  const status =
    handCount >= 2 && activeInputSource === 'hands'
      ? '• 2 tay • tracking'
      : handCount >= 2
      ? '• 2 tay • giữ ngang'
      : handCount === 1
      ? '• 1 tay • cần 2 tay'
      : cameraStatus?.state === 'connected'
      ? '• đang tìm tay...'
      : '• đang mở camera...'

  return (
    <div className="hand-preview">
      <div className="hand-preview-media">
        <video ref={videoRef} playsInline muted />
        <canvas ref={canvasRef} className="hand-preview-overlay" />
      </div>
      <div className="hand-preview-label">Camera {status}</div>
    </div>
  )
}
