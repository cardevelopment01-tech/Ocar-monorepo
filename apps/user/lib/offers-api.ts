import api from './api'
import { getPaymentChannel } from './payment-channel'
import type { OfferPreview } from './offers-model'

// The offers endpoints already answer in camelCase.
export type PreviewRequest = {
  categoryId: number
  rideType: 'one_way' | 'round_trip' | 'rental'
  distanceKm: number
  durationMin: number
  originLat: number
  originLng: number
  destinationLat?: number
  destinationLng?: number
  tripHours?: number
  stopCount?: number
  isReturnCab?: boolean
  scheduledFor?: string
  code?: string
  autoOffer?: string
}

export async function previewOffer(input: PreviewRequest, signal?: AbortSignal): Promise<OfferPreview> {
  const body: Record<string, unknown> = {
    category_id: input.categoryId,
    ride_type: input.rideType,
    distance_km: input.distanceKm,
    duration_min: input.durationMin,
    paymentChannel: getPaymentChannel(),
    originLat: input.originLat,
    originLng: input.originLng,
  }
  if (input.destinationLat !== undefined) body['destinationLat'] = input.destinationLat
  if (input.destinationLng !== undefined) body['destinationLng'] = input.destinationLng
  if (input.tripHours !== undefined) body['trip_hours'] = input.tripHours
  if (input.stopCount !== undefined) body['stop_count'] = input.stopCount
  if (input.isReturnCab) body['is_return_cab'] = true
  if (input.scheduledFor) body['scheduledFor'] = input.scheduledFor
  if (input.code) body['code'] = input.code
  if (input.autoOffer) body['autoOffer'] = input.autoOffer
  const res = await api.post<OfferPreview>('/api/v1/offers/preview', body, signal ? { signal } : undefined)
  return res.data
}
