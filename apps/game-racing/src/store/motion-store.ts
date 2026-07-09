import create from 'zustand'
import type { MotionFrame, ProviderStatus, SlotAssignments } from '@howls/motion-sdk'

interface MotionStoreState {
  frames: Record<string, MotionFrame | null>
  connectionStatus: Record<string, ProviderStatus>
  slotAssignments: SlotAssignments | null
  pairingComplete: boolean
  sessionId: string | null
  setFrame: (deviceId: string, frame: MotionFrame) => void
  setStatus: (deviceId: string, status: ProviderStatus) => void
  setSlotAssignments: (assignments: SlotAssignments) => void
  setPairingComplete: (complete: boolean) => void
  setSessionId: (id: string) => void
}

export const useMotionStore = create<MotionStoreState>((set) => ({
  frames: {},
  connectionStatus: {},
  slotAssignments: null,
  pairingComplete: false,
  sessionId: null,
  setFrame: (deviceId, frame) =>
    set((state) => ({
      frames: { ...state.frames, [deviceId]: frame },
    })),
  setStatus: (deviceId, status) =>
    set((state) => ({
      connectionStatus: { ...state.connectionStatus, [deviceId]: status },
    })),
  setSlotAssignments: (assignments) => set({ slotAssignments: assignments }),
  setPairingComplete: (complete) => set({ pairingComplete: complete }),
  setSessionId: (id) => set({ sessionId: id }),
}))

export const getMotionState = useMotionStore.getState
