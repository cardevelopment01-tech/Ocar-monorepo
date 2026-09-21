import axios from 'axios'
import { camelizeKeys, type RatingTag, type SOSTriggerResult } from '@ocar/mobile-shared'
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

export async function triggerSos(rideId: string, lat?: number, lng?: number): Promise<SOSTriggerResult> {
  try {
    const body: Record<string, unknown> = { rideId }
    if (lat !== undefined) body['lat'] = lat
    if (lng !== undefined) body['lng'] = lng
    await api.post('/api/v1/safety/sos', body)
    return { ok: true }
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 429) {
      return { ok: false, reason: 'rate_limited' }
    }
    return { ok: false, reason: 'error' }
  }
}
