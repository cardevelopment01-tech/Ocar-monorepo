import { api } from '@/services/api'
import type { Reservation } from './types'

export async function fetchReservations(): Promise<Reservation[]> {
  const res = await api.get<{ reservations: Reservation[] }>('/api/v1/rides/reservations')
  return res.data.reservations
}

export async function confirmReservation(rideId: string): Promise<void> {
  await api.post(`/api/v1/rides/${rideId}/reservation/confirm`)
}

/** "Start now": confirms the booking and opens the ride straight away. Rejects with the server's own sentence (go online first, finish your ride, too early...). */
export async function startReservation(rideId: string): Promise<void> {
  try {
    await api.post(`/api/v1/rides/${rideId}/reservation/start`)
  } catch (err) {
    const message = (err as { response?: { data?: { error?: unknown } } }).response?.data?.error
    throw new Error(typeof message === 'string' ? message : 'Could not start this booking. Please try again.')
  }
}

export async function declineReservation(rideId: string): Promise<{ late: boolean }> {
  const res = await api.post<{ late: boolean }>(`/api/v1/rides/${rideId}/reservation/decline`)
  return { late: res.data.late }
}
