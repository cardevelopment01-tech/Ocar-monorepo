export interface PackageTier {
  id: string
  label: string
  price: string
  threshold_value: string
  is_active: boolean
  /** Which drivers see this plan: every car type shares 'cab', autos have 'auto'. */
  vehicle_group: 'cab' | 'auto'
  /** How long a purchase of this plan lasts. */
  validity_days: number
  created_at: string
  updated_at: string
}

/** A plan as the driver apps show it: the price, the GST added on top, what is charged, and what it buys. */
export interface PackageTierView extends PackageTier {
  gst_percent: number
  gst_amount: string
  total_amount: string
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
  entry_type: 'topup' | 'ride_consumption' | 'admin_adjustment' | 'expiry'
  amount: string
  direction: 'credit' | 'debit'
  balance_after: string
  ride_id: string | null
  reference_id: string | null
  note: string | null
  created_at: string
}
