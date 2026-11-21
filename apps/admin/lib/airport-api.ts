import api from './api'

export interface AirportRate { category_id: number; category_name: string; amount: number }

export interface AirportZone {
  id: number
  name: string
  is_active: boolean
  /** GeoJSON Polygon (lng, lat). */
  boundary: { type: 'Polygon'; coordinates: number[][][] }
  area_km2: number
  updated_at: string
  rates: AirportRate[]
}

export interface AirportZoneInput {
  name?: string
  boundary?: AirportZone['boundary']
  is_active?: boolean
  /** The full list of tolls: a vehicle type left out (or at 0) pays nothing in this zone. */
  rates?: Array<{ category_id: number; amount: number }>
}

export const airportApi = {
  list: () => api.get('/api/v1/admin/airport-zones').then(r => r.data as AirportZone[]),
  create: (body: Required<Pick<AirportZoneInput, 'name' | 'boundary'>> & Pick<AirportZoneInput, 'rates'>) =>
    api.post('/api/v1/admin/airport-zones', body).then(r => r.data as { id: number }),
  update: (id: number, body: AirportZoneInput) => api.patch(`/api/v1/admin/airport-zones/${id}`, body).then(r => r.data),
  remove: (id: number) => api.delete(`/api/v1/admin/airport-zones/${id}`).then(() => undefined),
}
