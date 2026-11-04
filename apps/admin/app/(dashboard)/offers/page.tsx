'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Ticket, Plus } from 'lucide-react'
import FilterBar from '@/components/ui/FilterBar'
import { useAdminAuth } from '@/lib/auth-context'
import { offersApi, type OfferRow } from '@/lib/offers-api'
import { budgetUsedPercent } from '@/lib/offers-model'
import { extractErrorMessage } from '@/lib/http-errors'
import { cn } from '@/lib/utils'

const PAGE = 100

const TABS = [
  { key: '', label: 'All' },
  { key: 'active', label: 'Live' },
  { key: 'draft', label: 'Draft' },
  { key: 'paused', label: 'Paused' },
  { key: 'ended', label: 'Ended' },
] as const

const STATUS_PILL: Record<string, { label: string; cls: string }> = {
  active: { label: 'Live', cls: 'pill-success' },
  draft: { label: 'Draft', cls: 'pill-muted' },
  paused: { label: 'Paused', cls: 'pill-warning' },
  ended: { label: 'Ended', cls: 'pill-muted' },
}

function day(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : null
}

function BudgetBar({ spent, total }: { spent: string; total: string | null }) {
  const pct = budgetUsedPercent(spent, total)
  if (pct == null) return <span className="text-xs text-text-muted">No budget set</span>
  return (
    <div className="min-w-[120px]">
      <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={`Budget used ${pct}%`} className="h-1.5 rounded-full bg-surface-2 overflow-hidden">
        <div className={cn('h-full rounded-full', pct >= 90 ? 'bg-danger' : pct >= 70 ? 'bg-warning' : 'bg-primary')} style={{ width: `${pct}%` }} />
      </div>
      <p className="text-xs text-text-muted mt-1">Budget used {pct}% · ₹{Number(spent).toLocaleString('en-IN')} of ₹{Number(total).toLocaleString('en-IN')}</p>
    </div>
  )
}

export default function OffersPage() {
  const router = useRouter()
  const { admin } = useAdminAuth()
  const canWrite = admin?.role === 'super_admin' || admin?.role === 'ops_admin'
  const [offers, setOffers] = useState<OfferRow[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [tab, setTab] = useState('')
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const requestId = useRef(0)
  const [hasMore, setHasMore] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 350)
    return () => clearTimeout(t)
  }, [search])

  const load = useCallback(async () => {
    const mine = ++requestId.current
    setLoading(true)
    setError('')
    try {
      const params: { status?: string; search?: string; limit: number } = { limit: PAGE }
      if (tab) params.status = tab
      if (debounced) params.search = debounced
      const data = await offersApi.list(params)
      if (mine !== requestId.current) return
      setOffers(data.offers)
      setCounts(data.counts)
      setHasMore(data.offers.length === PAGE)
    } catch (err) {
      if (mine !== requestId.current) return
      setOffers([])
      setError(extractErrorMessage(err, 'Could not load offers.'))
    } finally {
      if (mine === requestId.current) setLoading(false)
    }
  }, [tab, debounced])
  useEffect(() => { void load() }, [load])

  async function loadMore() {
    setLoadingMore(true)
    try {
      const params: { status?: string; search?: string; limit: number; offset: number } = { limit: 100, offset: offers.length }
      if (tab) params.status = tab
      if (debounced) params.search = debounced
      const data = await offersApi.list(params)
      setOffers((prev) => [...prev, ...data.offers])
      setHasMore(data.offers.length === PAGE)
    } catch (err) {
      setError(extractErrorMessage(err, 'Could not load more offers.'))
    } finally {
      setLoadingMore(false)
    }
  }

  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  const countOf = (key: string) => (key === '' ? total : counts[key] ?? 0)

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary-light flex items-center justify-center"><Ticket size={20} className="text-primary" /></div>
          <div>
            <h1 className="page-title">Offers</h1>
            <p className="page-subtitle">Discounts riders get on a fare. They apply only while commission is 0.</p>
          </div>
        </div>
        {canWrite && <Link href="/offers/new" className="btn-primary inline-flex items-center gap-2"><Plus size={16} /> New offer</Link>}
      </div>

      <div role="tablist" aria-label="Offer status" className="flex gap-1 flex-wrap border-b border-border-light">
        {TABS.map((t) => (
          <button key={t.key || 'all'} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
            className={cn('px-4 min-h-[44px] text-sm font-semibold border-b-2 -mb-px', tab === t.key ? 'border-primary text-primary' : 'border-transparent text-text-muted hover:text-text-primary')}>
            {t.label} <span className="ml-1 text-xs font-normal text-text-muted">{countOf(t.key)}</span>
          </button>
        ))}
      </div>

      <div className="admin-card space-y-4">
        <FilterBar search={search} onSearch={setSearch} searchPlaceholder="Search by name or code…" />
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr><th>Offer</th><th>What it does</th><th>Status</th><th>Budget</th><th className="!text-right">Used</th></tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="!text-center py-12 text-text-muted">Loading…</td></tr>
              ) : error ? (
                <tr><td colSpan={5} className="!text-center py-12 text-danger" role="alert">{error}</td></tr>
              ) : offers.length === 0 ? (
                <tr><td colSpan={5} className="!text-center py-12 text-text-muted">
                  {debounced || tab ? 'No offers match.' : 'No offers yet.'}{canWrite && !debounced && !tab ? ' Create the first one.' : ''}
                </td></tr>
              ) : offers.map((o) => {
                const pill = STATUS_PILL[o.status] ?? { label: o.status, cls: 'pill-muted' }
                const notStarted = o.status === 'active' && o.starts_at && new Date(o.starts_at) > new Date()
                return (
                  <tr key={o.id} className="cursor-pointer hover:bg-surface-2" onClick={() => router.push(`/offers/${o.id}`)}>
                    <td>
                      <Link href={`/offers/${o.id}`} className="font-semibold text-text-primary hover:underline" onClick={(e) => e.stopPropagation()}>{o.name}</Link>
                      <p className="text-xs text-text-muted font-mono">{o.code ?? 'Applied automatically'}</p>
                    </td>
                    <td className="text-sm text-text-secondary max-w-[320px]">{o.summary ?? '—'}</td>
                    <td>
                      <span className={cn('pill', pill.cls)}>{pill.label}</span>
                      {notStarted && <p className="text-xs text-text-muted mt-1">Starts {day(o.starts_at)}</p>}
                      {o.ends_at && o.status !== 'ended' && <p className="text-xs text-text-muted mt-1">Ends {day(o.ends_at)}</p>}
                    </td>
                    <td><BudgetBar spent={o.budget_spent} total={o.budget_total} /></td>
                    <td className="!text-right text-sm">{o.redemption_count}{o.global_limit != null ? ` of ${o.global_limit}` : ''}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {hasMore && !loading && (
          <div className="flex items-center justify-between">
            <p className="text-xs text-text-muted">Showing {offers.length}. There are more.</p>
            <button type="button" onClick={() => void loadMore()} disabled={loadingMore} className="btn-secondary disabled:opacity-50">{loadingMore ? 'Loading…' : 'Show more'}</button>
          </div>
        )}
        {debounced && <p className="text-xs text-text-muted">The numbers on the tabs count every offer, not just the matches.</p>}
      </div>
    </div>
  )
}
