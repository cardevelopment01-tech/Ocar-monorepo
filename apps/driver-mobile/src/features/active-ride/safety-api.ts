import axios from 'axios'
import { camelizeKeys, type RatingTag, type SOSTriggerResult } from '@ocar/mobile-shared'
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
