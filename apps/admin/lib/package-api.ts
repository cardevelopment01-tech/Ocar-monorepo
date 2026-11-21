import api from './api'

export interface PackageTier {
  id: number
  label: string
  price: string
  threshold_value: string
  is_active: boolean
  /** Which drivers see the plan: every car type shares 'cab'; autos have their own. */
  vehicle_group: 'cab' | 'auto'
  /** How long a purchase lasts. */
  validity_days: number
  /** GST added on top of the price at purchase, and what the driver is charged (worked out by the server). */
  gst_percent: number
  gst_amount: string
  total_amount: string
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
  createTier: (data: { label: string; price: number; thresholdValue: number; vehicleGroup: 'cab' | 'auto'; validityDays: number }) =>
    api.post('/api/v1/admin/package-tiers', data).then(r => r.data as PackageTier),
  updateTier: (id: number, data: Partial<{ label: string; price: number; thresholdValue: number; isActive: boolean; vehicleGroup: 'cab' | 'auto'; validityDays: number }>) =>
    api.patch(`/api/v1/admin/package-tiers/${id}`, data).then(r => r.data as PackageTier),
  getDriverDetail: (driverId: number) =>
    api.get(`/api/v1/admin/drivers/${driverId}/package`).then(r => r.data as DriverPackageDetail),
  adjustDriverBalance: (driverId: number, amount: number, reason: string) =>
    api.patch(`/api/v1/admin/drivers/${driverId}/package/balance`, { amount, reason }).then(r => r.data),
}
