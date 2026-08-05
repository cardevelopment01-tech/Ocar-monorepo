import api from './api'

export interface PackageTier {
  id: number
  label: string
  price: string
  threshold_value: string
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface DriverPackageDetail {
  wallet: { balance: string; is_frozen: boolean } | null
  ledger: Array<{
    id: number; entry_type: string; amount: string; direction: string
    balance_after: string; ride_id: number | null; note: string | null; created_at: string
  }>
}

export const packageApi = {
  listTiers: () => api.get('/api/v1/admin/package-tiers').then(r => r.data as PackageTier[]),
  createTier: (data: { label: string; price: number; thresholdValue: number }) =>
    api.post('/api/v1/admin/package-tiers', data).then(r => r.data as PackageTier),
  updateTier: (id: number, data: Partial<{ label: string; price: number; thresholdValue: number; isActive: boolean }>) =>
    api.patch(`/api/v1/admin/package-tiers/${id}`, data).then(r => r.data as PackageTier),
  getDriverDetail: (driverId: number) =>
    api.get(`/api/v1/admin/drivers/${driverId}/package`).then(r => r.data as DriverPackageDetail),
  adjustDriverBalance: (driverId: number, amount: number, reason: string) =>
    api.patch(`/api/v1/admin/drivers/${driverId}/package/balance`, { amount, reason }).then(r => r.data),
}
