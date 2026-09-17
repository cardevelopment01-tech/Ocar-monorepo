import type { AxiosRequestConfig } from 'axios'
import {
  camelizeKeys,
  type BookingResult,
  type FareEstimate,
  type GeoAutocompleteResult,
  type GeoPlaceDetail,
  type VehicleCategory,
} from '@ocar/mobile-shared'
import { api } from '@/services/api'

// GET /geo/place/:placeId and GET /geo/reverse both come back as
// {latitude, longitude, address} (geo.service.ts's own field names, not
// snake_case) -- camelizeKeys leaves them alone since there's no underscore
// to convert, so they're mapped to GeoPlaceDetail's {lat, lng, address} by hand.
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
  return { address: res.data.address, lat: res.data.latitude, lng: res.data.longitude }
}

export async function fetchReverseGeocode(lat: number, lng: number): Promise<GeoPlaceDetail> {
  const res = await api.get<RawReverseGeocode>('/api/v1/geo/reverse', { params: { lat, lng } })
  return { address: res.data.address, lat, lng }
}

export type RouteResult = { distanceKm: number; durationMin: number }

export async function fetchRoute(
  originLat: number, originLng: number, destLat: number, destLng: number
): Promise<RouteResult> {
  const res = await api.get<RouteResult>('/api/v1/geo/route', {
    params: { originLat, originLng, destLat, destLng },
  })
  return { distanceKm: res.data.distanceKm, durationMin: res.data.durationMin }
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

export type FareEstimateInput = {
  categoryId: number
  rideType: 'one_way'
  distanceKm: number
  durationMin: number
  cityId?: number
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
  const res = await api.post('/api/v1/pricing/estimate', body, config)
  return camelizeKeys<FareEstimate>(res.data)
}

// BookingRequest (api/src/modules/rides/rides.types.ts) is already camelCase
// end to end -- no snake_case conversion needed on the way in.
export type CreateBookingInput = {
  categoryId: number
  rideType: 'one_way'
  originLat: number
  originLng: number
  originAddress?: string
  destinationLat: number
  destinationLng: number
  destinationAddress?: string
  originCityId?: number
  distanceKm: number
  durationMin: number
}

export async function createBooking(input: CreateBookingInput): Promise<BookingResult> {
  const res = await api.post('/api/v1/rides', input)
  return camelizeKeys<BookingResult>(res.data)
}
