'use client'

import { useEffect, useState } from 'react'
import { Wallet } from 'lucide-react'
import StatusPill from '@/components/ui/StatusPill'
import {
  payoutsApi,
  type SettlementBatchSummary,
  type SettlementRow,
  type StuckSettlement,
  type UnverifiedBankAccount,
  type TaxStatement,
} from '@/lib/payouts-api'

export default function PayoutsPage() {
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
        <table className="data-table">
          <thead>
            <tr>
              <th>Period</th>
              <th>Type</th>
              <th>Status</th>
              <th>Drivers</th>
              <th>Total</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {batchesLoading ? (
              <tr><td colSpan={6} className="text-text-muted text-xs py-6 text-center">Loading batches…</td></tr>
            ) : batches.length === 0 ? (
              <tr><td colSpan={6} className="text-text-muted text-xs py-6 text-center">No settlement batches yet.</td></tr>
            ) : batches.map(b => (
              <tr key={`${b.period_from}-${b.period_to}-${b.run_type}`}>
                <td className="text-text-primary">{b.period_from} → {b.period_to}</td>
                <td className="text-text-muted text-xs capitalize">{b.run_type}</td>
                <td><StatusPill status={b.status} /></td>
                <td className="text-text-muted text-xs">{b.driver_count}</td>
                <td className="font-semibold text-text-primary">₹{b.total}</td>
                <td className="flex gap-3 items-center py-2">
                  <button className="text-primary text-xs font-semibold cursor-pointer" onClick={() => void openBatch(b)}>View</button>
                  {b.status === 'pending' && (
                    <button
                      className="text-primary text-xs font-semibold cursor-pointer disabled:opacity-50"
                      disabled={approving}
                      onClick={() => void approve(b)}
                    >
                      Approve
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {selected && (
          <div className="mt-5 pt-4 border-t border-border-light">
            <p className="text-sm font-semibold text-text-primary mb-3">
              {selected.period_from} → {selected.period_to} — settlements
            </p>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Driver</th>
                  <th>Amount</th>
                  <th>Fee</th>
                  <th>Status</th>
                  <th>UTR</th>
                  <th>Failure reason</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={7} className="text-text-muted text-xs py-6 text-center">No settlements in this batch.</td></tr>
                ) : rows.map(r => (
                  <tr key={r.id}>
                    <td className="text-text-primary">{r.driver_name}</td>
                    <td className="font-semibold text-text-primary">₹{r.net_payout}</td>
                    <td className="text-text-muted text-xs">₹{r.fee}</td>
                    <td><StatusPill status={r.status} /></td>
                    <td className="font-mono text-xs text-text-muted">{r.utr ?? '—'}</td>
                    <td className="text-xs text-text-muted">{r.failure_reason ?? '—'}</td>
                    <td>
                      {r.status === 'failed' && (
                        <button className="text-primary text-xs font-semibold cursor-pointer" onClick={() => void retryRow(r.id)}>
                          Retry
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
              className="w-full px-3 py-2 text-sm border border-border rounded-xl outline-none focus:border-primary transition-colors"
            />
            <input
              value={holdReason}
              onChange={e => setHoldReason(e.target.value)}
              placeholder="Reason"
              className="w-full px-3 py-2 text-sm border border-border rounded-xl outline-none focus:border-primary transition-colors"
            />
            <button
              onClick={() => void placeHold()}
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
              className="w-full px-3 py-2 text-sm border border-border rounded-xl outline-none focus:border-primary transition-colors"
            />
            <button
              onClick={() => void releaseHold()}
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
            className="w-full px-3 py-2 text-sm border border-border rounded-xl outline-none focus:border-primary transition-colors"
          />
          <input
            value={adjAmount}
            onChange={e => setAdjAmount(e.target.value)}
            type="number"
            placeholder="Amount (negative to deduct)"
            className="w-full px-3 py-2 text-sm border border-border rounded-xl outline-none focus:border-primary transition-colors"
          />
          <input
            value={adjReason}
            onChange={e => setAdjReason(e.target.value)}
            placeholder="Reason"
            className="w-full px-3 py-2 text-sm border border-border rounded-xl outline-none focus:border-primary transition-colors"
          />
        </div>
        <button
          onClick={() => void submitAdjustment()}
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
        <table className="data-table">
          <thead>
            <tr>
              <th>Driver</th>
              <th>Amount</th>
              <th>Created</th>
              <th>Razorpay Payout ID</th>
              <th>Reason</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {stuckLoading ? (
              <tr><td colSpan={6} className="text-text-muted text-xs py-6 text-center">Loading…</td></tr>
            ) : stuck.length === 0 ? (
              <tr><td colSpan={6} className="text-text-muted text-xs py-6 text-center">No stuck settlements.</td></tr>
            ) : stuck.map(s => (
              <tr key={s.id}>
                <td className="text-text-primary">{s.driver_name}</td>
                <td className="font-semibold text-text-primary">₹{s.net_payout}</td>
                <td className="text-xs text-text-muted">{new Date(s.created_at).toLocaleString('en-IN')}</td>
                <td className="font-mono text-xs text-text-muted">{s.razorpay_payout_id ?? '—'}</td>
                <td className="text-xs">
                  <span className={s.stuck_reason === 'never_submitted' ? 'pill-danger' : 'pill-warning'}>
                    {s.stuck_reason === 'never_submitted' ? 'Never submitted' : 'Awaiting webhook'}
                  </span>
                </td>
                <td>
                  {s.stuck_reason === 'never_submitted' && (
                    <button className="text-primary text-xs font-semibold cursor-pointer" onClick={() => void retryStuck(s.id)}>
                      Retry now
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Bank account verification */}
      <div className="admin-card">
        <p className="text-sm font-semibold text-text-primary mb-3">Bank Account Verification</p>
        <table className="data-table">
          <thead>
            <tr>
              <th>Driver</th>
              <th>IFSC</th>
              <th>Status</th>
              <th>Added</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {bankLoading ? (
              <tr><td colSpan={5} className="text-text-muted text-xs py-6 text-center">Loading…</td></tr>
            ) : bankAccounts.length === 0 ? (
              <tr><td colSpan={5} className="text-text-muted text-xs py-6 text-center">Nothing pending verification.</td></tr>
            ) : bankAccounts.map(a => (
              <tr key={a.id}>
                <td className="text-text-primary">{a.driver_name}</td>
                <td className="font-mono text-xs text-text-muted">{a.ifsc}</td>
                <td><StatusPill status={a.status} /></td>
                <td className="text-xs text-text-muted">{new Date(a.created_at).toLocaleString('en-IN')}</td>
                <td className="flex gap-3">
                  <button className="text-success text-xs font-semibold cursor-pointer" onClick={() => void setBankStatus(a.id, 'verified')}>
                    Verify
                  </button>
                  <button className="text-danger text-xs font-semibold cursor-pointer" onClick={() => void setBankStatus(a.id, 'invalid')}>
                    Reject
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
            className="w-full max-w-xs px-3 py-2 text-sm border border-border rounded-xl outline-none focus:border-primary transition-colors"
          />
          <button
            onClick={() => void setPanVerified(true)}
            disabled={panBusy || !panDriverId}
            className="px-4 py-2 rounded-xl text-sm font-semibold text-white bg-primary hover:opacity-90 transition-opacity disabled:opacity-50 cursor-pointer"
          >
            Verify
          </button>
          <button
            onClick={() => void setPanVerified(false)}
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
    </div>
  )
}
