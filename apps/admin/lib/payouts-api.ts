import api from './api'

export interface SettlementBatchSummary {
  period_from: string
  period_to: string
  run_type: 'scheduled' | 'instant'
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'on_hold'
  driver_count: string
  total: string
}

export interface SettlementRow {
  id: string
  driver_id: string
  driver_name: string
  net_payout: string
  fee: string
  status: string
  mode: string | null
  utr: string | null
  razorpay_payout_id: string | null
  failure_reason: string | null
  created_at: string
}

export interface StuckSettlement {
  id: string
  driver_id: string
  driver_name: string
  net_payout: string
  created_at: string
  razorpay_payout_id: string | null
  stuck_reason: 'never_submitted' | 'awaiting_webhook'
}

export interface UnverifiedBankAccount {
  id: string
  driver_id: string
  driver_name: string
  ifsc: string
  status: string
  created_at: string
}

export type BankAccountStatus = 'verified' | 'invalid' | 'pending_verification'

export interface TaxStatement {
  fy: string
  totalTds: string
  totalTaxableBase: string
  entries: unknown[]
}

export const payoutsApi = {
  listBatches: async (): Promise<SettlementBatchSummary[]> => {
    const { data } = await api.get<{ batches: SettlementBatchSummary[] }>('/api/v1/admin/payouts/batches')
    return data.batches
  },
  getBatchDetail: async (periodFrom: string, periodTo: string): Promise<SettlementRow[]> => {
    const { data } = await api.get<{ settlements: SettlementRow[] }>(
      `/api/v1/admin/payouts/batches/${periodFrom}/${periodTo}`
    )
    return data.settlements
  },
  approveBatch: async (periodFrom: string, periodTo: string): Promise<number> => {
    const { data } = await api.post<{ approvedCount: number }>(
      `/api/v1/admin/payouts/batches/${periodFrom}/${periodTo}/approve`
    )
    return data.approvedCount
  },
  retrySettlement: async (id: string): Promise<void> => {
    await api.post(`/api/v1/admin/payouts/${id}/retry`)
  },
  // For 'never_submitted' stuck rows only — those are status='processing',
  // not 'failed', so retrySettlement's endpoint (status='failed' guard)
  // always rejects them. This attempts submission for the row immediately.
  retryNeverSubmittedSettlement: async (id: string): Promise<void> => {
    await api.post(`/api/v1/admin/payouts/${id}/retry-submit`)
  },
  placeHold: async (driverId: string, reason: string): Promise<void> => {
    await api.post('/api/v1/admin/payouts/holds', { driverId, reason })
  },
  releaseHold: async (driverId: string): Promise<void> => {
    await api.delete(`/api/v1/admin/payouts/holds/${driverId}`)
  },
  createAdjustment: async (driverId: string, amount: number, reason: string): Promise<void> => {
    await api.post('/api/v1/admin/payouts/adjustments', { driverId, amount, reason })
  },
  listStuckSettlements: async (): Promise<StuckSettlement[]> => {
    const { data } = await api.get<{ settlements: StuckSettlement[] }>('/api/v1/admin/payouts/reconciliation/stuck')
    return data.settlements
  },
  listUnverifiedBankAccounts: async (): Promise<UnverifiedBankAccount[]> => {
    const { data } = await api.get<{ accounts: UnverifiedBankAccount[] }>('/api/v1/admin/payouts/bank-accounts/unverified')
    return data.accounts
  },
  setBankAccountStatus: async (id: string, status: BankAccountStatus): Promise<void> => {
    await api.patch(`/api/v1/admin/payouts/bank-accounts/${id}/status`, { status })
  },
  getTaxStatement: async (driverId: string, fy: string): Promise<TaxStatement> => {
    const { data } = await api.get<TaxStatement>(`/api/v1/admin/payouts/tax-statement/${driverId}/${fy}`)
    return data
  },
  verifyDriverPan: async (driverId: string, verified: boolean): Promise<void> => {
    await api.patch(`/api/v1/admin/payouts/tax-profile/${driverId}`, { verified })
  },
}
