import { camelizeKeys } from '@ocar/mobile-shared'
import { api } from '@/services/api'
import type { DocumentGateStatus, DriverSession, VehicleInfo, WalletInfo } from './types'

export async function fetchMyVehicle(): Promise<VehicleInfo | null> {
  const res = await api.get<{ vehicle: unknown }>('/api/v1/drivers/onboarding/vehicle-info')
  return res.data.vehicle ? camelizeKeys<VehicleInfo>(res.data.vehicle) : null
}

export async function fetchWalletInfo(): Promise<WalletInfo> {
  const res = await api.get<{ balance: string; is_frozen: boolean }>('/api/v1/payments/wallet/driver')
  return { balance: parseFloat(res.data.balance), isFrozen: res.data.is_frozen }
}

type RawDocumentEntry = { status: string | null; rejection_note: string | null }
type RawDocumentStatus = {
  photos: Record<string, RawDocumentEntry>
  vehicle_docs: Record<string, RawDocumentEntry>
  rejection_reason: string | null
}

// Same pattern as apps/driver/src/lib/useDocumentGate.ts -- prefer the specific
// per-document rejection note over the generic status-transition reason.
export async function fetchDocumentGateStatus(): Promise<DocumentGateStatus> {
  const res = await api.get<RawDocumentStatus>('/api/v1/drivers/onboarding/documents/status')
  const docs = [...Object.values(res.data.photos), ...Object.values(res.data.vehicle_docs)]
  const rejectedDoc = docs.find((doc) => doc.status === 'rejected')
  return {
    hasRejected: !!rejectedDoc,
    rejectionReason: rejectedDoc?.rejection_note ?? res.data.rejection_reason,
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
  vehicleId: number
  categoryId: number
  lat: number
  lng: number
}): Promise<DriverSession> {
  const res = await api.post('/api/v1/rides/sessions/online', {
    mode: 'standard',
    vehicleId: input.vehicleId,
    categoryId: input.categoryId,
    lat: input.lat,
    lng: input.lng,
  })
  return camelizeKeys<DriverSession>(res.data)
}

export async function goOffline(): Promise<void> {
  await api.post('/api/v1/rides/sessions/offline', {})
}
