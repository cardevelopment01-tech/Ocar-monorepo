export interface PackageTier {
  id: string
  label: string
  price: string
  threshold_value: string
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface DriverPackageWallet {
  id: string
  driver_id: string
  balance: string
  is_frozen: boolean
  frozen_reason: string | null
  lifetime_topup: string
  lifetime_consumed: string
}

export interface DriverPackageLedgerEntry {
  id: string
  entry_type: 'topup' | 'ride_consumption' | 'admin_adjustment'
  amount: string
  direction: 'credit' | 'debit'
  balance_after: string
  ride_id: string | null
  reference_id: string | null
  note: string | null
  created_at: string
}
