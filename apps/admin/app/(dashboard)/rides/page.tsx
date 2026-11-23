'use client'
import React from 'react'
import { cardMode } from '@/lib/rate-card-mode'
import { Suspense, useState, useEffect, useRef, useCallback } from 'react'
import { useSearchParams, usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Car, MapPin, Activity, XCircle, Wallet, CalendarClock, AlertTriangle, RefreshCw, Headset, Phone } from 'lucide-react'
import StatusPill from '@/components/ui/StatusPill'
import DataTable from '@/components/ui/DataTable'
import FilterBar from '@/components/ui/FilterBar'
import SlideOver from '@/components/ui/SlideOver'
import StatCard from '@/components/ui/StatCard'
import ReasonDialog from '@/components/ui/ReasonDialog'
import { adminRideApi, type AdminRideItem, type AdminRideStats } from '@/lib/admin-api'
import { extractErrorMessage } from '@/lib/http-errors'
import { fmtIst, fmtIstClock, istDay } from '@/lib/ist'
import { useNow } from '@/lib/use-now'
import { useAdminAuth } from '@/lib/auth-context'
import { FORCE_CONSEQUENCE } from '@/lib/ride-situation'
import { formatTotal, hasNextPage, CAPPED_TOTAL_HINT } from '@/lib/format-total'
import { cityApi, type AdminCity } from '@/lib/city-api'
import { dispatchApi, type DispatchSummary } from '@/lib/dispatch-api'
import RideDrawer from '@/components/rides/RideDrawer'

const fmt = (iso: string | null) => fmtIst(iso)

// Refresh cadence for the live view. Each tick is the list page + stats, all index-backed, and only runs while the tab is visible and nothing is open.
const LIVE_REFRESH_MS = 30_000

function initials(name: string | null | undefined) {
  const parts = (name ?? '').trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1]?.[0] ?? '' : '')).toUpperCase()
}

function Avatar({ name, tone = 'primary' }: { name: string | null | undefined; tone?: 'primary' | 'muted' }) {
  return (
    <span className={`inline-flex items-center justify-center w-8 h-8 rounded-full text-[11px] font-semibold shrink-0 ${
      tone === 'primary' ? 'bg-primary/10 text-primary' : 'bg-surface-2 text-text-muted border border-border-light'
    }`}>
      {initials(name) || '?'}
    </span>
  )
}

const LIMIT = 20

function RidesPageContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const [rides, setRides] = useState<AdminRideItem[]>([])
  const [total, setTotal] = useState(0)
  // the API stops counting at 10,000 rows (counting every ride is a full scan); show "10,000+" instead of a wrong exact number
  const [totalCapped, setTotalCapped] = useState(false)
  const [pages, setPages] = useState(1)
  // Filters live in the URL, so a refresh, a shared link or the browser's Back button keeps the view.
  const [page, setPage] = useState(Math.max(1, parseInt(searchParams.get('page') ?? '1', 10) || 1))
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const [search, setSearch] = useState(searchParams.get('q') ?? '')
  const [statusFilter, setStatusFilter] = useState(searchParams.get('status') ?? '')
  const [rideTypeFilter, setRideTypeFilter] = useState(searchParams.get('type') ?? '')
  const [cashFlagFilter, setCashFlagFilter] = useState(searchParams.get('cash') === 'flagged' ? 'flagged' : '')
  const [attentionOnly, setAttentionOnly] = useState(searchParams.get('attention') === '1')
  const [cityFilter, setCityFilter] = useState(searchParams.get('city') ?? '')
  const [dateFrom, setDateFrom] = useState(searchParams.get('from') ?? '')
  const [dateTo, setDateTo] = useState(searchParams.get('to') ?? '')
  const [live, setLive] = useState(true)
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null)
  const [cities, setCities] = useState<AdminCity[]>([])
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Only the newest request may write state: with fast filter changes an older, slower response could otherwise overwrite a newer one.
  const requestId = useRef(0)
  const [debouncedSearch, setDebouncedSearch] = useState(searchParams.get('q') ?? '')

  useEffect(() => { cityApi.list().then(setCities).catch(() => setCities([])) }, [])

  const [selected, setSelected] = useState<AdminRideItem | null>(null)
  const [resolving, setResolving] = useState(false)
  const [resolveTarget, setResolveTarget] = useState<'complete' | 'cancel' | null>(null)
  const [actionError, setActionError] = useState('')
  const now = useNow(30_000)
  const { admin } = useAdminAuth()
  // Only ops and super admins resolve or reassign a ride; support can read everything.
  const canAct = admin?.role === 'super_admin' || admin?.role === 'ops_admin'

  // Advance bookings and driver assignment live on the Dispatch desk; this page only points there, with the number that needs a person.
  const [dispatch, setDispatch] = useState<DispatchSummary | null>(null)
  const loadDispatch = useCallback(() => { dispatchApi.summary().then(setDispatch).catch(() => {}) }, [])
  useEffect(() => { loadDispatch() }, [loadDispatch])

  const [stats, setStats] = useState<AdminRideStats | null>(null)
  // A failed refresh keeps the last numbers on screen instead of blanking the cards.
  const loadStats = useCallback(() => { adminRideApi.stats().then(setStats).catch(() => {}) }, [])
  useEffect(() => { loadStats() }, [loadStats])

  // Opening or leaving a ride clears any message about the previous one.
  useEffect(() => { setActionError('') }, [selected?.id])

  // A forced outcome moves a live trip's state and money, so it needs a typed reason; the API stores it in the ride's history.
  async function handleForceResolve(action: 'complete' | 'cancel', reason: string) {
    if (!selected) return
    setResolving(true)
    setActionError('')
    try {
      await adminRideApi.forceResolve(selected.id, action, reason.trim())
      setResolveTarget(null)
      setSelected(null)
      await fetchRides(true)
      loadStats()
    } catch (err) {
      setResolveTarget(null)
      setActionError(extractErrorMessage(err, `Could not force ${action} this ride. It may have changed: refresh and try again.`))
    } finally {
      setResolving(false)
    }
  }

  // Deep link from other admin pages (e.g. SOS "View ride") opens the ride directly, whatever the list's filters or page.
  // Read once on arrival; after that the URL follows the selection (below), not the other way round.
  useEffect(() => {
    const rideId = searchParams.get('ride')
    if (!rideId) return
    let cancelled = false
    adminRideApi.getById(rideId).then(d => { if (!cancelled) setSelected(d) }).catch(() => {})
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Keep the address bar in step with the view. The first run is skipped so an arriving ?ride= is not stripped before it loads.
  const firstUrlSync = useRef(true)
  useEffect(() => {
    if (firstUrlSync.current) { firstUrlSync.current = false; return }
    const p = new URLSearchParams()
    if (debouncedSearch) p.set('q', debouncedSearch)
    if (statusFilter) p.set('status', statusFilter)
    if (rideTypeFilter) p.set('type', rideTypeFilter)
    if (cityFilter) p.set('city', cityFilter)
    if (dateFrom) p.set('from', dateFrom)
    if (dateTo) p.set('to', dateTo)
    if (cashFlagFilter) p.set('cash', cashFlagFilter)
    if (attentionOnly) p.set('attention', '1')
    if (page > 1) p.set('page', String(page))
    if (selected) p.set('ride', selected.id)
    const qs = p.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- selected?.id is the only part of selected that matters here
  }, [debouncedSearch, statusFilter, rideTypeFilter, cityFilter, dateFrom, dateTo, cashFlagFilter, attentionOnly, page, selected?.id, pathname, router])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      // Only a real change of the search resets paging (not the first run, which would drop a ?page= the URL arrived with).
      setDebouncedSearch(prev => { if (prev !== search) setPage(1); return search })
    }, 400)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [search])

  const fetchRides = useCallback(async (silent = false) => {
    const myRequest = ++requestId.current
    if (!silent) setLoading(true)
    try {
      const params: Parameters<typeof adminRideApi.list>[0] = { page, limit: LIMIT }
      if (statusFilter)    params.status    = statusFilter
      if (rideTypeFilter)  params.ride_type = rideTypeFilter
      if (debouncedSearch) params.search    = debouncedSearch
      if (cashFlagFilter)  params.cashDiscrepancy = true
      if (attentionOnly)   params.attention = true
      if (cityFilter)      params.cityId    = parseInt(cityFilter, 10)
      if (dateFrom)         params.dateFrom  = dateFrom
      if (dateTo)           params.dateTo    = dateTo
      const data = await adminRideApi.list(params)
      if (myRequest !== requestId.current) return
      setRides(data.rides)
      setTotal(data.pagination.total)
      setTotalCapped(data.pagination.total_capped === true)
      setPages(data.pagination.pages)
      setLoadError('')
      setRefreshedAt(new Date())
    } catch (err) {
      if (myRequest !== requestId.current) return
      // Say the load failed. An empty table here would read as "no rides", which is the wrong thing to believe in an outage.
      setLoadError(extractErrorMessage(err, 'Could not load rides.'))
      if (!silent) { setRides([]); setTotal(0); setTotalCapped(false); setPages(1) }
    } finally {
      if (myRequest === requestId.current) setLoading(false)
    }
  }, [page, statusFilter, rideTypeFilter, debouncedSearch, cashFlagFilter, attentionOnly, cityFilter, dateFrom, dateTo])

  useEffect(() => { void fetchRides() }, [fetchRides])

  const refreshAll = useCallback(() => { void fetchRides(true); loadStats(); loadDispatch() }, [fetchRides, loadStats, loadDispatch])
  // Live view: refresh on a timer while the tab is visible and nothing is open (a refresh must never reshuffle rows under an open ride or dialog),
  // and once more as soon as the tab comes back to the front.
  useEffect(() => {
    if (!live || selected || resolveTarget) return
    const tick = () => { if (document.visibilityState === 'visible') refreshAll() }
    const id = setInterval(tick, LIVE_REFRESH_MS)
    document.addEventListener('visibilitychange', tick)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', tick) }
  }, [live, selected, resolveTarget, refreshAll])

  // Step through the rides on this page without closing the drawer (arrows, or J and K).
  const selIndex = selected ? rides.findIndex(x => x.id === selected.id) : -1
  const prevRide = selIndex > 0 ? () => setSelected(rides[selIndex - 1]!) : null
  const nextRide = selIndex >= 0 && selIndex < rides.length - 1 ? () => setSelected(rides[selIndex + 1]!) : null

  const datePreset = (from: string, to: string) => { setDateFrom(from); setDateTo(to); setPage(1) }
  const presetActive = (daysFrom: number, daysTo: number) => dateFrom === istDay(daysFrom) && dateTo === istDay(daysTo)

  const columns = [
    {
      key: 'id', header: 'Ride ID',
      render: (r: AdminRideItem) => <span className="font-mono text-xs text-primary">#{r.id}</span>,
    },
    {
      key: 'user', header: 'User',
      render: (r: AdminRideItem) => (
        <div className="flex items-center gap-2">
          {r.user_name ? <Avatar name={r.user_name} /> : null}
          <div className="min-w-0">
            <p className="font-semibold text-text-primary truncate">{r.user_name ?? r.user_phone}</p>
            {r.user_name ? <p className="text-xs text-text-muted">{r.user_phone}</p> : null}
          </div>
        </div>
      ),
    },
    {
      key: 'driver', header: 'Driver',
      render: (r: AdminRideItem) => r.driver_name
        ? (
          <div className="flex items-center gap-2">
            <Avatar name={r.driver_name} tone="muted" />
            <div className="min-w-0">
              <p className="font-medium text-text-secondary truncate">{r.driver_name}</p>
              <p className="text-xs text-text-muted">{r.driver_phone}</p>
            </div>
          </div>
        )
        : (
          <div className="flex items-center gap-2">
            <span className="text-text-muted italic text-xs">Unassigned</span>
            {['scheduled', 'requested', 'no_drivers'].includes(r.status) && (
              <Link
                href={`/dispatch?ride=${r.id}`}
                onClick={e => e.stopPropagation()}
                className="px-2 py-1 text-xs font-semibold bg-primary text-white rounded-full hover:bg-primary-dark transition-colors duration-150"
              >
                Assign
              </Link>
            )}
          </div>
        ),
    },
    {
      key: 'route', header: 'Route',
      render: (r: AdminRideItem) => (
        <div className="space-y-0.5 max-w-[170px]">
          <div className="flex items-start gap-1.5">
            <MapPin className="w-3 h-3 text-success mt-0.5 shrink-0" />
            <p className="text-xs text-text-secondary leading-snug line-clamp-1">{r.origin_address ?? '—'}</p>
          </div>
          <div className="flex items-start gap-1.5">
            <MapPin className="w-3 h-3 text-danger mt-0.5 shrink-0" />
            <p className="text-xs text-text-muted leading-snug line-clamp-1">{r.destination_address ?? '—'}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'ride_type', header: 'Type',
      render: (r: AdminRideItem) => <StatusPill status={cardMode(r)} />,
    },
    {
      key: 'fare', header: 'Fare',
      render: (r: AdminRideItem) => r.fare
        ? <span className="font-bold text-text-primary">₹{parseFloat(r.fare).toLocaleString('en-IN')}</span>
        : <span className="text-text-muted">—</span>,
    },
    {
      key: 'status', header: 'Status',
      render: (r: AdminRideItem) => (
        <span className="inline-flex items-center gap-1 flex-wrap">
          <StatusPill status={r.status} />
          {r.cash_discrepancy && <StatusPill status="cash_flagged" />}
        </span>
      ),
    },
    {
      key: 'requested_at', header: 'Time (IST)',
      render: (r: AdminRideItem) => <span className="text-text-muted text-xs whitespace-nowrap">{fmt(r.requested_at)}</span>,
    },
    {
      key: 'actions', header: '',
      render: (r: AdminRideItem) => (
        <div className="flex items-center gap-1.5 justify-end">
          <a
            href={`tel:${r.user_phone}`}
            onClick={e => e.stopPropagation()}
            title={`Call ${r.user_name ?? r.user_phone}`}
            aria-label={`Call ${r.user_name ?? r.user_phone}`}
            className="p-1.5 rounded-lg text-text-muted hover:text-primary hover:bg-surface-2 transition-colors"
          >
            <Phone className="w-3.5 h-3.5" />
          </a>
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
            <Car className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-text-primary">Rides</h2>
            <p className="text-xs text-text-muted"><span title={totalCapped ? CAPPED_TOTAL_HINT : undefined}>{loadError && rides.length === 0 ? '—' : formatTotal(total, totalCapped)}</span> total rides</p>
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs text-text-muted">
          {refreshedAt && <span aria-live="off">Updated {fmtIstClock(refreshedAt)} IST</span>}
          <label className="inline-flex items-center gap-1.5 cursor-pointer select-none text-text-secondary font-medium">
            <input type="checkbox" checked={live} onChange={e => setLive(e.target.checked)} className="accent-primary" />
            Live
          </label>
          <button onClick={refreshAll} aria-label="Refresh now" title="Refresh now"
            className="p-1.5 rounded-lg border border-border text-text-secondary hover:bg-surface-2 transition-colors">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Rides today" value={stats?.today_count ?? '—'} change="" changeType="neutral" icon={CalendarClock} gradient="blue" loading={!stats} />
        <StatCard title="Active now" value={stats?.active_count ?? '—'} change="" changeType="neutral" icon={Activity} gradient="green" loading={!stats} />
        <StatCard title="Cancelled today" value={stats?.cancelled_today_count ?? '—'} change="" changeType="neutral" icon={XCircle} gradient="pink" loading={!stats} />
        <StatCard title="Cash flagged today" value={stats?.cash_flagged_count ?? '—'} change="" changeType="neutral" icon={Wallet} gradient="amber" loading={!stats} />
      </div>

      <Link href="/dispatch" className="flex items-center justify-between gap-3 rounded-2xl border border-border-light bg-surface hover:bg-surface-2 transition-colors px-4 py-3">
        <span className="flex items-center gap-3 min-w-0">
          <span className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0"><Headset className="w-4 h-4 text-primary" /></span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-text-primary">Dispatch desk</span>
            <span className="block text-xs text-text-muted truncate">Advance bookings, and rides that still need a driver</span>
          </span>
        </span>
        <span className="flex items-center gap-2 flex-shrink-0 text-xs">
          {dispatch && dispatch.searching_long + dispatch.no_drivers + dispatch.overdue > 0 && (
            <span className="pill-danger">{(dispatch.searching_long + dispatch.no_drivers + dispatch.overdue).toLocaleString('en-IN')} need attention</span>
          )}
          {dispatch && <span className="text-text-muted">{dispatch.scheduled_total.toLocaleString('en-IN')} scheduled</span>}
        </span>
      </Link>

      <div className="admin-card">
        <div className="mb-3 flex items-center gap-2 flex-wrap" role="group" aria-label="Quick filters">
          <button type="button" aria-pressed={attentionOnly} onClick={() => { setAttentionOnly(v => !v); setPage(1) }}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-full border transition-colors ${
              attentionOnly ? 'bg-danger text-white border-danger' : 'bg-surface border-border text-text-secondary hover:bg-surface-2'}`}>
            <AlertTriangle className="w-3.5 h-3.5" />
            Needs attention{stats && Number(stats.needs_attention_count) > 0 ? ` (${Number(stats.needs_attention_count).toLocaleString('en-IN')})` : ''}
          </button>
          <span className="w-px h-5 bg-border-light mx-1" aria-hidden />
          {([['Today', 0, 0], ['Yesterday', 1, 1], ['Last 7 days', 6, 0]] as const).map(([label, from, to]) => (
            <button key={label} type="button" aria-pressed={presetActive(from, to)} onClick={() => presetActive(from, to) ? datePreset('', '') : datePreset(istDay(from), istDay(to))}
              className={`px-3 py-1.5 text-xs font-semibold rounded-full border transition-colors ${
                presetActive(from, to) ? 'bg-primary text-white border-primary' : 'bg-surface border-border text-text-secondary hover:bg-surface-2'}`}>
              {label}
            </button>
          ))}
        </div>
        <div className="mb-4">
          <FilterBar
            search={search}
            onSearch={setSearch}
            searchPlaceholder="Name, phone or ride ID…"
            actions={
              <>
                <input
                  type="date" value={dateFrom} aria-label="From date"
                  onChange={e => { setDateFrom(e.target.value); setPage(1) }}
                  className="px-3 py-2 text-sm bg-surface border border-border rounded-xl text-text-secondary focus:outline-none focus:border-primary"
                />
                <input
                  type="date" value={dateTo} aria-label="To date"
                  onChange={e => { setDateTo(e.target.value); setPage(1) }}
                  className="px-3 py-2 text-sm bg-surface border border-border rounded-xl text-text-secondary focus:outline-none focus:border-primary"
                />
              </>
            }
            filters={[
              {
                key: 'city', label: 'All Cities',
                options: cities.map(c => ({ value: String(c.id), label: c.name })),
                value: cityFilter,
                onChange: (v) => { setCityFilter(v); setPage(1) },
              },
              {
                key: 'status', label: 'All Statuses',
                options: [
                  { value: 'scheduled',   label: 'Scheduled'   },
                  { value: 'requested',   label: 'Requested'   },
                  { value: 'no_drivers',  label: 'No Drivers'  },
                  { value: 'accepted',    label: 'Accepted'    },
                  { value: 'driver_arrived', label: 'Arrived'  },
                  { value: 'in_progress', label: 'In Progress' },
                  { value: 'returning',   label: 'Returning'   },
                  { value: 'completed',   label: 'Completed'   },
                  { value: 'cancelled',   label: 'Cancelled'   },
                ],
                value: statusFilter,
                onChange: (v) => { setStatusFilter(v); setPage(1) },
              },
              {
                key: 'ride_type', label: 'All Types',
                options: [
                  { value: 'one_way',    label: 'One Way'     },
                  { value: 'round_trip', label: 'Round Trip'  },
                  { value: 'city',       label: 'City Ride'   },
                  { value: 'rental',     label: 'Rental'      },
                ],
                value: rideTypeFilter,
                onChange: (v) => { setRideTypeFilter(v); setPage(1) },
              },
              {
                key: 'cash_flag', label: 'All Rides',
                options: [
                  { value: 'flagged', label: 'Cash Flagged Only' },
                ],
                value: cashFlagFilter,
                onChange: (v) => { setCashFlagFilter(v); setPage(1) },
              },
            ]}
          />
        </div>
        {loadError && (
          <div role="alert" className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-danger/30 bg-danger-light px-3 py-2 text-xs text-danger">
            <span className="font-semibold">{loadError}{rides.length > 0 ? ' The list below may be out of date.' : ''}</span>
            <button onClick={() => void fetchRides()} className="font-semibold underline flex-shrink-0">Retry</button>
          </div>
        )}
        <DataTable
          isLoading={loading}
          columns={columns as unknown as { key: string; header: string; render?: (row: Record<string, unknown>) => React.ReactNode }[]}
          data={rides as unknown as Record<string, unknown>[]}
          onRowClick={row => setSelected(row as unknown as AdminRideItem)}
          emptyMessage={loadError ? 'Rides could not be loaded' : attentionOnly ? 'Nothing needs attention right now' : 'No rides match your filters'}
        />
        {pages > 1 && (
          <div className="flex items-center justify-between mt-4 pt-4 border-t border-border-light">
            <p className="text-xs text-text-muted"><span title={totalCapped ? CAPPED_TOTAL_HINT : undefined}>{formatTotal(total, totalCapped)}</span> total</p>
            <div className="flex gap-2">
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="px-3 py-1 text-xs border border-border rounded-lg disabled:opacity-40 hover:bg-surface-2 transition-colors">Prev</button>
              <span className="px-3 py-1 text-xs text-text-muted">{page} / {pages}{totalCapped ? '+' : ''}</span>
              <button disabled={!hasNextPage({ page, pages, capped: totalCapped, rowsOnPage: rides.length, limit: LIMIT })} onClick={() => setPage(p => p + 1)} className="px-3 py-1 text-xs border border-border rounded-lg disabled:opacity-40 hover:bg-surface-2 transition-colors">Next</button>
            </div>
          </div>
        )}
      </div>

      <SlideOver isOpen={!!selected} onClose={() => setSelected(null)} title={selected ? `Ride #${selected.id}` : ''} width="xl" bare>
        {selected && (
          <RideDrawer
            ride={selected}
            canAct={canAct}
            position={selIndex >= 0 ? { index: selIndex, total: rides.length } : null}
            onPrev={prevRide}
            onNext={nextRide}
            onClose={() => setSelected(null)}
            onForce={setResolveTarget}
            forceBusy={resolving}
            actionError={actionError}
            now={now}
          />
        )}
      </SlideOver>

      <ReasonDialog
        open={resolveTarget !== null}
        title={resolveTarget === 'cancel' ? `Force cancel ride #${selected?.id ?? ''}?` : `Force complete ride #${selected?.id ?? ''}?`}
        description={`${resolveTarget === 'cancel' ? FORCE_CONSEQUENCE.cancel : FORCE_CONSEQUENCE.complete} It is recorded in the ride history with your reason and cannot be undone from here.`}
        confirmLabel={resolveTarget === 'cancel' ? 'Force cancel' : 'Force complete'}
        variant={resolveTarget === 'cancel' ? 'danger' : 'warning'}
        loading={resolving}
        onCancel={() => setResolveTarget(null)}
        onConfirm={reason => { if (resolveTarget) void handleForceResolve(resolveTarget, reason) }}
      />
    </div>
  )
}

export default function RidesPage() {
  return (
    <Suspense fallback={null}>
      <RidesPageContent />
    </Suspense>
  )
}
