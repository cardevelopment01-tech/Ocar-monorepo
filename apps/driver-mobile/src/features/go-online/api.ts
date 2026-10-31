import { camelizeKeys, track } from '@ocar/mobile-shared'
import { api } from '@/services/api'
import { sharedGet } from '@/services/api/sharedGet'
import type { City, DocumentGateStatus, DriverSession, VehicleInfo, WalletInfo } from './types'

export async function fetchMyVehicle(): Promise<VehicleInfo | null> {
  const data = await sharedGet<{ vehicle: unknown }>('/api/v1/drivers/onboarding/vehicle-info')
  return data.vehicle ? camelizeKeys<VehicleInfo>(data.vehicle) : null
}

export async function fetchWalletInfo(): Promise<WalletInfo> {
  const res = await api.get<{ balance: string; is_frozen: boolean; min_balance?: number }>('/api/v1/payments/wallet/driver')
  // minBalance null = the server did not say, so the app does not gate on its own guess.
  return { balance: parseFloat(res.data.balance), isFrozen: res.data.is_frozen, minBalance: typeof res.data.min_balance === 'number' ? res.data.min_balance : null }
}

type RawDocumentEntry = { status: string | null; rejection_note: string | null; uploaded?: boolean }
type RawDocumentStatus = {
  photos: Record<string, RawDocumentEntry>
  vehicle_docs: Record<string, RawDocumentEntry>
  rejection_reason: string | null
}

// Same pattern as apps/driver/src/lib/useDocumentGate.ts -- prefer the specific
// per-document rejection note over the generic status-transition reason.
// Several screens mount useDocumentGate and refetch on focus; callers that ask while a request is
// already in flight (layout + Home focusing together) share it instead of each sending their own.
let gateInFlight: Promise<DocumentGateStatus> | null = null

export function fetchDocumentGateStatus(): Promise<DocumentGateStatus> {
  gateInFlight ??= loadDocumentGateStatus().finally(() => { gateInFlight = null })
  return gateInFlight
}

async function loadDocumentGateStatus(): Promise<DocumentGateStatus> {
  const data = await sharedGet<RawDocumentStatus>('/api/v1/drivers/onboarding/documents/status')
  const docs = [...Object.values(data.photos), ...Object.values(data.vehicle_docs)]
  const rejectedDoc = docs.find((doc) => doc.status === 'rejected')
  return {
    hasRejected: !!rejectedDoc,
    rejectionReason: rejectedDoc?.rejection_note ?? data.rejection_reason,
    isMissingUpload: rejectedDoc?.uploaded === false,
  }
}

// GET /sessions/current responds 200 with a null body when there's no active
// session (repo.getActiveSession returns null, not a 404) -- a real network/
// server failure still throws and must be handled as a failure by the caller,
// not silently treated the same as "no session" (Eng review finding).
export async function fetchCurrentSession(): Promise<DriverSession | null> {
  const res = await api.get('/api/v1/rides/sessions/current')
  return res.data ? camelizeKeys<DriverSession>(res.data) : null
}

// Body fields are camelCase -- api/src/modules/rides/rides.routes.ts passes
// req.body straight through to service.goOnline() without a case-conversion layer.
export async function goOnline(input: {
  mode: 'standard' | 'return_cab'
  vehicleId: number
  categoryId: number
  lat: number
  lng: number
  destinationCityId?: number
}): Promise<DriverSession> {
  const body: Record<string, unknown> = {
    mode: input.mode,
    vehicleId: input.vehicleId,
    categoryId: input.categoryId,
    lat: input.lat,
    lng: input.lng,
  }
  if (input.destinationCityId !== undefined) body['destinationCityId'] = input.destinationCityId
  const res = await api.post('/api/v1/rides/sessions/online', body)
  track('go_online')
  return camelizeKeys<DriverSession>(res.data)
}

export async function goOffline(): Promise<void> {
  await api.post('/api/v1/rides/sessions/offline', {})
  track('go_offline')
}

export async function fetchCities(): Promise<City[]> {
  const res = await api.get<City[]>('/api/v1/geo/cities')
  return res.data ?? []
}
