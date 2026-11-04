import { api } from '@/services/api'
import type { OfferPreview } from './offerModel'

// These endpoints answer in camelCase already (api/src/modules/offers), so unlike most of this app there is no
// camelizeKeys step: the shape is the OfferPreview type as is.

export type PreviewRequest = {
  categoryId: number
  rideType: 'one_way' | 'round_trip' | 'rental'
  distanceKm: number
  durationMin: number
  paymentChannel: 'cash' | 'online' | 'wallet'
  originLat?: number
  originLng?: number
  destinationLat?: number
  destinationLng?: number
  tripHours?: number
  rentalPackageId?: number
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
    paymentChannel: input.paymentChannel,
  }
  if (input.originLat !== undefined) body['originLat'] = input.originLat
  if (input.originLng !== undefined) body['originLng'] = input.originLng
  if (input.destinationLat !== undefined) body['destinationLat'] = input.destinationLat
  if (input.destinationLng !== undefined) body['destinationLng'] = input.destinationLng
  if (input.tripHours !== undefined) body['trip_hours'] = input.tripHours
  if (input.rentalPackageId !== undefined) body['rental_package_id'] = input.rentalPackageId
  if (input.stopCount !== undefined) body['stop_count'] = input.stopCount
  if (input.isReturnCab) body['is_return_cab'] = true
  if (input.scheduledFor) body['scheduledFor'] = input.scheduledFor
  if (input.code) body['code'] = input.code
  if (input.autoOffer) body['autoOffer'] = input.autoOffer
  const res = await api.post<OfferPreview>('/api/v1/offers/preview', body, signal ? { signal } : undefined)
  return res.data
}

export type OfferListItem = { id: string; name: string; kind: string; summary: string; endsAt: string | null }

export async function fetchOffers(): Promise<OfferListItem[]> {
  const res = await api.get<{ offers: OfferListItem[] }>('/api/v1/offers')
  return res.data.offers
}
