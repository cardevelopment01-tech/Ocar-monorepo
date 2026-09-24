import { camelizeKeys, decodePolyline, type RideDetail } from '@ocar/mobile-shared'
import { api } from '@/services/api'
import type { SpeedLimitCity } from './speedAlert'

// Raw snake_case, unmapped -- same convention web's TripInProgress.tsx uses
// for this endpoint (SpeedLimitCity's fields are consumed as-is by
// classifyLimit, no camelCase call site needs them).
export async function fetchSpeedLimitCities(): Promise<SpeedLimitCity[]> {
  const res = await api.get<SpeedLimitCity[]>('/api/v1/geo/cities')
  return res.data ?? []
}

export type RouteLeg = { polyline: [number, number][]; etaMin: number; distanceKm: number }

// Was never called anywhere in this app -- ActiveRideMap drew a bare
// two-point straight line between the driver and the leg target instead of a
// real road-following route, and never routed through pending stops at all.
// Mirrors rider-mobile's ride-tracking/api.ts fetchRouteLeg exactly, same
// backend endpoint.
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

export async function fetchRide(rideId: string): Promise<RideDetail> {
  const res = await api.get(`/api/v1/rides/${rideId}`)
  return camelizeKeys<RideDetail>(res.data)
}

export async function markArrived(rideId: string): Promise<void> {
  await api.post(`/api/v1/rides/${rideId}/arrived`)
}

// Round-trip only -- backend rejects otherwise (rides.service.ts's startReturn,
// 422 for a non-round_trip ride_type). Same endpoint web driver's
// handleStartReturn hits (ride-api.ts's startReturn).
export async function startReturn(rideId: string): Promise<void> {
  await api.post(`/api/v1/rides/${rideId}/start-return`)
}

// Same endpoint rider-mobile's triggerMaskedCall hits -- rides.routes.ts's
// call handler checks req.user OR req.driver as the ride owner, so this
// works unchanged for the driver side too.
export async function triggerMaskedCall(rideId: string): Promise<void> {
  await api.post(`/api/v1/rides/${rideId}/call`)
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

// Never called anywhere in this app before -- a rider-added mid-trip stop had
// no driver-side way to ever resolve it (rides.service.ts's verifyEndOTP hard-
// blocks end-otp with 409 RIDE_HAS_PENDING_STOPS while any stop is still
// pending), so a driver who got a stop added was permanently stuck unable to
// end the trip, with only a generic "Could not confirm" error and no
// indication why.
export async function markStopStatus(rideId: string, sequence: number, status: 'reached' | 'skipped'): Promise<void> {
  await api.patch(`/api/v1/rides/${rideId}/stops/${sequence}`, { status })
}

// Web driver's counterpart: apps/driver/src/lib/ride-api.ts's cancelRideAsDriver,
// same /cancel-driver endpoint (separate from rider's /cancel -- rides.routes.ts:214,223).
export async function cancelRideAsDriver(rideId: string, reasonCode: string): Promise<void> {
  await api.post(`/api/v1/rides/${rideId}/cancel-driver`, { reasonCode })
}

export type CashCollectionResult = { collected: number; discrepancy: boolean }

export async function submitCashCollection(
  rideId: string,
  input: { collectedAmount?: number; notCollected?: boolean; note?: string }
): Promise<CashCollectionResult> {
  const res = await api.post(`/api/v1/rides/${rideId}/collect-cash`, input)
  return camelizeKeys<CashCollectionResult>(res.data)
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

export async function fetchUnreadChatCount(rideId: string): Promise<number> {
  const res = await api.get<{ count: number }>(`/api/v1/rides/${rideId}/messages/unread-count`)
  return res.data.count
}

export async function markChatRead(rideId: string): Promise<void> {
  await api.patch(`/api/v1/rides/${rideId}/messages/read`)
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
