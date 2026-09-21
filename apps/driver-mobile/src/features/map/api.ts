import type { GeoPlaceDetail } from '@ocar/mobile-shared'
import { api } from '@/services/api'

type RawReverseGeocode = { address: string }

// Mirrors rider-mobile's features/booking/api.ts fetchReverseGeocode --
// same endpoint, same shape, duplicated locally since driver-mobile has no
// booking feature to host it in.
export async function fetchReverseGeocode(lat: number, lng: number): Promise<GeoPlaceDetail> {
  const res = await api.get<RawReverseGeocode>('/api/v1/geo/reverse', { params: { lat, lng } })
  return { address: res.data.address, lat, lng }
}
