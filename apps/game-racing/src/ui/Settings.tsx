import { useStore, setState } from '../store'
import { useMotionStore } from '../store/motion-store'
import { MOTION_SERVER_URL } from '../input/MotionRuntime'

const sourceLabels = {
  keyboard: 'Keyboard',
  hands: 'Hand Tracking',
  wheel: 'ESP32 Wheel',
} as const

export function Settings() {
  const [settings, actions, racingInputConfig, steering, activeInputSource, pairingComplete] = useStore((s) => [
    s.settings,
    s.actions,
    s.racingInputConfig,
    s.steering,
    s.activeInputSource,
    s.ready,
  ])
  const slotAssignments = useMotionStore((s) => s.slotAssignments)

  const updateConfig = (patch: Partial<typeof racingInputConfig>) => {
    setState((state) => ({ racingInputConfig: { ...state.racingInputConfig, ...patch } }))
  }

  return (
    <>
      <div className="settings-toggle">
        {!settings && (
          <button type="button" onClick={actions.settings} title="Input settings (O)">
            o
          </button>
        )}
      </div>
      {settings && (
        <div className="settings">
          <div className="settings-panel">
            <div className="settings-header">
              <h2>Input Settings</h2>
              <button type="button" onClick={actions.settings}>
                Close
              </button>
            </div>

            <section>
              <h3>Motion Platform</h3>
              <p>Server: {MOTION_SERVER_URL}</p>
              <p>Pairing: {pairingComplete ? 'Complete' : 'Pending'}</p>
              {slotAssignments && (
                <ul>
                  <li>Wheel: {slotAssignments.steering_wheel ?? '—'}</li>
                  <li>Left hand: {slotAssignments.left_hand ?? '—'}</li>
                  <li>Right hand: {slotAssignments.right_hand ?? '—'}</li>
                </ul>
              )}
              <label>
                <input type="checkbox" checked={racingInputConfig.useMock} onChange={(e) => updateConfig({ useMock: e.target.checked })} />
                Use MockProvider (dev, no hardware)
              </label>
            </section>

            <section>
              <h3>Steering</h3>
              <p>
                Active: {sourceLabels[activeInputSource]} ({steering.toFixed(2)})
              </p>
              <label>
                Deadzone
                <input
                  type="range"
                  min={0}
                  max={0.5}
                  step={0.01}
                  value={racingInputConfig.steeringDeadzone}
                  onChange={(e) => updateConfig({ steeringDeadzone: Number(e.target.value) })}
                />
              </label>
              <label>
                Sensitivity
                <input
                  type="range"
                  min={0.2}
                  max={2}
                  step={0.05}
                  value={racingInputConfig.steeringSensitivity}
                  onChange={(e) => updateConfig({ steeringSensitivity: Number(e.target.value) })}
                />
              </label>
              <label>
                <input type="checkbox" checked={racingInputConfig.steeringInvert} onChange={(e) => updateConfig({ steeringInvert: e.target.checked })} />
                Invert steering
              </label>
              <label>
                Hand max angle (deg)
                <input
                  type="range"
                  min={30}
                  max={120}
                  step={5}
                  value={racingInputConfig.handMaxAngleDeg}
                  onChange={(e) => updateConfig({ handMaxAngleDeg: Number(e.target.value) })}
                />
              </label>
              <button type="button" onClick={() => updateConfig({ wheelYawOffset: 0 })}>
                Reset wheel calibration
              </button>
            </section>
          </div>
        </div>
      )}
    </>
  )
}
