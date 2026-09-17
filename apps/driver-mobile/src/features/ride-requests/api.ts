import { camelizeKeys, type RideDetail } from '@ocar/mobile-shared'
import { api } from '@/services/api'

export type AcceptRideResult = {
  success: boolean
  rideId: string
  ride: RideDetail | null
}

export async function acceptRideRequest(rideId: string): Promise<AcceptRideResult> {
  const res = await api.post(`/api/v1/rides/${rideId}/accept`)
  return camelizeKeys<AcceptRideResult>(res.data)
}
