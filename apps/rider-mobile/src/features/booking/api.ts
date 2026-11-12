import type { AxiosRequestConfig } from 'axios'
import {
  camelizeKeys,
  decodePolyline,
  getApiErrorMessage,
  track,
  type BookingResult,
  type FareEstimate,
  type GeoAutocompleteResult,
  type GeoPlaceDetail,
  type RentalPackage,
  type StopInput,
  type VehicleCategory,
} from '@ocar/mobile-shared'
import { api } from '@/services/api'

// Booking failures come back as { error: <human message>, code?: <machine code> }.
// mapBookingErrorCode only covers a known set of codes (bad category, surge
// changed, etc) -- business-rule 422s thrown via `Object.assign(new Error(...),
// { httpStatus }) (no appCode set, see api/src/middleware/error.middleware.ts)
// carry no `code` at all, e.g. "Stop 2 is too close to another point in this
// trip". Falling straight to a generic message for those hides an actionable,
// already-human-readable reason -- same fallback web's rental/page.tsx uses.
export function resolveBookingError(err: unknown): string {
  return getApiErrorMessage(err, 'Something went wrong, please try again')
}

// GET /geo/place/:placeId and GET /geo/reverse both come back as
// {latitude, longitude, address} (geo.service.ts's own field names, not
// snake_case) -- camelizeKeys leaves them alone since there's no underscore
// to convert, so they're mapped to GeoPlaceDetail's {lat, lng, address} by hand.
// latitude/longitude arrive as strings at runtime (Postgres NUMERIC columns
// serialize that way) despite this type's claim -- Number(...) below is the
// real fix; this type documents what the API SHOULD send, not what it does.
type RawPlaceDetail = { placeId: string; address: string; latitude: number; longitude: number }
type RawReverseGeocode = { address: string }

export async function fetchAutocomplete(
  q: string,
  lat: number | undefined,
  lng: number | undefined,
  config?: AxiosRequestConfig
): Promise<GeoAutocompleteResult[]> {
  const params: Record<string, string> = { q }
  if (lat !== undefined) params['lat'] = String(lat)
  if (lng !== undefined) params['lng'] = String(lng)
  const res = await api.get<GeoAutocompleteResult[]>('/api/v1/geo/autocomplete', { ...config, params })
  return camelizeKeys<GeoAutocompleteResult[]>(res.data)
}

export async function fetchPlaceDetail(placeId: string): Promise<GeoPlaceDetail> {
  const res = await api.get<RawPlaceDetail>(`/api/v1/geo/place/${encodeURIComponent(placeId)}`)
  return { address: res.data.address, lat: Number(res.data.latitude), lng: Number(res.data.longitude) }
}

export async function fetchReverseGeocode(lat: number, lng: number): Promise<GeoPlaceDetail> {
  const res = await api.get<RawReverseGeocode>('/api/v1/geo/reverse', { params: { lat, lng } })
  return { address: res.data.address, lat, lng }
}

export type RouteResult = { distanceKm: number; durationMin: number; routePoints: [number, number][] }

export async function fetchRoute(
  originLat: number, originLng: number, destLat: number, destLng: number
): Promise<RouteResult> {
  const res = await api.get<{ distanceKm: number; durationMin: number; polyline?: string }>('/api/v1/geo/route', {
    params: { originLat, originLng, destLat, destLng },
  })
  return {
    distanceKm: res.data.distanceKm,
    durationMin: res.data.durationMin,
    routePoints: res.data.polyline ? decodePolyline(res.data.polyline) : [],
  }
}

export async function fetchNearbyDrivers(lat: number, lng: number): Promise<Array<{ driverId: string; lat: number; lng: number; categoryId: number }>> {
  const res = await api.get<{ drivers: Array<{ driver_id: string; lat: number | string; lng: number | string; category_id: number }> }>(
    '/api/v1/rides/nearby-drivers',
    { params: { lat, lng } }
  )
  // lat/lng come back as strings at runtime (Postgres NUMERIC columns, same
  // as fetchPlaceDetail above) -- Number(...) is required before these reach
  // a native Marker, which enforces true double.
  return (res.data.drivers ?? []).map((d) => ({ driverId: d.driver_id, lat: Number(d.lat), lng: Number(d.lng), categoryId: d.category_id }))
}

export type SavedPlace = { id: number; kind: 'home' | 'work' | 'other'; label: string; address: string; lat: number; lng: number }

// The backend module (api/src/modules/saved-places) already exists and already
// coerces latitude/longitude to Number server-side -- unlike the two spots above,
// no client-side coercion needed here.
export async function fetchSavedPlaces(): Promise<SavedPlace[]> {
  const res = await api.get<{ places: Array<{ id: number; kind: 'home' | 'work' | 'other'; label: string; address: string; latitude: number; longitude: number }> }>(
    '/api/v1/saved-places'
  )
  return res.data.places.map((p) => ({ id: p.id, kind: p.kind, label: p.label, address: p.address, lat: p.latitude, lng: p.longitude }))
}

export async function fetchNearestCityId(lat: number, lng: number): Promise<number | null> {
  try {
    const res = await api.get<{ id: number; name: string }>('/api/v1/geo/cities/nearest', { params: { lat, lng } })
    return res.data.id
  } catch {
    return null
  }
}

export type { TripClassification } from './cityRideRoute'
import type { TripClassification, TripMode } from './cityRideRoute'

// Same endpoint web's geoApi.classifyTrip hits (GET /api/v1/geo/classify-trip) --
// decides whether a route stays inside one city (round trips/rentals can't
// serve it, one-way/rental can) or crosses to another (one-way/rental can't
// serve it, round trip/outstation one-way can).
export async function fetchClassifyTrip(
  originLat: number, originLng: number, destLat: number, destLng: number
): Promise<TripClassification | null> {
  try {
    const res = await api.get<{ scope: 'in_city' | 'outstation'; cityId: number | null; cityName: string | null; city_ride_available?: boolean }>(
      '/api/v1/geo/classify-trip',
      { params: { originLat, originLng, destLat, destLng } },
    )
    const d = res.data
    if (d.scope !== 'in_city' || d.cityId == null || d.cityName == null) return { scope: 'outstation' }
    // `city_ride_available` is absent on an older server: City ride is then off, and the app behaves as it did before it existed.
    return {
      scope: 'in_city', cityId: d.cityId, cityName: d.cityName,
      ...(d.city_ride_available === undefined ? {} : { cityRideAvailable: d.city_ride_available }),
    }
  } catch {
    return null
  }
}

// vehicles.repository.ts's real SELECT returns {id, slug, display_name,
// max_passengers, is_active} -- packages/mobile-shared's VehicleCategory now
// matches that shape exactly (fixed after this file first flagged the drift),
// so a plain camelize is correct here.
// Home's fleet strip, the fare screen and the rental screen all ask for this on every open; the
// list changes at admin-edit frequency, so share one in-flight/short-lived request between them.
// A failed request is dropped from the cache so the next caller retries.
const CATEGORIES_TTL_MS = 5 * 60_000
let categoriesCache: { at: number; promise: Promise<VehicleCategory[]> } | null = null

export function fetchVehicleCategories(): Promise<VehicleCategory[]> {
  if (categoriesCache && Date.now() - categoriesCache.at < CATEGORIES_TTL_MS) return categoriesCache.promise
  const promise = api
    .get<unknown[]>('/api/v1/vehicles/categories')
    .then((res) => camelizeKeys<VehicleCategory[]>(res.data))
  const entry = { at: Date.now(), promise }
  categoriesCache = entry
  promise.catch(() => { if (categoriesCache === entry) categoriesCache = null })
  return promise
}

export type RideType = 'one_way' | 'round_trip' | 'rental'

export type FareEstimateInput = {
  categoryId: number
  rideType: RideType
  distanceKm: number
  durationMin: number
  cityId?: number
  tripHours?: number
  rentalPackageId?: number
  isReturnCab?: boolean
  /** 'city' prices the trip on the City ride card; absent (every other ride) is the standard card. */
  tripMode?: TripMode
}

export async function fetchFareEstimate(
  input: FareEstimateInput,
  config?: AxiosRequestConfig
): Promise<FareEstimate> {
  const body: Record<string, unknown> = {
    category_id: input.categoryId,
    ride_type: input.rideType,
    distance_km: input.distanceKm,
    duration_min: input.durationMin,
    is_return_cab: input.isReturnCab ?? false,
  }
  if (input.cityId !== undefined) body['city_id'] = input.cityId
  if (input.tripHours !== undefined) body['trip_hours'] = input.tripHours
  if (input.rentalPackageId !== undefined) body['rental_package_id'] = input.rentalPackageId
  if (input.tripMode === 'city') body['trip_mode'] = 'city'
  const res = await api.post('/api/v1/pricing/estimate', body, config)
  return camelizeKeys<FareEstimate>(res.data)
}

// Mirrors web's rideApi.getReturnCabAvailable (apps/user/lib/ride-api.ts) --
// checks whether a driver already heading back through destinationCityName is
// on this exact pickup->drop route right now, for the "Return Cab Available"
// discounted section. Meaningless for a scheduled future pickup (a live
// driver's current route says nothing about later), so callers should only
// fire this for immediate one_way bookings.
export async function fetchReturnCabAvailable(params: {
  pickupLat: number
  pickupLng: number
  dropLat: number
  dropLng: number
  categoryId: number
}): Promise<{ count: number; nearestM: number | null }> {
  // `nearest_m` is how far the closest return-cab driver is (null when none, or from an older server): it lets the card show an honest wait.
  const res = await api.get<{ count: number; nearest_m?: number | null }>('/api/v1/rides/return-cab-available', {
    params: {
      pickupLat: params.pickupLat,
      pickupLng: params.pickupLng,
      dropLat: params.dropLat,
      dropLng: params.dropLng,
      categoryId: params.categoryId,
    },
  })
  return { count: res.data.count, nearestM: res.data.nearest_m ?? null }
}

export async function fetchRentalPackages(categoryId: number, cityId?: number | null): Promise<RentalPackage[]> {
  const res = await api.get<unknown[]>(`/api/v1/pricing/rental-packages/${categoryId}`, {
    params: cityId != null ? { city_id: cityId } : {},
  })
  return camelizeKeys<RentalPackage[]>(res.data)
}

// Every category's packages in one call, grouped by category id. The per-category route stays for older servers: if the
// one-call route is missing (404/405, an older server), fall back to one call per category. Any other failure (timeout, 5xx, no
// network) returns no packages, as a failed category always did: retrying 5x on top of a struggling API would make it worse.
export async function fetchAllRentalPackages(categoryIds: number[], cityId?: number | null): Promise<Record<number, RentalPackage[]>> {
  try {
    const res = await api.get<unknown[]>('/api/v1/pricing/rental-packages', { params: cityId != null ? { city_id: cityId } : {} })
    const rows = camelizeKeys<Array<RentalPackage & { categoryId: number }>>(res.data)
    const byCat: Record<number, RentalPackage[]> = {}
    for (const id of categoryIds) byCat[id] = []
    for (const r of rows) (byCat[r.categoryId] ??= []).push(r)
    return byCat
  } catch (err) {
    const status = (err as { response?: { status?: number } } | null)?.response?.status
    if (status !== 404 && status !== 405) return {}
    const entries = await Promise.allSettled(categoryIds.map(async (id) => [id, await fetchRentalPackages(id, cityId)] as const))
    const byCat: Record<number, RentalPackage[]> = {}
    for (const e of entries) if (e.status === 'fulfilled') byCat[e.value[0]] = e.value[1]
    return byCat
  }
}

// BookingRequest (api/src/modules/rides/rides.types.ts) is already camelCase
// end to end -- no snake_case conversion needed on the way in.
export type CreateBookingInput = {
  categoryId: number
  rideType: RideType
  originLat: number
  originLng: number
  originAddress?: string
  destinationLat: number
  destinationLng: number
  destinationAddress?: string
  originCityId?: number
  distanceKm: number
  durationMin: number
  tripHours?: number
  rentalPackageId?: number
  stops?: StopInput[]
  scheduledFor?: string
  riderName?: string
  riderPhone?: string
  isReturnCab?: boolean
  /** Only sent for a city ride; absent is a standard ride, exactly as before City ride existed. */
  tripMode?: 'city'
  /** Offers (all optional; absent for an app talking to a server with offers off). */
  couponCode?: string
  expectedPayable?: number
  autoOffer?: string
}

export async function createBooking(input: CreateBookingInput): Promise<BookingResult> {
  const res = await api.post('/api/v1/rides', input)
  track('ride_booked')
  return camelizeKeys<BookingResult>(res.data)
}
