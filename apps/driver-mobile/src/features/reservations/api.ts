import { api } from '@/services/api'
import type { Reservation } from './types'

export async function fetchReservations(): Promise<Reservation[]> {
  const res = await api.get<{ reservations: Reservation[] }>('/api/v1/rides/reservations')
  return res.data.reservations
}

export async function confirmReservation(rideId: string): Promise<void> {
  await api.post(`/api/v1/rides/${rideId}/reservation/confirm`)
}

export async function declineReservation(rideId: string): Promise<{ late: boolean }> {
  const res = await api.post<{ late: boolean }>(`/api/v1/rides/${rideId}/reservation/decline`)
  return { late: res.data.late }
}
