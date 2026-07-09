import { useStore } from '../store'

const WHEEL_SIZE = 220
const CX = WHEEL_SIZE / 2
const CY = WHEEL_SIZE / 2
const RADIUS = 88

export function VirtualSteeringWheel() {
  const activeInputSource = useStore((s) => s.activeInputSource)
  const handWheelRotation = useStore((s) => s.handWheelRotation)
  const steering = useStore((s) => s.steering)

  if (activeInputSource !== 'hands') return null

  const rotationDeg = (-handWheelRotation * 180) / Math.PI

  return (
    <div className="virtual-steering-wheel" aria-hidden>
      <svg width={WHEEL_SIZE} height={WHEEL_SIZE} viewBox={`0 0 ${WHEEL_SIZE} ${WHEEL_SIZE}`}>
        <line x1={CX} y1={12} x2={CX} y2={WHEEL_SIZE - 12} className="virtual-wheel-ref-line" />
        <g transform={`rotate(${rotationDeg} ${CX} ${CY})`}>
          <circle cx={CX} cy={CY} r={RADIUS} className="virtual-wheel-rim" />
          <circle cx={CX} cy={CY} r={RADIUS - 18} className="virtual-wheel-inner" />
          <rect x={CX - 14} y={CY - RADIUS + 6} width={28} height={22} rx={6} className="virtual-wheel-grip" />
          <rect x={CX - 14} y={CY + RADIUS - 28} width={28} height={22} rx={6} className="virtual-wheel-grip" />
          <line x1={CX - RADIUS + 10} y1={CY} x2={CX + RADIUS - 10} y2={CY} className="virtual-wheel-spoke" />
        </g>
      </svg>
      <div className="virtual-wheel-steer">{steering.toFixed(2)}</div>
    </div>
  )
}
