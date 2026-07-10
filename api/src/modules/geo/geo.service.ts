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

export async function flushGpsTracks(
  tracks: GpsTrackPayload[]
): Promise<{ written: number }> {
  const filtered = tracks.filter(
    t => t.accuracy_metres == null || t.accuracy_metres <= 50
  )
  if (!filtered.length) return { written: 0 }
  await repo.insertGpsTracks(filtered)
  return { written: filtered.length }
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

  const result = await google.getRoute(originLat, originLng, destLat, destLng, opts)
  await setWithTTL(cacheKey, JSON.stringify(result), ROUTE_CACHE_TTL_SECONDS)
  return result
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
