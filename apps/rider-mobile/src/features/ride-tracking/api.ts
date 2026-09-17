import { camelizeKeys, decodePolyline } from '@ocar/mobile-shared'
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

export type RouteLeg = { polyline: [number, number][]; etaMin: number; distanceKm: number }

// Mirrors the web tracking page's geoApi.getRoute call -- trafficAware only when an
// ETA is actually shown (pickup/dest legs), never during search/recap.
export async function fetchRouteLeg(
  originLat: number, originLng: number, destLat: number, destLng: number, trafficAware: boolean
): Promise<RouteLeg> {
  const res = await api.get('/api/v1/geo/route', {
    params: { originLat, originLng, destLat, destLng, trafficAware: trafficAware ? 'true' : undefined },
  })
  const data = res.data as { polyline?: string; durationMin: number; trafficDurationMin?: number; distanceKm: number }
  return {
    polyline: data.polyline ? decodePolyline(data.polyline) : [],
    etaMin: Math.round(data.trafficDurationMin ?? data.durationMin),
    distanceKm: data.distanceKm,
  }
}

export async function cancelRide(rideId: string, reasonCode: string, reason?: string): Promise<void> {
  await api.post(`/api/v1/rides/${rideId}/cancel`, { reasonCode, reason })
}

export async function triggerMaskedCall(rideId: string): Promise<void> {
  await api.post(`/api/v1/rides/${rideId}/call`)
}

export type StopInput = { address: string; lat: number; lng: number }

export async function addStop(rideId: string, stop: StopInput) {
  const res = await api.post(`/api/v1/rides/${rideId}/stops`, stop)
  return camelizeKeys(res.data)
}

export async function fetchUnreadChatCount(rideId: string): Promise<number> {
  const res = await api.get<{ count: number }>(`/api/v1/rides/${rideId}/messages/unread-count`)
  return res.data.count
}

export async function markChatRead(rideId: string): Promise<void> {
  await api.patch(`/api/v1/rides/${rideId}/messages/read`)
}

export type ChatMessage = {
  id: string
  senderType: 'user' | 'driver'
  body: string
  createdAt: string
}

export async function fetchChatMessages(rideId: string): Promise<ChatMessage[]> {
  const res = await api.get(`/api/v1/rides/${rideId}/messages`)
  return camelizeKeys<ChatMessage[]>(res.data)
}

export async function sendChatMessage(rideId: string, body: string, clientMsgId: string): Promise<ChatMessage> {
  const res = await api.post(`/api/v1/rides/${rideId}/messages`, { body, clientMsgId })
  return camelizeKeys<ChatMessage>(res.data)
}
