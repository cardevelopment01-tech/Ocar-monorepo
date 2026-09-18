import { camelizeKeys, type RatingTag } from '@ocar/mobile-shared'
import { api } from '@/services/api'

export async function fetchRatingTags(direction: 'user_to_driver' | 'driver_to_user' = 'user_to_driver'): Promise<RatingTag[]> {
  const res = await api.get<unknown[]>('/api/v1/safety/tags', { params: { direction } })
  return camelizeKeys<RatingTag[]>(res.data)
}

export type SubmitRatingInput = {
  rideId: string
  direction: 'user_to_driver' | 'driver_to_user'
  score: number
  tagIds?: string[]
}

export async function submitRating(input: SubmitRatingInput): Promise<void> {
  await api.post('/api/v1/safety/ratings', input)
}
