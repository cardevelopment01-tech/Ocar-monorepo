import { pool } from '@/db/client'
import * as repo from './geo.repository'
import * as google from './providers/google.provider'
import type { RouteOptions } from './providers/google.provider'
import type { GpsTrackPayload } from './geo.types'
import { getJSON, setWithTTL } from '@/db/redis'
import { routeKey } from '@/constants/redis-keys'
import { ROUTE_CACHE_TTL_SECONDS } from '@/constants/limits'
export type { PlaceSuggestion, PlaceDetail, RouteResult, RouteStep } from './providers/google.provider'

export async function getCities() {
  return repo.getActiveCities()
}

export async function getAllCitiesForAdmin() {
  return repo.getAllCities()
}

export async function getCityBySlug(slug: string) {
  const city = await repo.getCityBySlug(slug)
  if (!city) throw Object.assign(new Error('City not found'), { httpStatus: 404 })
  return city
}

export async function findNearestCity(lat: number, lng: number) {
  return repo.findNearestCity(lat, lng)
}

// A batch is the driver app's offline/periodic queue, so unlike a live ping it can legitimately be hours old. Future
// timestamps stay tightly bounded; the past is bounded generously (the default partition catches anything unusual).
const MAX_TRACK_FUTURE_MS = 10 * 60 * 1000
const MAX_TRACK_AGE_MS = 24 * 60 * 60 * 1000
const ID_RE = /^\d{1,18}$/

// The batch endpoint is driver-authenticated but every row carried its own ride_id/session_id, so a driver could
// write breadcrumbs onto ANY ride — and rental/round-trip billing reads breadcrumbs. Rows are now accepted only
// for rides assigned to this driver that are still live, and sessions that are theirs; coordinates and timestamps
// are range-checked (an out-of-window recorded_at fails the partition insert for the entire batch).
export async function flushGpsTracks(
  driverId: bigint,
  tracks: Array<Omit<GpsTrackPayload, 'driver_id'>>
): Promise<{ written: number; rejected: number }> {
  const now = Date.now()
  const plausible = tracks.filter(t => {
    const ms = Date.parse(t.recorded_at)
    return (
      ID_RE.test(String(t.ride_id)) && ID_RE.test(String(t.session_id)) &&
      Number.isFinite(t.latitude) && Math.abs(t.latitude) <= 90 &&
      Number.isFinite(t.longitude) && Math.abs(t.longitude) <= 180 &&
      Number.isFinite(ms) && ms - now <= MAX_TRACK_FUTURE_MS && now - ms <= MAX_TRACK_AGE_MS &&
      (t.accuracy_metres == null || t.accuracy_metres <= 50)
    )
  })
  if (!plausible.length) return { written: 0, rejected: tracks.length }

  const rideIds = [...new Set(plausible.map(t => String(t.ride_id)))]
  const sessionIds = [...new Set(plausible.map(t => String(t.session_id)))]
  const [rides, sessions] = await Promise.all([
    pool.query<{ id: string }>(
      `SELECT id::text FROM rides
        WHERE id = ANY($1::bigint[]) AND driver_id = $2
          AND (status IN ('accepted', 'driver_arrived', 'in_progress', 'returning')
               -- the app's final flush usually lands just AFTER the ride completed, and billing reads the tail
               OR (status = 'completed' AND completed_at > now() - interval '3 hours'))`,
      [rideIds, driverId]
    ),
    pool.query<{ id: string }>(
      `SELECT id::text FROM driver_sessions WHERE id = ANY($1::bigint[]) AND driver_id = $2`,
      [sessionIds, driverId]
    ),
  ])
  const okRides = new Set(rides.rows.map(r => r.id))
  const okSessions = new Set(sessions.rows.map(r => r.id))
  const accepted = plausible
    .filter(t => okRides.has(String(t.ride_id)) && okSessions.has(String(t.session_id)))
    .map(t => ({ ...t, driver_id: driverId.toString() }))

  if (accepted.length) await repo.insertGpsTracks(accepted)
  return { written: accepted.length, rejected: tracks.length - accepted.length }
}

export async function autocomplete(
  input: string,
  lat?: number,
  lng?: number,
) {
  return google.autocomplete(input, lat, lng)
}

export async function getPlaceDetails(placeId: string) {
  const cacheKey = `place:${placeId}`
  const cached = await repo.lookupGeoCache(cacheKey)
  if (cached) return { latitude: cached.latitude, longitude: cached.longitude, address: cached.raw_address, placeId }

  const detail = await google.placeDetails(placeId)
  await repo.storeGeoCache({
    normalizedAddress: cacheKey,
    rawAddress: detail.address,
    latitude: detail.lat,
    longitude: detail.lng,
    provider: 'google',
  })
  return { latitude: detail.lat, longitude: detail.lng, address: detail.address, placeId }
}

export async function reverseGeocode(lat: number, lng: number) {
  return { address: await google.reverseGeocode(lat, lng) }
}

export async function getRoute(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number,
  opts?: RouteOptions,
) {
  const cacheKey = routeKey(originLat, originLng, destLat, destLng, opts)
  const cached = await getJSON<google.RouteResult>(cacheKey)
  if (cached) return cached

  // Single-flight: concurrent identical misses (rider + driver opening the same trip,
  // client retries) share one upstream call instead of each paying Google latency.
  let pending = inflightRoutes.get(cacheKey)
  if (!pending) {
    pending = google.getRoute(originLat, originLng, destLat, destLng, opts)
      .then(async result => {
        // Only cache full-quality results: a cached OSRM/straight-line fallback would pin
        // the degraded answer (and defeat the driver app's retry-on-empty) for the TTL.
        if (result.source === 'google') {
          await setWithTTL(cacheKey, JSON.stringify(result), ROUTE_CACHE_TTL_SECONDS)
        }
        return result
      })
      .finally(() => inflightRoutes.delete(cacheKey))
    inflightRoutes.set(cacheKey, pending)
  }
  return pending
}

const inflightRoutes = new Map<string, Promise<google.RouteResult>>()

export async function snapTrailToRoads(points: Array<{ lat: number; lng: number }>) {
  return google.snapToRoads(points)
}

export async function classifyTrip(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number,
) {
  const city = await repo.findContainingCity(originLat, originLng, destLat, destLng)
  return city
    ? { scope: 'in_city' as const, cityId: city.id, cityName: city.name }
    : { scope: 'outstation' as const, cityId: null, cityName: null }
}

export async function createCity(data: {
  name: string
  slug: string
  state: string
  centroid_lat: number
  centroid_lng: number
  default_speed_limit_kmph: number
  is_rental_enabled: boolean
  is_return_cab_enabled: boolean
  created_by: bigint | null
}) {
  return repo.createCity(data)
}

export async function updateCity(
  id: bigint,
  data: {
    name?: string
    state?: string
    default_speed_limit_kmph?: number
    status?: string
    is_rental_enabled?: boolean
    is_return_cab_enabled?: boolean
  }
) {
  const updated = await repo.updateCity(id, data)
  if (!updated) throw Object.assign(new Error('City not found'), { httpStatus: 404 })
  return updated
}
