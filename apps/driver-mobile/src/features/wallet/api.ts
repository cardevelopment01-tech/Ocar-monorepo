import { api } from '@/services/api'

export type LedgerEntry = {
  id: string
  entry_type: string
  amount: string
  direction: 'credit' | 'debit'
  balance_after: string
  ride_id: string | null
  note: string | null
  created_at: string
}

export type DriverWallet = {
  balance: string
  lifetime_topup: string
  lifetime_commission: string
  is_frozen: boolean
  recent_ledger: LedgerEntry[] | null
}

export async function fetchBillingMode(): Promise<'commission' | 'package' | null> {
  const res = await api.get('/api/v1/drivers/me')
  return res.data.billing_mode as 'commission' | 'package' | null
}

export async function fetchDriverWallet(): Promise<DriverWallet> {
  const res = await api.get('/api/v1/payments/wallet/driver')
  return res.data as DriverWallet
}
