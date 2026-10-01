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

// Tells the server this offer is dead so a reconnect within its window (app
// foreground/background, a network blip) doesn't replay it and restart the
// ringtone for a ride the driver already declined. Best-effort -- the overlay
// has already dismissed locally either way.
export async function declineRideRequest(rideId: string): Promise<void> {
  await api.post(`/api/v1/rides/${rideId}/decline`).catch(() => {})
}
