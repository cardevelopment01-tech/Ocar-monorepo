import { camelizeKeys, type RideDetail } from '@ocar/mobile-shared'
import { api } from '@/services/api'

export async function fetchRide(rideId: string): Promise<RideDetail> {
  const res = await api.get(`/api/v1/rides/${rideId}`)
  return camelizeKeys<RideDetail>(res.data)
}

export async function markArrived(rideId: string): Promise<void> {
  await api.post(`/api/v1/rides/${rideId}/arrived`)
}

export async function submitStartOtp(rideId: string, otp: string): Promise<void> {
  await api.post(`/api/v1/rides/${rideId}/start-otp`, { otp })
}

// end-otp's body is snake_case (actual_distance_km etc.) unlike most other
// endpoints -- confirmed directly against rides.routes.ts, not assumed. Only
// `otp` is sent this phase; the actual_* reconciliation fields are optional
// and specific to round-trip GPS reconciliation, out of this phase's scope.
export async function submitEndOtp(rideId: string, otp: string): Promise<void> {
  await api.post(`/api/v1/rides/${rideId}/end-otp`, { otp })
}

export type CashCollectionResult = { collected: number; discrepancy: boolean }

export async function submitCashCollection(
  rideId: string,
  input: { collectedAmount?: number; notCollected?: boolean; note?: string }
): Promise<CashCollectionResult> {
  const res = await api.post(`/api/v1/rides/${rideId}/collect-cash`, input)
  return camelizeKeys<CashCollectionResult>(res.data)
}
