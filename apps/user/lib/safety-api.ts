import api from './api'

export type RatingTag = {
  id: string
  tag_key: string
  label: string
  sentiment: 'positive' | 'negative' | 'neutral'
  applies_to: 'driver' | 'user' | 'both'
  sort_order: number
}

export const safetyApi = {
  getTags: (direction: 'user_to_driver' | 'driver_to_user' = 'user_to_driver') =>
    api.get<RatingTag[]>('/api/v1/safety/tags', { params: { direction } }).then(r => r.data),

  submitRating: (body: {
    rideId: string
    direction: 'user_to_driver' | 'driver_to_user'
    score: number
    toDriverId?: string
    toUserId?: string
    tagIds?: string[]
    comment?: string
  }) => api.post('/api/v1/safety/ratings', body).then(r => r.data),

  triggerSos: (body: {
    rideId: string
    severity?: 'low' | 'medium' | 'high'
    lat?: number
    lng?: number
    notes?: string
  }) => api.post('/api/v1/safety/sos', body).then(r => r.data),

  createDispute: (body: {
    rideId: string
    type: string
    description: string
    priority?: number
  }) => api.post('/api/v1/safety/disputes', body).then(r => r.data),
}
