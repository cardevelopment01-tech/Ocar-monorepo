import api from './api'

export interface AdminCity {
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
  billing_mode: 'commission' | 'package'
  created_at: string
}

export const cityApi = {
  list: () =>
    api.get('/api/v1/admin/geo/cities').then(r => r.data as AdminCity[]),

  create: (data: {
    name: string
    slug: string
    state: string
    centroid_lat: number
    centroid_lng: number
    default_speed_limit_kmph: number
    is_rental_enabled: boolean
    is_return_cab_enabled: boolean
  }) =>
    api.post('/api/v1/admin/geo/cities', data).then(r => r.data as AdminCity),

  update: (id: number, data: {
    name?: string
    state?: string
    default_speed_limit_kmph?: number
    status?: string
    is_rental_enabled?: boolean
    is_return_cab_enabled?: boolean
    billing_mode?: 'commission' | 'package'
  }) =>
    api.patch(`/api/v1/admin/geo/cities/${id}`, data).then(r => r.data as AdminCity),
}
