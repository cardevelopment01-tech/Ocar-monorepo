import { api } from '@/services/api'
import { useAuthStore } from '@/store/useAuthStore'

// The status screen is chosen from the driver saved at login, so it has to be re-read: a driver suspended or banned
// after they signed in would otherwise keep seeing Home. Best effort -- offline or a failed call keeps what is saved.
export async function refreshDriverProfile(): Promise<void> {
  try {
    const res = await api.get('/api/v1/drivers/me', { timeout: 8000 })
    const fresh = res.data?.driver as { status?: string; onboarding_step?: string; code?: string; full_name?: string | null } | undefined
    if (!fresh?.status) return
    const update: { status: string; onboarding_step?: string; code?: string; full_name?: string | null } = { status: fresh.status }
    if (fresh.onboarding_step !== undefined) update.onboarding_step = fresh.onboarding_step
    if (fresh.code !== undefined) update.code = fresh.code
    if (fresh.full_name !== undefined) update.full_name = fresh.full_name
    useAuthStore.getState().updateDriver(update)
  } catch {
    // 403 DRIVER_BANNED is picked up by the API interceptor (services/api) and flips the saved status itself.
  }
}
