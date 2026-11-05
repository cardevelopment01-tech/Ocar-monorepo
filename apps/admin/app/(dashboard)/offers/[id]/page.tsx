'use client'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowLeft, Download } from 'lucide-react'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import OfferForm from '@/components/offers/OfferForm'
import { useOffersSetup } from '@/components/offers/useOffersSetup'
import { useAdminAuth } from '@/lib/auth-context'
import { offersApi, type OfferDetail, type OfferStats, type OfferStatus, type Redemption } from '@/lib/offers-api'
import { budgetUsedPercent, draftFromOffer, redemptionsCsv, termsChanged, toPayload, istEndOfDay, istNextDayStart, type Draft } from '@/lib/offers-model'
import { extractErrorMessage } from '@/lib/http-errors'
import { cn } from '@/lib/utils'

type Tab = 'overview' | 'terms' | 'redemptions' | 'history'
const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Overview' }, { key: 'terms', label: 'Terms' }, { key: 'redemptions', label: 'Redemptions' }, { key: 'history', label: 'History' },
]
const STATUS_LABEL: Record<string, string> = { active: 'Live', draft: 'Draft', paused: 'Paused', ended: 'Ended' }
const NEXT: Record<string, { to: OfferStatus; label: string; variant: 'success' | 'warning' | 'danger'; text: string }[]> = {
  draft: [{ to: 'active', label: 'Publish', variant: 'success', text: 'Riders can start using this offer straight away.' }],
  active: [
    { to: 'paused', label: 'Pause', variant: 'warning', text: 'New bookings stop getting this offer. Rides already booked keep it.' },
    { to: 'ended', label: 'End', variant: 'danger', text: 'This cannot be undone. New bookings stop getting this offer for good.' },
  ],
  paused: [
    { to: 'active', label: 'Resume', variant: 'success', text: 'Riders can use this offer again.' },
    { to: 'ended', label: 'End', variant: 'danger', text: 'This cannot be undone. New bookings stop getting this offer for good.' },
  ],
  ended: [],
}

const money = (n: number | string) => `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '—')

export default function OfferDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { admin } = useAdminAuth()
  const canWrite = admin?.role === 'super_admin' || admin?.role === 'ops_admin'
  const { meta, lookups, error: setupError } = useOffersSetup()
  const [offer, setOffer] = useState<OfferDetail | null>(null)
  const [stats, setStats] = useState<OfferStats | null>(null)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<Tab>('overview')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saved, setSaved] = useState<Draft | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [notice, setNotice] = useState('')
  const [pending, setPending] = useState<(typeof NEXT)[string][number] | null>(null)

  const load = useCallback(async () => {
    try {
      const [o, s] = await Promise.all([offersApi.get(id), offersApi.stats(id)])
      setOffer(o)
      setStats(s)
      const d = draftFromOffer(o)
      setDraft(d)
      setSaved(d)
      setError('')
    } catch (err) {
      setError(extractErrorMessage(err, 'Could not load this offer.'))
    }
  }, [id])
  useEffect(() => { void load() }, [load])

  async function saveTerms() {
    if (!offer || !draft || !saved) return
    setSubmitting(true)
    setSaveError('')
    setNotice('')
    try {
      if (termsChanged(saved, draft)) {
        const p = toPayload(draft, 'draft')
        await offersApi.createVersion(offer.id, { rules: p.rules, benefit: p.benefit, perUserLimit: p.perUserLimit ?? null })
      }
      const patch: Parameters<typeof offersApi.patch>[1] = {}
      if (draft.name.trim() !== saved.name) patch.name = draft.name.trim()
      if (draft.endsAt !== saved.endsAt) patch.endsAt = draft.endsAt ? istEndOfDay(draft.endsAt) : null
      if (draft.budgetTotal !== saved.budgetTotal) patch.budgetTotal = draft.budgetTotal.trim() === '' ? null : Number(draft.budgetTotal)
      if (draft.globalLimit !== saved.globalLimit) patch.globalLimit = draft.globalLimit.trim() === '' ? null : Number(draft.globalLimit)
      if (Object.keys(patch).length > 0) await offersApi.patch(offer.id, patch)
      setNotice('Saved. Changes apply to new bookings only; rides already booked keep the old terms.')
    } catch (err) {
      setSaveError(extractErrorMessage(err, 'Could not save the changes.'))
    } finally {
      // Always re-read: a new version may already exist even if the second step failed, and a retry must not create it again.
      await load()
      setSubmitting(false)
    }
  }

  async function changeStatus(to: OfferStatus) {
    if (!offer) return
    setNotice('')
    try {
      await offersApi.patch(offer.id, { status: to })
      await load()
    } catch (err) {
      setError(extractErrorMessage(err, 'Could not change the status.'))
    }
  }

  if (error && !offer) return <p role="alert" className="admin-card text-sm text-danger">{error}</p>
  if (!offer || !draft) return <p className="admin-card text-sm text-text-muted">Loading…</p>

  const pct = budgetUsedPercent(offer.budget_spent, offer.budget_total)
  const actions = canWrite ? NEXT[offer.status] ?? [] : []

  return (
    <div className="space-y-5">
      <Link href="/offers" className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-text-primary min-h-[44px]"><ArrowLeft size={14} /> All offers</Link>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="page-title">{offer.name}</h1>
          <p className="text-sm text-text-secondary mt-1">{offer.summary ?? '—'}</p>
          <p className="text-xs text-text-muted mt-1"><span className="font-mono">{offer.code ?? 'Applied automatically'}</span> · <span className="font-semibold">{STATUS_LABEL[offer.status] ?? offer.status}</span></p>
        </div>
        <div className="flex gap-2">
          {actions.map((a) => (
            <button key={a.to} onClick={() => setPending(a)} className={a.variant === 'danger' ? 'btn-secondary !text-danger' : 'btn-primary'}>{a.label}</button>
          ))}
        </div>
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {notice && <p role="status" className="text-sm text-success">{notice}</p>}

      <div role="tablist" aria-label="Offer sections" className="flex gap-1 flex-wrap border-b border-border-light">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
            className={cn('px-4 min-h-[44px] text-sm font-semibold border-b-2 -mb-px', tab === t.key ? 'border-primary text-primary' : 'border-transparent text-text-muted hover:text-text-primary')}>{t.label}</button>
        ))}
      </div>

      {tab === 'overview' && stats && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="admin-card"><p className="text-xs text-text-muted">Discount given</p><p className="text-2xl font-bold text-text-primary mt-1">{money(stats.discountGiven)}</p></div>
          <div className="admin-card"><p className="text-xs text-text-muted">Completed</p><p className="text-2xl font-bold text-text-primary mt-1">{stats.redemptions['consumed'] ?? 0}</p></div>
          <div className="admin-card"><p className="text-xs text-text-muted">On rides in progress</p><p className="text-2xl font-bold text-text-primary mt-1">{stats.redemptions['reserved'] ?? 0}</p></div>
          <div className="admin-card">
            <p className="text-xs text-text-muted">Budget</p>
            {pct == null ? <p className="text-sm text-warning mt-2">No budget set</p> : (
              <>
                <p className="text-2xl font-bold text-text-primary mt-1">{pct}% used</p>
                <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={`Budget used ${pct}%`} className="h-1.5 mt-2 rounded-full bg-surface-2 overflow-hidden"><div className="h-full bg-primary" style={{ width: `${pct}%` }} /></div>
                <p className="text-xs text-text-muted mt-1">{money(offer.budget_spent)} of {money(offer.budget_total ?? 0)}</p>
              </>
            )}
          </div>
        </div>
      )}

      {tab === 'terms' && (
        setupError ? <p role="alert" className="admin-card text-sm text-danger">{setupError}</p>
        : !meta ? <p className="admin-card text-sm text-text-muted">Loading…</p>
        : (
          <OfferForm meta={meta} draft={draft} onChange={setDraft} mode="edit" readOnly={!canWrite || offer.status === 'ended'} lookups={lookups} checkBenefit={termsChanged(saved ?? draft, draft)}
            submitting={submitting} error={saveError} onSave={() => void saveTerms()} ownId={offer.id} />
        )
      )}

      {tab === 'redemptions' && <RedemptionsTab offerId={offer.id} />}

      {tab === 'history' && (
        <div className="admin-card !p-0 overflow-hidden">
          <table className="data-table">
            <thead><tr><th>Version</th><th>Saved</th><th>What it did</th></tr></thead>
            <tbody>
              {offer.versions.map((v, i) => (
                <tr key={v.id}>
                  <td className="font-semibold">{i === 0 ? 'Current' : `Earlier (${v.version})`}</td>
                  <td className="text-xs text-text-muted">{when(v.created_at)}</td>
                  <td className="text-sm text-text-secondary">{v.benefit.type === 'percent_off' ? `${v.benefit.percent}% off` : v.benefit.type === 'flat_off' ? `${money(v.benefit.amount ?? 0)} off` : v.benefit.type.replace('_', ' ')}{v.rules.length ? `, ${v.rules.length} condition${v.rules.length === 1 ? '' : 's'}` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-text-muted p-3">Rides keep the terms they were booked with. Editing creates a new version for new bookings.</p>
        </div>
      )}

      <ConfirmDialog
        open={pending != null} onOpenChange={(o) => { if (!o) setPending(null) }}
        title={pending ? `${pending.label} this offer?` : ''} description={pending?.text ?? ''}
        confirmLabel={pending?.label ?? 'Confirm'} variant={pending?.variant ?? 'warning'}
        onConfirm={() => { const p = pending; setPending(null); if (p) void changeStatus(p.to) }}
      />
    </div>
  )
}

function RedemptionsTab({ offerId }: { offerId: string }) {
  const [rows, setRows] = useState<Redemption[]>([])
  const [status, setStatus] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    if (from !== '' && to !== '' && from > to) { setRows([]); setLoading(false); return }
    setLoading(true)
    const params: Parameters<typeof offersApi.redemptions>[1] = { limit: 200 }
    if (status) params.status = status
    if (from) params.from = new Date(`${from}T00:00:00+05:30`).toISOString()
    if (to) params.to = istNextDayStart(to)
    offersApi.redemptions(offerId, params)
      .then((r) => { if (live) { setRows(r); setError('') } })
      .catch((err) => { if (live) { setRows([]); setError(extractErrorMessage(err, 'Could not load redemptions.')) } })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [offerId, status, from, to])

  const [exporting, setExporting] = useState(false)
  const badRange = from !== '' && to !== '' && from > to

  /** Every row that matches the filters, not just the ones on screen (pages of 200, up to 10,000). */
  async function exportCsv() {
    setExporting(true)
    try {
      const base: Parameters<typeof offersApi.redemptions>[1] = { limit: 200 }
      if (status) base.status = status
      if (from) base.from = new Date(`${from}T00:00:00+05:30`).toISOString()
      if (to) base.to = istNextDayStart(to)
      const all: Redemption[] = []
      for (let offset = 0; offset < 10_000; offset += 200) {
        const page = await offersApi.redemptions(offerId, { ...base, offset })
        all.push(...page)
        if (page.length < 200) break
      }
      download(redemptionsCsv(all))
    } catch (err) {
      setError(extractErrorMessage(err, 'Could not prepare the download.'))
    } finally {
      setExporting(false)
    }
  }

  function download(csv: string) {
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `offer-${offerId}-redemptions.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const sel = 'border border-border rounded-xl px-3 py-2 text-sm bg-surface min-h-[40px]'
  return (
    <div className="admin-card space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="rd-status" className="block text-xs font-semibold text-text-muted mb-1.5">Status</label>
          <select id="rd-status" className={sel} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option><option value="reserved">In progress</option><option value="consumed">Completed</option>
            <option value="released">Given back</option><option value="reversed">Refunded</option>
          </select>
        </div>
        <div><label htmlFor="rd-from" className="block text-xs font-semibold text-text-muted mb-1.5">From</label><input id="rd-from" type="date" className={sel} value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><label htmlFor="rd-to" className="block text-xs font-semibold text-text-muted mb-1.5">To</label><input id="rd-to" type="date" className={sel} value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <button type="button" onClick={() => void exportCsv()} disabled={rows.length === 0 || exporting || badRange} className="btn-secondary inline-flex items-center gap-2 disabled:opacity-50 disabled:pointer-events-none"><Download size={14} /> {exporting ? 'Preparing…' : 'Download CSV'}</button>
      </div>
      {badRange && <p role="alert" className="text-xs text-danger">The From date is after the To date.</p>}
      <div className="overflow-x-auto">
        <table className="data-table">
          <thead><tr><th>When</th><th>Ride</th><th>Rider</th><th>Status</th><th className="!text-right">Discount</th></tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={5} className="!text-center py-10 text-text-muted">Loading…</td></tr>
              : error ? <tr><td colSpan={5} className="!text-center py-10 text-danger" role="alert">{error}</td></tr>
              : rows.length === 0 ? <tr><td colSpan={5} className="!text-center py-10 text-text-muted">{status || from || to ? 'No redemptions match these filters.' : 'No one has used this offer yet.'}</td></tr>
              : rows.map((r) => (
                <tr key={r.id}>
                  <td className="text-xs text-text-muted">{when(r.reserved_at)}</td>
                  <td className="font-mono text-xs">#{r.ride_id}</td>
                  <td className="font-mono text-xs">#{r.user_id}</td>
                  <td className="text-sm">{({ reserved: 'In progress', consumed: 'Completed', released: 'Given back', reversed: 'Refunded' } as Record<string, string>)[r.status] ?? r.status}{r.reason ? <span className="block text-xs text-text-muted">{r.reason}</span> : null}</td>
                  <td className="!text-right font-semibold">{money(r.discount_amount)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {rows.length === 200 && <p className="text-xs text-text-muted">Showing the latest 200. The download includes every match.</p>}
    </div>
  )
}
