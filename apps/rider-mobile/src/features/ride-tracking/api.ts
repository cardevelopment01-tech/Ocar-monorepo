import { camelizeKeys, decodePolyline } from '@ocar/mobile-shared'
import { api } from '@/services/api'
import type { RideDetailExtra } from './types'

// origin_lat/lng, dest_lat/lng and driver_current_lat/lng are all DECIMAL
// columns in Postgres, which node-postgres returns as strings -- despite
// RideDetail/RideDetailExtra's `number` types. Left uncoerced, these crash
// react-native-maps' native Marker ("Value for latitude cannot be cast from
// String to double") the moment they reach one, which RideMapView now does
// (see the CarMarker/LocationPin premiumness pass this was found during).
function coerceRideCoords(ride: RideDetailExtra): RideDetailExtra {
  return {
    ...ride,
    originLat: Number(ride.originLat),
    originLng: Number(ride.originLng),
    destLat: ride.destLat != null ? Number(ride.destLat) : null,
    destLng: ride.destLng != null ? Number(ride.destLng) : null,
    driverCurrentLat: ride.driverCurrentLat != null ? Number(ride.driverCurrentLat) : null,
    driverCurrentLng: ride.driverCurrentLng != null ? Number(ride.driverCurrentLng) : null,
  }
}

export async function fetchRide(rideId: string): Promise<RideDetailExtra> {
  const res = await api.get(`/api/v1/rides/${rideId}`)
  return coerceRideCoords(camelizeKeys<RideDetailExtra>(res.data))
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

export async function cancelRide(rideId: string, reasonCode?: string, reason?: string): Promise<void> {
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
  rideId: string
  senderType: 'user' | 'driver'
  senderId: string
  body: string
  clientMsgId: string
  readAt: string | null
  createdAt: string
}

// Server responds { messages: [...] }, not a bare array -- see
// api/src/modules/ride-chat/ride-chat.controller.ts's getMessages.
export async function fetchChatMessages(rideId: string, after?: string): Promise<ChatMessage[]> {
  const res = await api.get<{ messages: unknown[] }>(`/api/v1/rides/${rideId}/messages`, {
    params: after ? { after } : undefined,
  })
  return camelizeKeys<ChatMessage[]>(res.data.messages)
}

export async function sendChatMessage(rideId: string, body: string, clientMsgId: string): Promise<ChatMessage> {
  const res = await api.post(`/api/v1/rides/${rideId}/messages`, { body, clientMsgId })
  return camelizeKeys<ChatMessage>(res.data)
}
