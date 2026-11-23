'use client'
import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams, usePathname, useRouter } from 'next/navigation'
import { AlertTriangle, CalendarClock, CheckCircle2, ChevronRight, Headset, MapPin, RefreshCw, SearchX } from 'lucide-react'
import SuccessToast from '@/components/ui/SuccessToast'
import DispatchPanel from '@/components/dispatch/DispatchPanel'
import { dispatchApi, type DispatchLane, type DispatchRow, type DispatchSummary } from '@/lib/dispatch-api'
import { dispatchState, relativeTo, type DispatchTone } from '@/lib/dispatch-model'
import { cityApi, type AdminCity } from '@/lib/city-api'
import { useAdminAuth } from '@/lib/auth-context'
import { extractErrorMessage } from '@/lib/http-errors'
import { fmtIstClock, fmtIstDay } from '@/lib/ist'
import { formatTotal, hasNextPage, CAPPED_TOTAL_HINT } from '@/lib/format-total'
import { useNow } from '@/lib/use-now'
import { cardMode } from '@/lib/rate-card-mode'
import StatusPill from '@/components/ui/StatusPill'

const LIMIT = 25
const LIVE_REFRESH_MS = 30_000
const WITHIN: Array<{ label: string; value: number | undefined }> = [
  { label: 'All upcoming', value: undefined }, { label: 'Next hour', value: 60 }, { label: 'Next 24 hours', value: 1440 }, { label: 'Next 7 days', value: 10080 },
]
const TONE: Record<DispatchTone, string> = { muted: 'pill-muted', info: 'pill-info', warning: 'pill-warning', danger: 'pill-danger' }

function Tile({ label, value, hint, tone, active, onClick, icon: Icon }: {
  label: string; value: number | null; hint: string; tone: 'neutral' | 'warn' | 'danger'; active: boolean; onClick: () => void; icon: React.ComponentType<{ className?: string }>
}) {
  const hot = tone !== 'neutral' && (value ?? 0) > 0
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className={`text-left rounded-2xl border p-4 transition-colors bg-surface hover:bg-surface-2 ${active ? 'border-primary ring-1 ring-primary/30' : 'border-border-light'}`}>
      <span className="flex items-center justify-between">
        <span className="text-xs font-semibold text-text-muted">{label}</span>
        <Icon className={`w-4 h-4 ${hot ? (tone === 'danger' ? 'text-danger' : 'text-warning') : 'text-text-muted'}`} />
      </span>
      <span className={`block text-3xl font-bold mt-1 tabular-nums ${hot ? (tone === 'danger' ? 'text-danger' : 'text-warning') : 'text-text-primary'}`}>
        {value === null ? '—' : value.toLocaleString('en-IN')}
      </span>
      <span className="block text-[11px] text-text-muted mt-0.5">{hint}</span>
    </button>
  )
}

function DispatchContent() {
  const sp = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const { admin } = useAdminAuth()
  const canAssign = admin?.role === 'super_admin' || admin?.role === 'ops_admin'
  const now = useNow(15_000)

  const [lane, setLane] = useState<DispatchLane>(sp.get('lane') === 'needs_driver' ? 'needs_driver' : 'scheduled')
  const [cityId, setCityId] = useState(sp.get('city') ?? '')
  const [within, setWithin] = useState<number | undefined>(sp.get('within') ? Number(sp.get('within')) : undefined)
  const [page, setPage] = useState(Math.max(1, parseInt(sp.get('page') ?? '1', 10) || 1))
  const [panelId, setPanelId] = useState<string | null>(sp.get('ride'))
  const [rows, setRows] = useState<DispatchRow[]>([])
  const [total, setTotal] = useState(0)
  const [capped, setCapped] = useState(false)
  const [pages, setPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [summary, setSummary] = useState<DispatchSummary | null>(null)
  const [cities, setCities] = useState<AdminCity[]>([])
  const [live, setLive] = useState(true)
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const reqId = useRef(0)

  useEffect(() => { cityApi.list().then(setCities).catch(() => setCities([])) }, [])
  const loadSummary = useCallback(() => { dispatchApi.summary().then(setSummary).catch(() => {}) }, [])
  useEffect(() => { loadSummary() }, [loadSummary])

  const load = useCallback(async (silent = false) => {
    const mine = ++reqId.current
    if (!silent) setLoading(true)
    try {
      const params: Parameters<typeof dispatchApi.queue>[0] = { lane, page, limit: LIMIT }
      if (cityId) params.cityId = Number(cityId)
      if (within !== undefined && lane === 'scheduled') params.within = within
      const d = await dispatchApi.queue(params)
      if (mine !== reqId.current) return
      setRows(d.rides); setTotal(d.pagination.total); setCapped(d.pagination.total_capped === true); setPages(d.pagination.pages)
      setError(''); setRefreshedAt(new Date())
    } catch (err) {
      if (mine !== reqId.current) return
      // An empty list during an outage would read as "nothing needs a driver", the worst thing to believe here.
      setError(extractErrorMessage(err, 'Could not load the queue.'))
      if (!silent) { setRows([]); setTotal(0); setCapped(false); setPages(1) }
    } finally { if (mine === reqId.current) setLoading(false) }
  }, [lane, page, cityId, within])
  useEffect(() => { void load() }, [load])

  const refresh = useCallback(() => { void load(true); loadSummary() }, [load, loadSummary])
  // Live: every 30 s while the tab is visible and the assign panel is closed (a refresh must not move rows under a driver search).
  useEffect(() => {
    if (!live || panelId) return
    const tick = () => { if (document.visibilityState === 'visible') refresh() }
    const id = setInterval(tick, LIVE_REFRESH_MS)
    document.addEventListener('visibilitychange', tick)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', tick) }
  }, [live, panelId, refresh])

  // The address bar follows the view (first run skipped so an arriving ?ride= is not stripped).
  const first = useRef(true)
  useEffect(() => {
    if (first.current) { first.current = false; return }
    const p = new URLSearchParams()
    if (lane !== 'scheduled') p.set('lane', lane)
    if (cityId) p.set('city', cityId)
    if (within !== undefined && lane === 'scheduled') p.set('within', String(within))
    if (page > 1) p.set('page', String(page))
    if (panelId) p.set('ride', panelId)
    const qs = p.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [lane, cityId, within, page, panelId, pathname, router])

  const pick = (l: DispatchLane, w?: number) => { setLane(l); setWithin(l === 'scheduled' ? w : undefined); setPage(1) }
  const needsNow = summary ? summary.searching_long + summary.no_drivers : null

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center"><Headset className="w-5 h-5 text-primary" /></div>
          <div>
            <h2 className="text-lg font-bold text-text-primary">Dispatch desk</h2>
            <p className="text-xs text-text-muted">Advance bookings waiting for their dispatch time, and rides that still need a driver</p>
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs text-text-muted">
          {refreshedAt && <span>Updated {fmtIstClock(refreshedAt)} IST</span>}
          <label className="inline-flex items-center gap-1.5 cursor-pointer select-none text-text-secondary font-medium">
            <input type="checkbox" checked={live} onChange={e => setLive(e.target.checked)} className="accent-primary" />Live
          </label>
          <button onClick={refresh} aria-label="Refresh now" title="Refresh now" className="p-1.5 rounded-lg border border-border text-text-secondary hover:bg-surface-2 transition-colors">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile label="Needs a driver now" value={needsNow} hint="Searching too long, or none found" tone="danger" icon={AlertTriangle}
          active={lane === 'needs_driver'} onClick={() => pick('needs_driver')} />
        <Tile label="Overdue to dispatch" value={summary?.overdue ?? null} hint="Past dispatch time, still waiting" tone="danger" icon={AlertTriangle}
          active={false} onClick={() => pick('scheduled', 60)} />
        <Tile label="Pickups in the next hour" value={summary?.due_within_60m ?? null} hint="Advance bookings about to dispatch" tone="warn" icon={CalendarClock}
          active={lane === 'scheduled' && within === 60} onClick={() => pick('scheduled', 60)} />
        <Tile label="Scheduled ahead" value={summary?.scheduled_total ?? null} hint="All advance bookings waiting" tone="neutral" icon={CalendarClock}
          active={lane === 'scheduled' && within === undefined} onClick={() => pick('scheduled')} />
      </div>

      <div className="admin-card">
        <div className="flex items-center gap-2 flex-wrap mb-4">
          <div role="tablist" aria-label="Queue" className="inline-flex rounded-xl bg-surface-2 p-1">
            {([['scheduled', 'Scheduled', summary?.scheduled_total], ['needs_driver', 'Needs a driver', needsNow]] as const).map(([value, label, count]) => (
              <button key={value} role="tab" aria-selected={lane === value} onClick={() => pick(value)}
                className={`px-3.5 py-1.5 text-sm font-semibold rounded-lg transition-colors ${lane === value ? 'bg-surface shadow-card text-text-primary' : 'text-text-muted hover:text-text-secondary'}`}>
                {label}{count != null ? <span className="ml-1.5 text-xs font-mono text-text-muted">{count.toLocaleString('en-IN')}</span> : null}
              </button>
            ))}
          </div>
          <select aria-label="City" value={cityId} onChange={e => { setCityId(e.target.value); setPage(1) }}
            className="px-3 py-2 text-sm bg-surface border border-border rounded-xl text-text-secondary focus:outline-none focus:border-primary">
            <option value="">All cities</option>
            {cities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {lane === 'scheduled' && (
            <div role="group" aria-label="Pickup window" className="flex items-center gap-1.5 flex-wrap">
              {WITHIN.map(w => (
                <button key={w.label} type="button" aria-pressed={within === w.value} onClick={() => { setWithin(w.value); setPage(1) }}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-full border transition-colors ${within === w.value ? 'bg-primary text-white border-primary' : 'bg-surface border-border text-text-secondary hover:bg-surface-2'}`}>
                  {w.label}
                </button>
              ))}
            </div>
          )}
          <span className="ml-auto text-xs text-text-muted" title={capped ? CAPPED_TOTAL_HINT : undefined}>{error && rows.length === 0 ? '—' : formatTotal(total, capped)} in this view</span>
        </div>

        {error && (
          <div role="alert" className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-danger/30 bg-danger-light px-3 py-2 text-xs text-danger">
            <span className="font-semibold">{error}{rows.length > 0 ? ' The list below may be out of date.' : ''}</span>
            <button onClick={() => void load()} className="font-semibold underline flex-shrink-0">Retry</button>
          </div>
        )}

        {loading ? (
          <ul className="space-y-2" aria-busy>{[0, 1, 2, 3, 4].map(i => <li key={i} className="h-[76px] rounded-xl bg-surface-2 animate-pulse" />)}</ul>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-text-muted text-center">
            <div className="w-12 h-12 rounded-2xl bg-surface-2 flex items-center justify-center mb-3">
              {error ? <SearchX className="w-5 h-5" /> : <CheckCircle2 className="w-5 h-5 text-success" />}
            </div>
            <p className="text-sm font-semibold text-text-secondary">
              {error ? 'The queue could not be loaded' : lane === 'needs_driver' ? 'Every ride has a driver' : 'No advance bookings waiting'}
            </p>
            <p className="text-xs mt-1 max-w-sm">
              {error ? 'Use Retry above. Do not assume nothing needs a driver.' : lane === 'needs_driver' ? 'Nothing needs you right now. This list refreshes by itself.' : 'Advance bookings appear here from the moment a rider books until they dispatch.'}
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {rows.map(r => {
              const st = dispatchState(r, now)
              return (
                <li key={r.id} className="flex items-stretch gap-2 rounded-xl border border-border-light hover:border-border transition-colors bg-surface">
                  <button type="button" onClick={() => setPanelId(r.id)} aria-label={`Open ride ${r.id}`}
                    className="flex-1 min-w-0 text-left grid grid-cols-1 md:grid-cols-[170px_minmax(0,1fr)_minmax(0,1.2fr)_auto] gap-x-4 gap-y-1 items-center px-4 py-3 rounded-xl focus-visible:outline-none focus-visible:bg-primary-light">
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-text-primary">{fmtIstDay(r.scheduled_for ?? r.requested_at, new Date(now))}</span>
                      <span className="block text-xs text-text-muted">{r.scheduled_for ? `pickup ${relativeTo(r.scheduled_for, now)}` : `booked ${relativeTo(r.requested_at, now)}`}</span>
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-text-primary truncate">{r.user_name ?? r.user_phone}</span>
                      <span className="block text-xs text-text-muted truncate">{[r.category_name, r.city_name].filter(Boolean).join(' · ')} · <StatusPill status={cardMode(r)} className="!py-0 !text-[10px]" /></span>
                    </span>
                    <span className="min-w-0 space-y-0.5">
                      <span className="flex items-center gap-1.5 text-xs text-text-secondary truncate"><MapPin className="w-3 h-3 text-success shrink-0" /><span className="truncate">{r.origin_address ?? '—'}</span></span>
                      <span className="flex items-center gap-1.5 text-xs text-text-muted truncate"><MapPin className="w-3 h-3 text-danger shrink-0" /><span className="truncate">{r.destination_address ?? '—'}</span></span>
                    </span>
                    <span className="flex md:flex-col md:items-end items-center gap-2 md:gap-1">
                      <span className={TONE[st.tone]}>{st.label}</span>
                      <span className="text-xs text-text-muted whitespace-nowrap">
                        {r.fare ? `₹${parseFloat(r.fare).toLocaleString('en-IN')}` : ''}{r.offers_count > 0 ? ` · ${r.offers_count} offered` : ''}
                      </span>
                    </span>
                  </button>
                  <button type="button" onClick={() => setPanelId(r.id)} aria-label={`${canAssign ? 'Assign a driver to' : 'View'} ride ${r.id}`}
                    className="self-center mr-3 px-3.5 py-1.5 text-xs font-semibold rounded-full bg-primary text-white hover:bg-primary-dark transition-colors flex items-center gap-1 flex-shrink-0">
                    {canAssign ? 'Assign' : 'View'}<ChevronRight className="w-3 h-3" />
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        {pages > 1 && (
          <div className="flex items-center justify-between mt-4 pt-4 border-t border-border-light">
            <p className="text-xs text-text-muted">Page {page} of {pages}{capped ? '+' : ''}</p>
            <div className="flex gap-2">
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="px-3 py-1 text-xs border border-border rounded-lg disabled:opacity-40 hover:bg-surface-2 transition-colors">Prev</button>
              <button disabled={!hasNextPage({ page, pages, capped, rowsOnPage: rows.length, limit: LIMIT })} onClick={() => setPage(p => p + 1)} className="px-3 py-1 text-xs border border-border rounded-lg disabled:opacity-40 hover:bg-surface-2 transition-colors">Next</button>
            </div>
          </div>
        )}
      </div>

      <DispatchPanel rideId={panelId} canAssign={canAssign} onClose={() => setPanelId(null)}
        onAssigned={msg => { setPanelId(null); setToast(msg); refresh() }} />
      <SuccessToast message={toast} onDismiss={() => setToast(null)} />
    </div>
  )
}

export default function DispatchPage() {
  return <Suspense fallback={null}><DispatchContent /></Suspense>
}
