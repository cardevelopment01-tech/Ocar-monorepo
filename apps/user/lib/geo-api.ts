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
  ): Promise<RouteResult> => {
    const res = await api.get('/api/v1/geo/route', {
      params: { originLat, originLng, destLat, destLng },
    })
    return res.data as RouteResult
  },
}
