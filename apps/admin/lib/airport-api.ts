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
  /** Required on every change; kept in the history with who made it. */
  reason: string
}

export interface AirportChange {
  id: number; zone_id: number; zone_name: string; action: 'create' | 'update' | 'delete'
  reason: string; changed_by: string | null; created_at: string; summary: Record<string, unknown>
}

export const airportApi = {
  list: () => api.get('/api/v1/admin/airport-zones').then(r => r.data as AirportZone[]),
  create: (body: Required<Pick<AirportZoneInput, 'name' | 'boundary' | 'reason'>> & Pick<AirportZoneInput, 'rates'>) =>
    api.post('/api/v1/admin/airport-zones', body).then(r => r.data as { id: number }),
  update: (id: number, body: Partial<AirportZoneInput> & { reason: string }) => api.patch(`/api/v1/admin/airport-zones/${id}`, body).then(r => r.data),
  remove: (id: number, reason: string) => api.delete(`/api/v1/admin/airport-zones/${id}`, { data: { reason } }).then(() => undefined),
  changes: () => api.get('/api/v1/admin/airport-zones/changes').then(r => r.data as AirportChange[]),
}
