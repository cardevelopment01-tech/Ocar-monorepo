import axios from 'axios'
import { camelizeKeys, type RideDetail } from '@ocar/mobile-shared'
import { api } from '@/services/api'
import type { RelaunchRideSummary } from './relaunchRouting'
import type { RideStatus } from './reducer'

// GET /rides/me/active responds 404 when there's no active ride (unlike
// /sessions/current's 200-with-null convention) -- a 404 means "nothing to
// recover" and resolves to null; any other failure (network/500) must
// propagate so the caller can distinguish "no ride" from "couldn't check"
// (Eng review HIGH-severity finding).
export async function fetchActiveRideForRelaunch(): Promise<RelaunchRideSummary> {
  try {
    const res = await api.get('/api/v1/rides/me/active')
    const ride = camelizeKeys<RideDetail>(res.data)
    return { id: ride.id, status: ride.status as RideStatus }
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 404) return null
    throw err
  }
}
