import { client } from '@/db/redis'

const MAINTENANCE_KEY = 'ocar:maintenance'

export interface MaintenanceStatus {
  enabled: boolean
  message?: string
  retryAfterSeconds?: number
}

export async function getMaintenanceStatus(): Promise<MaintenanceStatus> {
  const raw = await client.get(MAINTENANCE_KEY)
  if (!raw) return { enabled: false }
  return JSON.parse(raw) as MaintenanceStatus
}

// No TTL — this must persist until explicitly cleared, not expire mid-maintenance.
export async function setMaintenanceStatus(status: MaintenanceStatus): Promise<void> {
  await client.set(MAINTENANCE_KEY, JSON.stringify(status))
}
