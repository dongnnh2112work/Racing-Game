import type { RacingSlotId } from '@howls/motion-sdk'

export function SlotAssignUI({ slots, onAssign }: { slots: Record<RacingSlotId, string | null>; onAssign: (slotId: RacingSlotId, deviceId: string) => void }) {
  return (
    <div className="slot-assign">
      {(Object.keys(slots) as RacingSlotId[]).map((slotId) => (
        <div key={slotId} className="slot-row">
          <label>{slotId}</label>
          <span>{slots[slotId] ?? '—'}</span>
        </div>
      ))}
    </div>
  )
}
