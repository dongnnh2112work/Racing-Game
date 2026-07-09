import type { UnclaimedDevice } from '@howls/motion-sdk'

export function UnclaimedDeviceList({
  devices,
  onIdentify,
  onClaim,
}: {
  devices: UnclaimedDevice[]
  onIdentify: (deviceId: string) => void
  onClaim: (deviceId: string) => void
}) {
  if (devices.length === 0) return <p>No unclaimed devices.</p>
  return (
    <ul className="unclaimed-list">
      {devices.map((d) => (
        <li key={d.deviceId}>
          <span>{d.deviceId}</span>
          <button type="button" onClick={() => onIdentify(d.deviceId)}>
            Identify
          </button>
          <button type="button" onClick={() => onClaim(d.deviceId)}>
            Claim
          </button>
        </li>
      ))}
    </ul>
  )
}
