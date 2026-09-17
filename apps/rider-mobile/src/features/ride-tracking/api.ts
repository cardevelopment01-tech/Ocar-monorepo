import { camelizeKeys } from '@ocar/mobile-shared'
import { api } from '@/services/api'
import type { RideDetailExtra } from './types'

export async function fetchRide(rideId: string): Promise<RideDetailExtra> {
  const res = await api.get(`/api/v1/rides/${rideId}`)
  return camelizeKeys<RideDetailExtra>(res.data)
}

// GET /rides/me/active-user 404s when there's no active ride -- that's the expected
// "nothing to recover" outcome here, not an error worth surfacing.
export async function fetchActiveRideId(): Promise<string | null> {
  try {
    const res = await api.get<{ rideId: string }>('/api/v1/rides/me/active-user')
    return res.data.rideId
  } catch {
    return null
  }
}
