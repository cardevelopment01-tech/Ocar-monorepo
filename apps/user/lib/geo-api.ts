import api from './api'

export type PlaceSuggestion = {
  placeId: string
  description: string
  mainText: string
  secondaryText: string
}

export type PlaceDetail = {
  placeId: string
  address: string
  latitude: number
  longitude: number
}

export type RouteResult = {
  distanceKm: number
  durationMin: number
  polyline: string
  /** Present only when trafficAware was requested and the provider supports it. */
  trafficDurationMin?: number
}

export type TripClassification = {
  scope: 'in_city' | 'outstation'
  cityId: number | null
  cityName: string | null
}

export type NearestCity = {
  id: number
  name: string
}

export const geoApi = {
  autocomplete: async (
    q: string,
    lat?: number,
    lng?: number,
  ): Promise<PlaceSuggestion[]> => {
    const params: Record<string, string> = { q }
    if (lat !== undefined) params['lat'] = String(lat)
    if (lng !== undefined) params['lng'] = String(lng)
    const res = await api.get('/api/v1/geo/autocomplete', { params })
    return res.data as PlaceSuggestion[]
  },

  placeDetails: async (placeId: string): Promise<PlaceDetail> => {
    const res = await api.get(`/api/v1/geo/place/${encodeURIComponent(placeId)}`)
    return res.data as PlaceDetail
  },

  reverseGeocode: async (lat: number, lng: number): Promise<string> => {
    const res = await api.get('/api/v1/geo/reverse', { params: { lat, lng } })
    return (res.data as { address: string }).address
  },

  getRoute: async (
    originLat: number,
    originLng: number,
    destLat: number,
    destLng: number,
    opts?: { trafficAware?: boolean },
  ): Promise<RouteResult> => {
    const params: Record<string, unknown> = { originLat, originLng, destLat, destLng }
    if (opts?.trafficAware) params['trafficAware'] = 'true'
    const res = await api.get('/api/v1/geo/route', { params })
    return res.data as RouteResult
  },

  findNearestCity: async (lat: number, lng: number): Promise<NearestCity> => {
    const res = await api.get('/api/v1/geo/cities/nearest', { params: { lat, lng } })
    return res.data as NearestCity
  },

  classifyTrip: async (
    originLat: number,
    originLng: number,
    destLat: number,
    destLng: number,
  ): Promise<TripClassification> => {
    const res = await api.get('/api/v1/geo/classify-trip', {
      params: { originLat, originLng, destLat, destLng },
    })
    return res.data as TripClassification
  },
}
