import api from './api'

export type DispatchLane = 'scheduled' | 'needs_driver'

export interface DispatchRow {
  id: string
  status: 'scheduled' | 'requested' | 'no_drivers'
  ride_type: string
  trip_mode?: 'standard' | 'city'
  is_return_cab: boolean
  origin_address: string | null
  destination_address: string | null
  requested_at: string
  scheduled_for: string | null
  /** When the ride is (or was) handed to drivers: an advance booking's pickup minus its dispatch buffer. */
  dispatch_at: string
  advance_status: string | null
  user_name: string | null
  user_phone: string
  category_name: string | null
  city_name: string | null
  fare: string | null
  offers_count: number
}

export interface DispatchSummary {
  scheduled_total: number
  due_within_60m: number
  overdue: number
  searching_long: number
  no_drivers: number
}

export interface DispatchQueueParams {
  lane: DispatchLane
  cityId?: number
  /** scheduled lane: only pickups within this many minutes (60, 1440 or 10080) */
  within?: number
  page?: number
  limit?: number
}

export interface DispatchQueueResponse {
  rides: DispatchRow[]
  pagination: { total: number; total_capped?: boolean; page: number; limit: number; pages: number }
}

export const dispatchApi = {
  summary: async (): Promise<DispatchSummary> => (await api.get('/api/v1/admin/dispatch/summary')).data as DispatchSummary,
  queue: async (p: DispatchQueueParams): Promise<DispatchQueueResponse> => {
    const params: Record<string, string | number> = { lane: p.lane }
    if (p.cityId !== undefined) params['city_id'] = p.cityId
    if (p.within !== undefined) params['within'] = p.within
    if (p.page !== undefined) params['page'] = p.page
    if (p.limit !== undefined) params['limit'] = p.limit
    return (await api.get('/api/v1/admin/dispatch/queue', { params })).data as DispatchQueueResponse
  },
}
