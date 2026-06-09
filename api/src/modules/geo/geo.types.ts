export interface City {
  id: number
  name: string
  slug: string
  state: string
  centroid_lat: number
  centroid_lng: number
  default_speed_limit_kmph: number
  status: 'draft' | 'active' | 'inactive'
  is_rental_enabled: boolean
  is_return_cab_enabled: boolean
  created_at: string
}

export interface GpsTrackPayload {
  ride_id: number
  session_id: number
  driver_id: number
  latitude: number
  longitude: number
  heading?: number
  speed_kmph?: number
  accuracy_metres?: number
  recorded_at: string
}

export interface GeocodeResult {
  latitude: number
  longitude: number
  normalized_address: string
  from_cache: boolean
}
