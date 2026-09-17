import { camelizeKeys } from '@ocar/mobile-shared'
import { api } from '@/services/api'
import type { EarningsSummary, Trip } from './types'

type TripsResponse = { trips: unknown[]; pagination: { page: number; pages: number } }

export async function fetchTrips(page: number, limit = 20): Promise<{ trips: Trip[]; hasMore: boolean }> {
  const res = await api.get<TripsResponse>('/api/v1/rides/me/trips', { params: { page, limit } })
  return {
    trips: camelizeKeys<Trip[]>(res.data.trips),
    hasMore: res.data.pagination.page < res.data.pagination.pages,
  }
}

export async function fetchEarningsSummary(period: 'today' | 'week' | 'month' = 'today'): Promise<EarningsSummary> {
  const res = await api.get('/api/v1/rides/me/earnings-summary', { params: { period } })
  return camelizeKeys<EarningsSummary>(res.data)
}
