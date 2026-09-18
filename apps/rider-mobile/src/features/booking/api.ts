import axios, { type AxiosRequestConfig } from 'axios'
import {
  camelizeKeys,
  decodePolyline,
  mapBookingErrorCode,
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
  if (!axios.isAxiosError(err)) return 'Something went wrong, please try again'
  const data = err.response?.data as { code?: string; error?: string } | undefined
  if (data?.code) return mapBookingErrorCode(data.code)
  if (err.response?.status === 422 && data?.error) return data.error
  return 'Something went wrong, please try again'
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

// vehicles.repository.ts's real SELECT returns {id, slug, display_name,
// max_passengers, is_active} -- packages/mobile-shared's VehicleCategory now
// matches that shape exactly (fixed after this file first flagged the drift),
// so a plain camelize is correct here.
export async function fetchVehicleCategories(): Promise<VehicleCategory[]> {
  const res = await api.get<unknown[]>('/api/v1/vehicles/categories')
  return camelizeKeys<VehicleCategory[]>(res.data)
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
  }
  if (input.cityId !== undefined) body['city_id'] = input.cityId
  if (input.tripHours !== undefined) body['trip_hours'] = input.tripHours
  if (input.rentalPackageId !== undefined) body['rental_package_id'] = input.rentalPackageId
  const res = await api.post('/api/v1/pricing/estimate', body, config)
  return camelizeKeys<FareEstimate>(res.data)
}

export async function fetchRentalPackages(categoryId: number, cityId?: number | null): Promise<RentalPackage[]> {
  const res = await api.get<unknown[]>(`/api/v1/pricing/rental-packages/${categoryId}`, {
    params: cityId != null ? { city_id: cityId } : {},
  })
  return camelizeKeys<RentalPackage[]>(res.data)
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
}

export async function createBooking(input: CreateBookingInput): Promise<BookingResult> {
  const res = await api.post('/api/v1/rides', input)
  return camelizeKeys<BookingResult>(res.data)
}
