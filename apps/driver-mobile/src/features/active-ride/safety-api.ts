import { camelizeKeys, type RatingTag } from '@ocar/mobile-shared'
import { api } from '@/services/api'

export async function fetchRiderTags(): Promise<RatingTag[]> {
  const res = await api.get<unknown[]>('/api/v1/safety/tags', { params: { direction: 'driver_to_user' } })
  return camelizeKeys<RatingTag[]>(res.data)
}

export async function rateRider(rideId: string, score: number, tagIds?: string[]): Promise<void> {
  const body: Record<string, unknown> = { rideId, direction: 'driver_to_user', score }
  if (tagIds && tagIds.length > 0) body['tagIds'] = tagIds
  await api.post('/api/v1/safety/ratings', body)
}
