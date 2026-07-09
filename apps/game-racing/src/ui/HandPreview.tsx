import { useStore } from '../store'

export function HandPreview() {
  const handCount = useStore((s) => s.handTrackingHands)
  const activeInputSource = useStore((s) => s.activeInputSource)

  if (activeInputSource !== 'hands') return null

  const status = handCount >= 2 ? '• 2 tay • tracking' : handCount === 1 ? '• 1 tay • cần 2 tay' : '• chưa thấy tay'

  return (
    <div className="hand-preview">
      <div className="hand-preview-label">Camera {status}</div>
      <div className="hand-preview-hint">MediaPipe runs in Web Worker via CameraProvider</div>
    </div>
  )
}
