import { api } from '@/services/api'
import type { CreatedShare, Share } from './model'

// Live trip sharing (api/src/modules/ride-shares). The API returns each link's URL exactly once, in the create response.

export async function createShares(rideId: string, contactIds: string[] = []): Promise<CreatedShare[]> {
  const body = contactIds.length > 0 ? { contactIds } : {}
  const res = await api.post(`/api/v1/rides/${rideId}/shares`, body)
  return res.data.shares as CreatedShare[]
}

export async function listShares(rideId: string): Promise<Share[]> {
  const res = await api.get(`/api/v1/rides/${rideId}/shares`)
  return res.data.shares as Share[]
}

export async function stopShare(rideId: string, shareId: string): Promise<void> {
  await api.delete(`/api/v1/rides/${rideId}/shares/${shareId}`)
}

export async function stopAllShares(rideId: string): Promise<void> {
  await api.delete(`/api/v1/rides/${rideId}/shares`)
}
