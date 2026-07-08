import api from './api'

export interface RateCard {
  id: number
  category_id: number
  category_name: string
  category_slug: string
  ride_type: 'one_way' | 'round_trip' | 'rental'
  rate_per_km: string
  rate_per_min: string
  min_fare: string
  return_rate_per_km: string | null
  hour_rate: string | null
  effective_from: string
  created_at: string
}

export interface RateCardHistoryRow {
  id: number
  rate_card_id: number
  category_name: string
  ride_type: string
  rate_per_km: string
  rate_per_min: string
  min_fare: string
  change_reason: string | null
  created_at: string
}

export interface SurgeEvent {
  id: number
  city_id: number
  city_name: string
  category_id: number | null
  category_name: string | null
  multiplier: string
  reason: string | null
  status: 'scheduled' | 'active' | 'expired' | 'cancelled'
  starts_at: string
  ends_at: string
  created_at: string
}

export const pricingApi = {
  getRateCards: () =>
    api.get('/api/v1/admin/pricing/rate-cards').then(r => r.data as RateCard[]),

  getRateCardHistory: () =>
    api.get('/api/v1/admin/pricing/rate-cards/history').then(r => r.data as RateCardHistoryRow[]),

  createRateCard: (data: {
    category_id: number
    ride_type: string
    rate_per_km: number
    rate_per_min: number
    min_fare: number
    return_rate_per_km?: number | null
    hour_rate?: number | null
    notes?: string
  }) => api.post('/api/v1/admin/pricing/rate-cards', data).then(r => r.data as RateCard),

  getSurgeEvents: () =>
    api.get('/api/v1/admin/pricing/surge').then(r => r.data as SurgeEvent[]),

  createSurgeEvent: (data: {
    city_id: number
    category_id?: number | null
    multiplier: number
    reason?: string
    starts_at: string
    ends_at: string
  }) => api.post('/api/v1/admin/pricing/surge', data).then(r => r.data as SurgeEvent),

  cancelSurgeEvent: (id: number) =>
    api.patch(`/api/v1/admin/pricing/surge/${id}/cancel`).then(r => r.data),
}

export interface RentalPackageAdmin {
  id: number
  category_id: number
  category_name: string
  category_slug: string
  duration_minutes: number
  km_limit: number
  display_order: number
  package_fare: string
  extra_per_km: string
  extra_per_min: string
  is_active: boolean
  updated_at: string
}

export const rentalPackageApi = {
  list: (): Promise<RentalPackageAdmin[]> =>
    api.get('/api/v1/admin/pricing/rental-packages').then(r => r.data as RentalPackageAdmin[]),

  update: (id: number, data: {
    package_fare?: number; extra_per_km?: number; extra_per_min?: number; is_active?: boolean
    duration_minutes?: number; km_limit?: number; display_order?: number
  }): Promise<RentalPackageAdmin> =>
    api.patch(`/api/v1/admin/pricing/rental-packages/${id}`, data).then(r => r.data as RentalPackageAdmin),

  create: (data: {
    category_id: number; duration_minutes: number; km_limit: number
    package_fare: number; extra_per_km: number; extra_per_min: number; display_order?: number
  }): Promise<RentalPackageAdmin> =>
    api.post('/api/v1/admin/pricing/rental-packages', data).then(r => r.data as RentalPackageAdmin),

  remove: (id: number): Promise<void> =>
    api.delete(`/api/v1/admin/pricing/rental-packages/${id}`).then(() => undefined),
}
