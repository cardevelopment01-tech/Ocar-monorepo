import api from './api'

export type RatingTag = {
  id: string
  tag_key: string
  label: string
  sentiment: 'positive' | 'negative' | 'neutral'
  applies_to: 'driver' | 'user' | 'both'
  sort_order: number
}

export const driverSafetyApi = {
  triggerSos: async (params: {
    rideId: string
    lat?: number
    lng?: number
    severity?: 'low' | 'medium' | 'high'
  }): Promise<void> => {
    const body: Record<string, unknown> = {
      rideId:   params.rideId,
      severity: params.severity ?? 'high',
    }
    if (params.lat !== undefined) body['lat'] = params.lat
    if (params.lng !== undefined) body['lng'] = params.lng
    await api.post('/api/v1/safety/sos', body)
  },

  getRiderTags: async (): Promise<RatingTag[]> => {
    const res = await api.get('/api/v1/safety/tags', { params: { direction: 'driver_to_user' } })
    return res.data as RatingTag[]
  },

  rateRider: async (rideId: string, score: number, tagIds?: string[]): Promise<void> => {
    const body: Record<string, unknown> = { rideId, direction: 'driver_to_user', score }
    if (tagIds && tagIds.length > 0) body['tagIds'] = tagIds
    await api.post('/api/v1/safety/ratings', body)
  },
}
