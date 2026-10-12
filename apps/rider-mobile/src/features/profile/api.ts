import { api } from '@/services/api'

export type ProfileStats = {
  name: string | null
  email: string | null
  phone: string | null
  total_rides: number
  rating_avg: number | null
  wallet_balance: number
}

export async function fetchProfile(): Promise<ProfileStats> {
  const res = await api.get('/api/v1/users/me')
  return res.data.user as ProfileStats
}

export async function updateProfile(data: { full_name: string; email?: string | null }): Promise<ProfileStats> {
  const res = await api.patch('/api/v1/users/me', data)
  return res.data.user as ProfileStats
}

// Emergency contacts (api/src/modules/emergency-contacts)
export type EmergencyContact = { id: string; name: string; phone: string }

export async function fetchEmergencyContacts(): Promise<EmergencyContact[]> {
  const res = await api.get('/api/v1/emergency-contacts')
  return res.data.contacts as EmergencyContact[]
}

export async function addEmergencyContact(name: string, phone10: string): Promise<EmergencyContact> {
  const res = await api.post('/api/v1/emergency-contacts', { name, phone: `+91${phone10}` })
  return res.data.contact as EmergencyContact
}

export async function deleteEmergencyContact(id: string): Promise<void> {
  await api.delete(`/api/v1/emergency-contacts/${id}`)
}

// Saved places writes (reads: features/booking/api.ts fetchSavedPlaces)
export type SavedPlaceInput = { kind: 'home' | 'work' | 'other'; label?: string; address: string; lat: number; lng: number }

export async function createSavedPlace(p: SavedPlaceInput): Promise<void> {
  const body: Record<string, unknown> = { kind: p.kind, address: p.address, latitude: p.lat, longitude: p.lng }
  if (p.label) body['label'] = p.label
  await api.post('/api/v1/saved-places', body)
}

export async function updateSavedPlace(id: number | string, p: Omit<SavedPlaceInput, 'kind'>): Promise<void> {
  const body: Record<string, unknown> = { address: p.address, latitude: p.lat, longitude: p.lng }
  if (p.label) body['label'] = p.label
  await api.patch(`/api/v1/saved-places/${id}`, body)
}

export async function deleteSavedPlace(id: number | string): Promise<void> {
  await api.delete(`/api/v1/saved-places/${id}`)
}
