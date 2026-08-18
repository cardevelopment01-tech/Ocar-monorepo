export interface MaintenanceState {
  isUnderMaintenance: boolean
  message?: string
  retryAfterSeconds?: number
}

let state: MaintenanceState = { isUnderMaintenance: false }
const listeners = new Set<(state: MaintenanceState) => void>()

export function getMaintenanceState(): MaintenanceState {
  return state
}

export function setMaintenance(next: MaintenanceState): void {
  state = next
  listeners.forEach(listener => listener(state))
}

export function subscribeMaintenance(listener: (state: MaintenanceState) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
