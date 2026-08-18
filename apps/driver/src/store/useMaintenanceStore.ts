import { create } from 'zustand'

interface MaintenanceState {
  isUnderMaintenance: boolean
  message?: string
  retryAfterSeconds?: number

  setMaintenance: (next: { isUnderMaintenance: boolean; message?: string; retryAfterSeconds?: number }) => void
}

// No persist middleware — re-check fresh every load rather than sticking
// around stale in localStorage.
export const useMaintenanceStore = create<MaintenanceState>()((set) => ({
  isUnderMaintenance: false,

  setMaintenance: (next) => set(next),
}))
