import type { PublicApi } from '@react-three/cannon'

/** Waypoints dọc theo đường chính (x, z) — xấp xỉ layout map */
export const trackWaypoints: ReadonlyArray<readonly [number, number]> = [
  [-110, 220],
  [-85, 215],
  [-60, 200],
  [-27, 180],
  [0, 172],
  [15, 155],
  [10, 120],
  [0, 80],
  [-25, 40],
  [-50, -5],
  [-75, -50],
  [-95, -100],
  [-104, -150],
  [-104, -189],
]

export type TrackRecovery = {
  x: number
  z: number
  yaw: number
  segmentIndex: number
}

export function getNearestTrackRecovery(px: number, pz: number): TrackRecovery {
  let bestDist = Infinity
  let bestX = px
  let bestZ = pz
  let bestYaw = 0
  let bestIndex = 0

  for (let i = 0; i < trackWaypoints.length - 1; i++) {
    const [x1, z1] = trackWaypoints[i]
    const [x2, z2] = trackWaypoints[i + 1]
    const dx = x2 - x1
    const dz = z2 - z1
    const len2 = dx * dx + dz * dz
    if (len2 <= 0) continue

    const t = Math.max(0, Math.min(1, ((px - x1) * dx + (pz - z1) * dz) / len2))
    const nx = x1 + t * dx
    const nz = z1 + t * dz
    const dist = (px - nx) ** 2 + (pz - nz) ** 2

    if (dist < bestDist) {
      bestDist = dist
      bestX = nx
      bestZ = nz
      bestYaw = Math.atan2(dz, dx)
      bestIndex = i
    }
  }

  return { x: bestX, z: bestZ, yaw: bestYaw, segmentIndex: bestIndex }
}

export function recoverVehicleToTrack(api: PublicApi, px: number, py: number, pz: number): void {
  const recovery = getNearestTrackRecovery(px, pz)
  api.position.set(recovery.x, py, recovery.z)
  api.rotation.set(0, recovery.yaw, 0)
  api.velocity.set(0, 0, 0)
  api.angularVelocity.set(0, 0, 0)
}
