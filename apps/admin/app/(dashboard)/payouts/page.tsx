'use client'

import React, { useEffect, useState } from 'react'
import { Wallet } from 'lucide-react'
import StatusPill from '@/components/ui/StatusPill'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import DataTable from '@/components/ui/DataTable'
import {
  payoutsApi,
  type SettlementBatchSummary,
  type SettlementRow,
  type StuckSettlement,
  type UnverifiedBankAccount,
  type TaxStatement,
} from '@/lib/payouts-api'

export default function PayoutsPage() {
  const [confirm, setConfirm] = useState<null | 'hold' | 'release' | 'adjust' | 'pan-verify' | 'pan-unverify'>(null)

  // --- Batches ---
  const [batches, setBatches] = useState<SettlementBatchSummary[]>([])
  const [batchesLoading, setBatchesLoading] = useState(true)
  const [selected, setSelected] = useState<SettlementBatchSummary | null>(null)
  const [rows, setRows] = useState<SettlementRow[]>([])
  const [approving, setApproving] = useState(false)

  const loadBatches = async () => {
    setBatchesLoading(true)
    try {
      setBatches(await payoutsApi.listBatches())
    } finally {
      setBatchesLoading(false)
    }
  }

  useEffect(() => { void loadBatches() }, [])

  async function openBatch(batch: SettlementBatchSummary) {
    setSelected(batch)
    const detail = await payoutsApi.getBatchDetail(batch.period_from, batch.period_to)
    setRows(detail)
  }

  async function approve(batch: SettlementBatchSummary) {
    setApproving(true)
    try {
      await payoutsApi.approveBatch(batch.period_from, batch.period_to)
      await loadBatches()
    } finally {
      setApproving(false)
    }
  }

  async function retryRow(id: string) {
    await payoutsApi.retrySettlement(id)
    if (selected) await openBatch(selected)
  }

  // --- Holds ---
  const [holdDriverId, setHoldDriverId] = useState('')
  const [holdReason, setHoldReason] = useState('')
  const [holdBusy, setHoldBusy] = useState(false)
  const [holdMsg, setHoldMsg] = useState('')
  const [releaseDriverId, setReleaseDriverId] = useState('')
  const [releaseBusy, setReleaseBusy] = useState(false)
  const [releaseMsg, setReleaseMsg] = useState('')

  async function placeHold() {
    if (!holdDriverId || !holdReason.trim()) return
    setHoldBusy(true)
    setHoldMsg('')
    try {
      await payoutsApi.placeHold(holdDriverId, holdReason.trim())
      setHoldMsg('Hold placed.')
      setHoldDriverId('')
      setHoldReason('')
    } catch {
      setHoldMsg('Failed to place hold (driver may already be on hold).')
    } finally {
      setHoldBusy(false)
    }
  }

  async function releaseHold() {
    if (!releaseDriverId) return
    setReleaseBusy(true)
    setReleaseMsg('')
    try {
      await payoutsApi.releaseHold(releaseDriverId)
      setReleaseMsg('Hold released.')
      setReleaseDriverId('')
    } catch {
      setReleaseMsg('Failed to release hold (nothing found to release).')
    } finally {
      setReleaseBusy(false)
    }
  }

  // --- Manual adjustment ---
  const [adjDriverId, setAdjDriverId] = useState('')
  const [adjAmount, setAdjAmount] = useState('')
  const [adjReason, setAdjReason] = useState('')
  const [adjBusy, setAdjBusy] = useState(false)
  const [adjMsg, setAdjMsg] = useState('')

  async function submitAdjustment() {
    const amount = Number(adjAmount)
    if (!adjDriverId || !adjReason.trim() || !adjAmount || Number.isNaN(amount) || amount === 0) return
    setAdjBusy(true)
    setAdjMsg('')
    try {
      await payoutsApi.createAdjustment(adjDriverId, amount, adjReason.trim())
      setAdjMsg('Adjustment recorded.')
      setAdjDriverId('')
      setAdjAmount('')
      setAdjReason('')
    } catch {
      setAdjMsg('Failed to record adjustment.')
    } finally {
      setAdjBusy(false)
    }
  }

  // --- Stuck settlements ---
  const [stuck, setStuck] = useState<StuckSettlement[]>([])
  const [stuckLoading, setStuckLoading] = useState(true)

  const loadStuck = async () => {
    setStuckLoading(true)
    try {
      setStuck(await payoutsApi.listStuckSettlements())
    } finally {
      setStuckLoading(false)
    }
  }

  useEffect(() => { void loadStuck() }, [])

  async function retryStuck(id: string) {
    // Only ever called for 'never_submitted' rows (see the button below) —
    // those are status='processing', so the /:id/retry endpoint (which only
    // matches status='failed') would always reject them.
    await payoutsApi.retryNeverSubmittedSettlement(id)
    await loadStuck()
  }

  // --- Bank account verification ---
  const [bankAccounts, setBankAccounts] = useState<UnverifiedBankAccount[]>([])
  const [bankLoading, setBankLoading] = useState(true)

  const loadBankAccounts = async () => {
    setBankLoading(true)
    try {
      setBankAccounts(await payoutsApi.listUnverifiedBankAccounts())
    } finally {
      setBankLoading(false)
    }
  }

  useEffect(() => { void loadBankAccounts() }, [])

  async function setBankStatus(id: string, status: 'verified' | 'invalid') {
    await payoutsApi.setBankAccountStatus(id, status)
    await loadBankAccounts()
  }

  // --- PAN verification ---
  const [panDriverId, setPanDriverId] = useState('')
  const [panBusy, setPanBusy] = useState(false)
  const [panMsg, setPanMsg] = useState('')

  async function setPanVerified(verified: boolean) {
    if (!panDriverId) return
    setPanBusy(true)
    setPanMsg('')
    try {
      await payoutsApi.verifyDriverPan(panDriverId, verified)
      setPanMsg(verified ? 'PAN marked verified.' : 'PAN marked unverified.')
      setPanDriverId('')
    } catch {
      setPanMsg('Failed to update PAN verification (driver may not have submitted a PAN yet).')
    } finally {
      setPanBusy(false)
    }
  }

  // --- Tax statement lookup ---
  const [taxDriverId, setTaxDriverId] = useState('')
  const [taxFy, setTaxFy] = useState('')
  const [taxBusy, setTaxBusy] = useState(false)
  const [taxResult, setTaxResult] = useState<TaxStatement | null>(null)
  const [taxError, setTaxError] = useState('')

  async function lookupTaxStatement() {
    if (!taxDriverId || !taxFy.trim()) return
    setTaxBusy(true)
    setTaxError('')
    setTaxResult(null)
    try {
      setTaxResult(await payoutsApi.getTaxStatement(taxDriverId, taxFy.trim()))
    } catch {
      setTaxError('Could not fetch tax statement for that driver/FY.')
    } finally {
      setTaxBusy(false)
    }
  }

  const batchColumns = [
    { key: 'period', header: 'Period', render: (b: SettlementBatchSummary) => <span className="text-text-primary">{b.period_from} → {b.period_to}</span> },
    { key: 'run_type', header: 'Type', render: (b: SettlementBatchSummary) => <span className="text-text-muted text-xs capitalize">{b.run_type}</span> },
    { key: 'status', header: 'Status', render: (b: SettlementBatchSummary) => <StatusPill status={b.status} /> },
    { key: 'driver_count', header: 'Drivers', render: (b: SettlementBatchSummary) => <span className="text-text-muted text-xs">{b.driver_count}</span> },
    { key: 'total', header: 'Total', render: (b: SettlementBatchSummary) => <span className="font-semibold text-text-primary">₹{b.total}</span> },
    { key: 'actions', header: '', render: (b: SettlementBatchSummary) => (
        <div className="flex gap-3 items-center">
          <button className="text-primary text-xs font-semibold cursor-pointer" onClick={() => void openBatch(b)}>View</button>
          {b.status === 'pending' && (
            <button className="text-primary text-xs font-semibold cursor-pointer disabled:opacity-50" disabled={approving} onClick={() => void approve(b)}>
              Approve
            </button>
          )}
        </div>
      ) },
  ]

  const settlementColumns = [
    { key: 'driver_name', header: 'Driver', render: (r: SettlementRow) => <span className="text-text-primary">{r.driver_name}</span> },
    { key: 'net_payout', header: 'Amount', render: (r: SettlementRow) => <span className="font-semibold text-text-primary">₹{r.net_payout}</span> },
    { key: 'fee', header: 'Fee', render: (r: SettlementRow) => <span className="text-text-muted text-xs">₹{r.fee}</span> },
    { key: 'status', header: 'Status', render: (r: SettlementRow) => <StatusPill status={r.status} /> },
    { key: 'utr', header: 'UTR', render: (r: SettlementRow) => <span className="font-mono text-xs text-text-muted">{r.utr ?? '—'}</span> },
    { key: 'failure_reason', header: 'Failure reason', render: (r: SettlementRow) => <span className="text-xs text-text-muted">{r.failure_reason ?? '—'}</span> },
    { key: 'actions', header: '', render: (r: SettlementRow) => r.status === 'failed'
        ? <button className="text-primary text-xs font-semibold cursor-pointer" onClick={() => void retryRow(r.id)}>Retry</button> : null },
  ]

  const stuckColumns = [
    { key: 'driver_name', header: 'Driver', render: (s: StuckSettlement) => <span className="text-text-primary">{s.driver_name}</span> },
    { key: 'net_payout', header: 'Amount', render: (s: StuckSettlement) => <span className="font-semibold text-text-primary">₹{s.net_payout}</span> },
    { key: 'created_at', header: 'Created', render: (s: StuckSettlement) => <span className="text-xs text-text-muted">{new Date(s.created_at).toLocaleString('en-IN')}</span> },
    { key: 'razorpay_payout_id', header: 'Razorpay Payout ID', render: (s: StuckSettlement) => <span className="font-mono text-xs text-text-muted">{s.razorpay_payout_id ?? '—'}</span> },
    { key: 'stuck_reason', header: 'Reason', render: (s: StuckSettlement) => (
        <span className={s.stuck_reason === 'never_submitted' ? 'pill-danger' : 'pill-warning'}>
          {s.stuck_reason === 'never_submitted' ? 'Never submitted' : 'Awaiting webhook'}
        </span>
      ) },
    { key: 'actions', header: '', render: (s: StuckSettlement) => s.stuck_reason === 'never_submitted'
        ? <button className="text-primary text-xs font-semibold cursor-pointer" onClick={() => void retryStuck(s.id)}>Retry now</button> : null },
  ]

  const bankColumns = [
    { key: 'driver_name', header: 'Driver', render: (a: UnverifiedBankAccount) => <span className="text-text-primary">{a.driver_name}</span> },
    { key: 'ifsc', header: 'IFSC', render: (a: UnverifiedBankAccount) => <span className="font-mono text-xs text-text-muted">{a.ifsc}</span> },
    { key: 'status', header: 'Status', render: (a: UnverifiedBankAccount) => <StatusPill status={a.status} /> },
    { key: 'created_at', header: 'Added', render: (a: UnverifiedBankAccount) => <span className="text-xs text-text-muted">{new Date(a.created_at).toLocaleString('en-IN')}</span> },
    { key: 'actions', header: '', render: (a: UnverifiedBankAccount) => (
        <div className="flex gap-3">
          <button className="text-success text-xs font-semibold cursor-pointer" onClick={() => void setBankStatus(a.id, 'verified')}>Verify</button>
          <button className="text-danger text-xs font-semibold cursor-pointer" onClick={() => void setBankStatus(a.id, 'invalid')}>Reject</button>
        </div>
      ) },
  ]

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 mb-1">
        <Wallet className="w-5 h-5 text-primary" />
        <div>
          <h2 className="text-lg font-bold text-text-primary">Driver Payouts</h2>
          <p className="text-xs text-text-muted">Settlement batches, holds, adjustments, and reconciliation</p>
        </div>
      </div>

      {/* Batches */}
      <div className="admin-card">
        <p className="text-sm font-semibold text-text-primary mb-3">Settlement Batches</p>
        <DataTable
          columns={batchColumns as unknown as { key: string; header: string; render?: (row: Record<string, unknown>) => React.ReactNode }[]}
          data={batches as unknown as Record<string, unknown>[]}
          isLoading={batchesLoading}
          emptyMessage="No settlement batches yet."
        />

        {selected && (
          <div className="mt-5 pt-4 border-t border-border-light">
            <p className="text-sm font-semibold text-text-primary mb-3">
              {selected.period_from} → {selected.period_to} — settlements
            </p>
            <DataTable
              columns={settlementColumns as unknown as { key: string; header: string; render?: (row: Record<string, unknown>) => React.ReactNode }[]}
              data={rows as unknown as Record<string, unknown>[]}
              emptyMessage="No settlements in this batch."
            />
          </div>
        )}
      </div>

      {/* Holds */}
      <div className="admin-card">
        <p className="text-sm font-semibold text-text-primary mb-3">Payout Holds</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <p className="text-xs font-semibold text-text-secondary">Place a hold</p>
            <input
              value={holdDriverId}
              onChange={e => setHoldDriverId(e.target.value)}
              placeholder="Driver ID"
              aria-label="Driver ID"
              className="w-full px-3 py-2 text-sm border border-border rounded-xl outline-none focus:border-primary transition-colors"
            />
            <input
              value={holdReason}
              onChange={e => setHoldReason(e.target.value)}
              placeholder="Reason"
              aria-label="Hold reason"
              className="w-full px-3 py-2 text-sm border border-border rounded-xl outline-none focus:border-primary transition-colors"
            />
            <button
              onClick={() => setConfirm('hold')}
              disabled={holdBusy || !holdDriverId || !holdReason.trim()}
              className="px-4 py-2 rounded-xl text-sm font-semibold text-white bg-primary hover:opacity-90 transition-opacity disabled:opacity-50 cursor-pointer"
            >
              {holdBusy ? 'Placing…' : 'Place Hold'}
            </button>
            {holdMsg && <p className="text-xs text-text-muted">{holdMsg}</p>}
          </div>
          <div className="space-y-2">
            <p className="text-xs font-semibold text-text-secondary">Release a hold</p>
            <input
              value={releaseDriverId}
              onChange={e => setReleaseDriverId(e.target.value)}
              placeholder="Driver ID"
              aria-label="Driver ID to release"
              className="w-full px-3 py-2 text-sm border border-border rounded-xl outline-none focus:border-primary transition-colors"
            />
            <button
              onClick={() => setConfirm('release')}
              disabled={releaseBusy || !releaseDriverId}
              className="px-4 py-2 rounded-xl text-sm font-semibold text-text-secondary border border-border hover:bg-surface-2 transition-colors disabled:opacity-50 cursor-pointer"
            >
              {releaseBusy ? 'Releasing…' : 'Release Hold'}
            </button>
            {releaseMsg && <p className="text-xs text-text-muted">{releaseMsg}</p>}
          </div>
        </div>
      </div>

      {/* Manual adjustment */}
      <div className="admin-card">
        <p className="text-sm font-semibold text-text-primary mb-3">Manual Adjustment</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-start">
          <input
            value={adjDriverId}
            onChange={e => setAdjDriverId(e.target.value)}
            placeholder="Driver ID"
            aria-label="Driver ID"
            className="w-full px-3 py-2 text-sm border border-border rounded-xl outline-none focus:border-primary transition-colors"
          />
          <input
            value={adjAmount}
            onChange={e => setAdjAmount(e.target.value)}
            type="number"
            placeholder="Amount (negative to deduct)"
            aria-label="Adjustment amount"
            className="w-full px-3 py-2 text-sm border border-border rounded-xl outline-none focus:border-primary transition-colors"
          />
          <input
            value={adjReason}
            onChange={e => setAdjReason(e.target.value)}
            placeholder="Reason"
            aria-label="Adjustment reason"
            className="w-full px-3 py-2 text-sm border border-border rounded-xl outline-none focus:border-primary transition-colors"
          />
        </div>
        <button
          onClick={() => setConfirm('adjust')}
          disabled={adjBusy || !adjDriverId || !adjAmount || !adjReason.trim()}
          className="mt-3 px-4 py-2 rounded-xl text-sm font-semibold text-white bg-primary hover:opacity-90 transition-opacity disabled:opacity-50 cursor-pointer"
        >
          {adjBusy ? 'Submitting…' : 'Submit Adjustment'}
        </button>
        {adjMsg && <p className="text-xs text-text-muted mt-2">{adjMsg}</p>}
      </div>

      {/* Stuck settlements */}
      <div className="admin-card">
        <p className="text-sm font-semibold text-text-primary mb-3">Stuck Settlements</p>
        <DataTable
          columns={stuckColumns as unknown as { key: string; header: string; render?: (row: Record<string, unknown>) => React.ReactNode }[]}
          data={stuck as unknown as Record<string, unknown>[]}
          isLoading={stuckLoading}
          emptyMessage="No stuck settlements."
        />
      </div>

      {/* Bank account verification */}
      <div className="admin-card">
        <p className="text-sm font-semibold text-text-primary mb-3">Bank Account Verification</p>
        <DataTable
          columns={bankColumns as unknown as { key: string; header: string; render?: (row: Record<string, unknown>) => React.ReactNode }[]}
          data={bankAccounts as unknown as Record<string, unknown>[]}
          isLoading={bankLoading}
          emptyMessage="Nothing pending verification."
        />
      </div>

      {/* PAN verification */}
      <div className="admin-card">
        <p className="text-sm font-semibold text-text-primary mb-3">PAN Verification</p>
        <p className="text-xs text-text-muted mb-3">Verifying a driver&apos;s submitted PAN lowers their TDS rate from 20% to 1%.</p>
        <div className="flex gap-3 items-start">
          <input
            value={panDriverId}
            onChange={e => setPanDriverId(e.target.value)}
            placeholder="Driver ID"
            aria-label="Driver ID"
            className="w-full max-w-xs px-3 py-2 text-sm border border-border rounded-xl outline-none focus:border-primary transition-colors"
          />
          <button
            onClick={() => setConfirm('pan-verify')}
            disabled={panBusy || !panDriverId}
            className="px-4 py-2 rounded-xl text-sm font-semibold text-white bg-primary hover:opacity-90 transition-opacity disabled:opacity-50 cursor-pointer"
          >
            Verify
          </button>
          <button
            onClick={() => setConfirm('pan-unverify')}
            disabled={panBusy || !panDriverId}
            className="px-4 py-2 rounded-xl text-sm font-semibold text-text-secondary border border-border hover:bg-surface-2 transition-colors disabled:opacity-50 cursor-pointer"
          >
            Unverify
          </button>
        </div>
        {panMsg && <p className="text-xs text-text-muted mt-2">{panMsg}</p>}
      </div>

      {/* Tax statement lookup */}
      <div className="admin-card">
        <p className="text-sm font-semibold text-text-primary mb-3">Tax Statement Lookup</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-start">
          <input
            value={taxDriverId}
            onChange={e => setTaxDriverId(e.target.value)}
            placeholder="Driver ID"
            className="w-full px-3 py-2 text-sm border border-border rounded-xl outline-none focus:border-primary transition-colors"
          />
          <input
            value={taxFy}
            onChange={e => setTaxFy(e.target.value)}
            placeholder="Financial year, e.g. 2026-2027"
            className="w-full px-3 py-2 text-sm border border-border rounded-xl outline-none focus:border-primary transition-colors"
          />
          <button
            onClick={() => void lookupTaxStatement()}
            disabled={taxBusy || !taxDriverId || !taxFy.trim()}
            className="px-4 py-2 rounded-xl text-sm font-semibold text-white bg-primary hover:opacity-90 transition-opacity disabled:opacity-50 cursor-pointer"
          >
            {taxBusy ? 'Looking up…' : 'Fetch'}
          </button>
        </div>
        {taxError && <p className="text-xs text-danger mt-2">{taxError}</p>}
        {taxResult && (
          <div className="mt-4 pt-4 border-t border-border-light space-y-2">
            <p className="text-xs text-text-muted">
              FY {taxResult.fy} — Total TDS: <span className="font-semibold text-text-primary">₹{taxResult.totalTds}</span>
              {' · '}Total taxable base: <span className="font-semibold text-text-primary">₹{taxResult.totalTaxableBase}</span>
            </p>
            <p className="text-xs text-text-muted">{taxResult.entries.length} entries</p>
          </div>
        )}
      </div>

      {confirm && (
        <ConfirmDialog
          open
          onOpenChange={v => { if (!v) setConfirm(null) }}
          {...{
            hold: {
              title: 'Place payout hold?',
              description: `Hold all payouts for driver ${holdDriverId}? Reason: ${holdReason}`,
              confirmLabel: 'Place Hold',
              variant: 'warning' as const,
              onConfirm: () => void placeHold(),
            },
            release: {
              title: 'Release payout hold?',
              description: `Release the payout hold for driver ${releaseDriverId}?`,
              confirmLabel: 'Release Hold',
              variant: 'warning' as const,
              onConfirm: () => void releaseHold(),
            },
            adjust: {
              title: 'Record manual adjustment?',
              description: `Apply a ₹${adjAmount} adjustment to driver ${adjDriverId} (reason: ${adjReason}). This directly changes what the driver is paid.`,
              confirmLabel: 'Record Adjustment',
              variant: 'danger' as const,
              onConfirm: () => void submitAdjustment(),
            },
            'pan-verify': {
              title: 'Mark PAN verified?',
              description: `Verifying driver ${panDriverId}'s PAN lowers their TDS rate from 20% to 1%.`,
              confirmLabel: 'Mark Verified',
              variant: 'success' as const,
              onConfirm: () => void setPanVerified(true),
            },
            'pan-unverify': {
              title: 'Mark PAN unverified?',
              description: `This raises driver ${panDriverId}'s TDS rate back to 20%.`,
              confirmLabel: 'Mark Unverified',
              variant: 'warning' as const,
              onConfirm: () => void setPanVerified(false),
            },
          }[confirm]}
        />
      )}
    </div>
  )
}
