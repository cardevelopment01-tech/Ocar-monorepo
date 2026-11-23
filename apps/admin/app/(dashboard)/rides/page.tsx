'use client'
import React from 'react'
import { cardMode } from '@/lib/rate-card-mode'
import { Suspense, useState, useEffect, useRef, useCallback } from 'react'
import { useSearchParams, usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Car, MapPin, Star, ChevronDown, Phone, Copy, Check, Activity, XCircle, Wallet, CalendarClock, AlertTriangle, RefreshCw, Link2, Headset } from 'lucide-react'
import StatusPill from '@/components/ui/StatusPill'
import DataTable from '@/components/ui/DataTable'
import FilterBar from '@/components/ui/FilterBar'
import SlideOver from '@/components/ui/SlideOver'
import StatCard from '@/components/ui/StatCard'
import ReasonDialog from '@/components/ui/ReasonDialog'
import { adminRideApi, type AdminRideItem, type AdminRideStop, type AdminRideDetail, type AdminRideStats, type AdminRideTrailPoint } from '@/lib/admin-api'
import { extractErrorMessage } from '@/lib/http-errors'
import { fmtIst, fmtIstClock, istDay } from '@/lib/ist'
import { formatTotal, hasNextPage, CAPPED_TOTAL_HINT } from '@/lib/format-total'
import { cityApi, type AdminCity } from '@/lib/city-api'
import { dispatchApi, type DispatchSummary } from '@/lib/dispatch-api'
import BookedTimeBlock from '@/components/rides/BookedTimeBlock'
import RideOffers, { offerSummary } from '@/components/rides/RideOffers'
import RideMap from '@/components/rides/RideMap'

const fmt = (iso: string | null) => fmtIst(iso)

// Refresh cadence for the live view. Each tick is the list page + stats, all index-backed, and only runs while the tab is visible and nothing is open.
const LIVE_REFRESH_MS = 30_000
// Statuses where a driver is (or was just) on the way or on the trip: the map is the first thing an operator wants.
const MAP_OPEN_STATUSES = ['accepted', 'driver_arrived', 'in_progress', 'returning']

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

// Secondary/investigative ride-detail info: collapsed by default so the
// primary trip summary isn't buried under a scroll of equal-weight cards.
function Section({ title, defaultOpen = false, onToggle, children }: { title: string; defaultOpen?: boolean; onToggle?: (open: boolean) => void; children: React.ReactNode }) {
  return (
    <details open={defaultOpen} onToggle={onToggle ? e => onToggle((e.currentTarget as HTMLDetailsElement).open) : undefined} className="bg-surface-2 rounded-xl border border-border-light group">
      <summary className="flex items-center justify-between px-3 py-2.5 cursor-pointer select-none list-none text-xs font-semibold text-text-secondary [&::-webkit-details-marker]:hidden">
        {title}
        <ChevronDown className="w-3.5 h-3.5 text-text-muted transition-transform duration-150 motion-reduce:transition-none group-open:rotate-180" />
      </summary>
      <div className="px-3 pb-3 space-y-1.5">{children}</div>
    </details>
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
  const [detailStops, setDetailStops] = useState<AdminRideStop[]>([])
  const [detail, setDetail] = useState<AdminRideDetail | null>(null)
  const [resolving, setResolving] = useState(false)
  const [resolveTarget, setResolveTarget] = useState<'complete' | 'cancel' | null>(null)
  const [actionError, setActionError] = useState('')
  const [detailError, setDetailError] = useState(false)
  const [detailTick, setDetailTick] = useState(0)
  const [mapOpen, setMapOpen] = useState(false)
  const [trail, setTrail] = useState<AdminRideTrailPoint[]>([])
  const [trailState, setTrailState] = useState<'loading' | 'ready' | 'failed' | 'none'>('none')

  // Advance bookings and driver assignment live on the Dispatch desk; this page only points there, with the number that needs a person.
  const [dispatch, setDispatch] = useState<DispatchSummary | null>(null)
  const loadDispatch = useCallback(() => { dispatchApi.summary().then(setDispatch).catch(() => {}) }, [])
  useEffect(() => { loadDispatch() }, [loadDispatch])

  const [stats, setStats] = useState<AdminRideStats | null>(null)
  // A failed refresh keeps the last numbers on screen instead of blanking the cards.
  const loadStats = useCallback(() => { adminRideApi.stats().then(setStats).catch(() => {}) }, [])
  useEffect(() => { loadStats() }, [loadStats])

  const [copied, setCopied] = useState<'id' | 'link' | null>(null)
  async function copyText(text: string, what: 'id' | 'link') {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(what)
      setTimeout(() => setCopied(null), 1500)
    } catch {
      // Clipboard is only available on https and with permission; say so instead of looking like a dead button.
      setActionError('Could not copy. Select the text and copy it by hand.')
    }
  }


  // Fetch the ride's stop timeline (incl. wait charges) when a ride is opened —
  // the list row doesn't carry stops. Needed for wait-charge dispute resolution.
  useEffect(() => {
    setActionError(''); setDetailError(false)
    if (!selected) { setDetailStops([]); setDetail(null); return }
    let cancelled = false
    adminRideApi.getById(selected.id)
      .then(d => { if (!cancelled) { setDetailStops(d.stops ?? []); setDetail(d) } })
      .catch(() => { if (!cancelled) { setDetailStops([]); setDetail(null); setDetailError(true) } })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, detailTick])

  // The map and the driver's route load only when the section is open, and only for rides that have had a driver.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setMapOpen(!!selected && MAP_OPEN_STATUSES.includes(selected.status)) }, [selected?.id, selected?.status])
  useEffect(() => {
    setTrail([])
    if (!selected || !mapOpen || !selected.driver_name) { setTrailState('none'); return }
    let cancelled = false
    setTrailState('loading')
    adminRideApi.trail(selected.id)
      .then(pts => { if (!cancelled) { setTrail(pts); setTrailState(pts.length ? 'ready' : 'none') } })
      .catch(() => { if (!cancelled) setTrailState('failed') })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, mapOpen])

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

      <SlideOver isOpen={!!selected} onClose={() => setSelected(null)} title={selected ? `Ride #${selected.id}` : ''} width="lg">
        {selected && (
          <div className="p-6 space-y-5">
            <div className="flex items-center gap-2 flex-wrap">
              <StatusPill status={selected.status} />
              <StatusPill status={cardMode(selected)} />
              {selected.is_return_cab && (
                <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-amber-100 text-amber-700">Return Cab</span>
              )}
              {detail?.sos_triggered && (
                <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-red-100 text-red-700">
                  SOS · {fmt(detail.sos_triggered_at)}
                </span>
              )}
              <span className="text-text-muted text-sm">{fmt(selected.requested_at)}</span>
            </div>

            {/* Persistent action bar — the primary CTAs for this ride, always
                visible instead of buried inline further down the scroll. */}
            <div className="flex items-center gap-1.5 flex-wrap pb-1 border-b border-border-light">
              <a
                href={`tel:${selected.user_phone}`}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-text-secondary border border-border rounded-lg hover:bg-surface-2 transition-colors"
              >
                <Phone className="w-3.5 h-3.5" /> Call rider
              </a>
              {selected.driver_phone && (
                <a
                  href={`tel:${selected.driver_phone}`}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-text-secondary border border-border rounded-lg hover:bg-surface-2 transition-colors"
                >
                  <Phone className="w-3.5 h-3.5" /> Call driver
                </a>
              )}
              <button
                onClick={() => void copyText(selected.id, 'id')}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-text-secondary border border-border rounded-lg hover:bg-surface-2 transition-colors"
              >
                {copied === 'id' ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
                {copied === 'id' ? 'Copied' : 'Copy ID'}
              </button>
              <button
                onClick={() => void copyText(`${window.location.origin}${pathname}?ride=${selected.id}`, 'link')}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-text-secondary border border-border rounded-lg hover:bg-surface-2 transition-colors"
              >
                {copied === 'link' ? <Check className="w-3.5 h-3.5 text-success" /> : <Link2 className="w-3.5 h-3.5" />}
                {copied === 'link' ? 'Copied' : 'Copy link'}
              </button>
              {(selected.status === 'in_progress' || selected.status === 'returning') && (
                <div className="ml-auto flex items-center gap-1.5">
                  <button
                    disabled={resolving}
                    onClick={() => setResolveTarget('cancel')}
                    className="px-2.5 py-1.5 text-xs font-semibold bg-danger text-white rounded-lg disabled:opacity-50 hover:opacity-90 transition-opacity"
                  >
                    Force cancel
                  </button>
                  <button
                    disabled={resolving}
                    onClick={() => setResolveTarget('complete')}
                    className="px-2.5 py-1.5 text-xs font-semibold bg-success text-white rounded-lg disabled:opacity-50 hover:opacity-90 transition-opacity"
                  >
                    Force complete
                  </button>
                </div>
              )}
            </div>

            {actionError && (
              <div role="alert" className="rounded-xl border border-danger/30 bg-danger-light px-3 py-2 text-xs font-semibold text-danger">{actionError}</div>
            )}
            {detailError && (
              <div role="alert" className="rounded-xl border border-warning/40 bg-warning-light px-3 py-2 text-xs text-text-primary flex items-center justify-between gap-3">
                <span>Full details could not be loaded. Fare breakdown, offers and the map are missing.</span>
                <button onClick={() => setDetailTick(t => t + 1)} className="font-semibold underline flex-shrink-0">Retry</button>
              </div>
            )}
            {detail && (detail.category_name || detail.origin_city) && (
              <p className="text-xs text-text-muted -mt-2">
                {[detail.category_name, detail.origin_city && detail.destination_city && detail.origin_city !== detail.destination_city
                  ? `${detail.origin_city} → ${detail.destination_city}` : detail.origin_city].filter(Boolean).join(' · ')}
              </p>
            )}

            {(selected.status === 'in_progress' || selected.status === 'returning') && (
              <div className={selected.review_flagged_at
                ? 'bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-1'
                : 'bg-surface-2 border border-border-light rounded-xl p-3 space-y-1'}>
                <p className={selected.review_flagged_at
                  ? 'text-xs font-semibold text-amber-800'
                  : 'text-xs font-semibold text-text-secondary'}>
                  {selected.review_flagged_at ? 'Flagged, possibly stuck' : 'Trip in progress'}
                </p>
                <p className={selected.review_flagged_at ? 'text-xs text-amber-700' : 'text-xs text-text-muted'}>
                  {selected.review_flagged_at
                    ? `No driver GPS update since ${fmt(selected.review_flagged_at)}${selected.review_reason ? ` (${selected.review_reason.replace(/_/g, ' ')})` : ''}`
                    : 'Not auto-flagged yet. Resolve manually if this ride needs intervention.'}
                </p>
              </div>
            )}

            {detail && <BookedTimeBlock ride={detail} />}

            <div className={`bg-surface-2 rounded-xl border border-border-light grid ${detail?.vehicle_number_plate ? 'grid-cols-3' : 'grid-cols-2'} divide-x divide-border-light`}>
              <div className="p-3 min-w-0 flex items-center gap-2">
                <Avatar name={selected.user_name} />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-text-secondary mb-0.5">Rider</p>
                  <p className="font-semibold text-text-primary text-sm truncate">{selected.user_name}</p>
                  <p className="text-xs text-text-muted">{selected.user_phone}</p>
                </div>
              </div>
              <div className="p-3 min-w-0 flex items-center gap-2">
                {selected.driver_name && <Avatar name={selected.driver_name} tone="muted" />}
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-text-secondary mb-0.5">Driver</p>
                  {selected.driver_name && detail?.driver_id
                    ? <Link href={`/drivers/${detail.driver_id}`} className="font-semibold text-primary text-sm truncate block hover:underline">{selected.driver_name}</Link>
                    : <p className="font-semibold text-text-primary text-sm truncate">{selected.driver_name ?? 'Unassigned'}</p>}
                  <p className="text-xs text-text-muted">{selected.driver_phone ?? ''}</p>
                </div>
              </div>
              {detail?.vehicle_number_plate && (
                <div className="p-3 min-w-0">
                  <p className="text-xs font-semibold text-text-secondary mb-1">Vehicle</p>
                  <p className="font-semibold text-text-primary text-sm truncate">{detail.vehicle_name ?? '—'}{detail.vehicle_color ? ` · ${detail.vehicle_color}` : ''}</p>
                  <p className="text-xs text-text-muted font-mono">{detail.vehicle_number_plate}</p>
                </div>
              )}
            </div>

            <div className="bg-surface-2 rounded-xl p-3 border border-border-light">
              <p className="text-xs font-semibold text-text-secondary mb-2">Route</p>
              <div className="space-y-2">
                <div className="flex items-start gap-2">
                  <MapPin className="w-3.5 h-3.5 text-success mt-0.5 shrink-0" />
                  <p className="text-sm font-medium text-text-primary leading-snug">{selected.origin_address ?? '—'}</p>
                </div>
                <div className="border-l border-dashed border-border-light ml-[6px] h-3" />
                <div className="flex items-start gap-2">
                  <MapPin className="w-3.5 h-3.5 text-danger mt-0.5 shrink-0" />
                  <p className="text-sm font-medium text-text-primary leading-snug">{selected.destination_address ?? 'No fixed destination'}</p>
                </div>
              </div>
              {selected.fare && (
                <p className="text-2xl font-bold text-text-primary mt-3">₹{parseFloat(selected.fare).toLocaleString('en-IN')}</p>
              )}
            </div>

            {/* offers is absent until the API that sends it is deployed: the web side may go out first. */}
            {detail && detail.offers && (
              <Section title={`Dispatch history (${detail.offers.length})`} defaultOpen={!selected.driver_name || ['requested', 'no_drivers', 'scheduled'].includes(selected.status)}>
                <p className="sr-only">{offerSummary(detail.offers)}</p>
                <RideOffers offers={detail.offers} />
              </Section>
            )}

            {detail && (detail.origin_lat != null && detail.origin_lng != null) && (
              <Section title="Map and route" defaultOpen={mapOpen} onToggle={setMapOpen}>
                {mapOpen && (
                  <RideMap
                    pickup={{ lat: detail.origin_lat, lng: detail.origin_lng }}
                    drop={detail.destination_lat != null && detail.destination_lng != null ? { lat: detail.destination_lat, lng: detail.destination_lng } : null}
                    trail={trail}
                    trailState={trailState}
                  />
                )}
              </Section>
            )}

            {detail && [detail.base_fare, detail.distance_fare, detail.time_fare, detail.stop_fare, detail.hour_surcharge, detail.waiting_fare, detail.overage_fare, detail.surge_fare, detail.overtimeFare != null ? String(detail.overtimeFare) : null, detail.pickup_wait_charge, detail.toll_charge, detail.refund_amount].some(v => v && parseFloat(v) > 0) && (
              <Section title="Fare breakdown">
                {(
                  [
                    ['Base', detail.base_fare], ['Distance', detail.distance_fare], ['Time', detail.time_fare],
                    ['Stops', detail.stop_fare], ['Hour surcharge', detail.hour_surcharge],
                    ['Booked time', detail.waiting_fare ?? null],
                    ['Overage', detail.overage_fare],
                    ['Surge', detail.surge_fare, detail.surge_multiplier && parseFloat(detail.surge_multiplier) > 1 ? `×${detail.surge_multiplier}` : ''],
                    // After surge: overtime is not surged.
                    ['Extra time', detail.overtimeFare != null ? String(detail.overtimeFare) : null],
                    // Not surged. The suffix shows the minutes waited against the free minutes the ride was booked with.
                    ['Airport toll', detail.toll_charge ?? null, detail.toll_detail?.length ? `(${detail.toll_detail.map(t => t.zone).join(', ')})` : ''],
                    ['Waiting at pickup', detail.pickup_wait_charge ?? null, detail.pickup_wait_min ? `(${Math.round(parseFloat(detail.pickup_wait_min))} min${detail.pickup_free_wait_min != null ? `, ${detail.pickup_free_wait_min} free` : ''})` : ''],
                  ] as [string, string | null, string?][]
                ).filter(([, v]) => v && parseFloat(v) > 0).map(([label, v, suffix]) => (
                  <div key={label} className="flex justify-between items-center">
                    <span className="text-xs text-text-muted">{label} {suffix}</span>
                    <span className="text-xs font-medium text-text-primary">₹{parseFloat(v!).toLocaleString('en-IN')}</span>
                  </div>
                ))}
                {detail.refund_amount && parseFloat(detail.refund_amount) > 0 && (
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-danger">Refunded</span>
                    <span className="text-xs font-medium text-danger">₹{parseFloat(detail.refund_amount).toLocaleString('en-IN')}</span>
                  </div>
                )}
                {(detail.actual_km || detail.estimated_km) && (
                  <p className="text-[11px] text-text-muted pt-1">
                    {detail.actual_km ? `${parseFloat(detail.actual_km).toFixed(1)} km actual` : `${parseFloat(detail.estimated_km ?? '0').toFixed(1)} km estimated`}
                    {detail.overage_km && parseFloat(detail.overage_km) > 0 ? ` · ${parseFloat(detail.overage_km).toFixed(1)} km overage` : ''}
                  </p>
                )}
              </Section>
            )}

            <Section title="Timeline">
              {(() => {
                const loggedStatuses = new Set((detail?.status_history ?? []).map(ev => ev.to_status))
                const fromHistory = (detail?.status_history ?? []).map(ev => ({
                  label: ev.to_status.replace(/_/g, ' '), ts: ev.created_at, actor: ev.actor, note: ev.note,
                }))
                const fromFlat = [
                  { label: 'Requested',      ts: selected.requested_at,      status: 'requested' },
                  { label: 'Accepted',       ts: selected.accepted_at,       status: 'accepted' },
                  { label: 'Driver Arrived', ts: selected.driver_arrived_at, status: 'driver_arrived' },
                  { label: 'Trip Started',   ts: selected.started_at,        status: 'in_progress' },
                  { label: 'Completed',      ts: selected.completed_at,      status: 'completed' },
                ]
                  .filter(({ ts, status }) => ts && !loggedStatuses.has(status))
                  .map(({ label, ts }) => ({ label, ts: ts as string, actor: null as string | null, note: null as string | null }))
                const events = [...fromHistory, ...fromFlat].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())
                return (
                  <div className="relative">
                    {events.map((ev, i) => (
                      <div key={i} className="relative pl-4 pb-3 last:pb-0">
                        {i < events.length - 1 && (
                          <span className="absolute left-[3px] top-2.5 bottom-[-4px] w-px bg-border-light" />
                        )}
                        <span className={`absolute left-0 top-1 w-[7px] h-[7px] rounded-full ${i === events.length - 1 ? 'bg-primary' : 'bg-text-muted'}`} />
                        <div className="flex justify-between items-start gap-2">
                          <div className="min-w-0">
                            <span className="text-xs font-medium text-text-primary capitalize">{ev.label}</span>
                            {ev.actor && <span className="text-xs text-text-muted capitalize"> · {ev.actor}</span>}
                            {ev.note && <p className="text-[11px] text-text-muted">{ev.note}</p>}
                          </div>
                          <span className="text-xs text-text-muted whitespace-nowrap">{fmt(ev.ts)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )
              })()}
            </Section>

            {detailStops.length > 0 && (
              <Section title="Stops">
                {detailStops.map((s) => {
                  const dwellMin = s.arrived_at && s.reached_at
                    ? Math.round((new Date(s.reached_at).getTime() - new Date(s.arrived_at).getTime()) / 60000)
                    : null
                  const wait = parseFloat(s.wait_charge)
                  return (
                    <div key={s.id} className="flex justify-between items-center gap-2">
                      <span className="text-xs text-text-primary truncate">{s.sequence}. {s.address ?? 'Stop'}</span>
                      <span className="text-xs text-text-muted whitespace-nowrap capitalize">
                        {s.status}
                        {dwellMin != null ? ` · ${dwellMin}m wait` : ''}
                        {wait > 0 ? ` · ₹${Math.round(wait)}` : ''}
                      </span>
                    </div>
                  )
                })}
              </Section>
            )}

            {(selected.payment_status || selected.payment_channel) && (
              <Section title="Payment" defaultOpen={selected.cash_discrepancy}>
                <div className="flex justify-between items-center">
                  <span className="inline-flex items-center gap-1 flex-wrap">
                    <StatusPill status={selected.payment_status ?? 'pending'} />
                    {selected.cash_discrepancy && <StatusPill status="cash_flagged" />}
                  </span>
                  {selected.payment_channel && (
                    <span className="text-xs text-text-muted capitalize">{selected.payment_channel.replace(/_/g, ' ')}</span>
                  )}
                </div>
                {selected.cash_discrepancy && (
                  <p className="text-xs text-danger mt-2">
                    Collected ₹{selected.cash_collected_amount ? parseFloat(selected.cash_collected_amount).toLocaleString('en-IN') : '0'}
                    {selected.fare ? ` vs fare ₹${parseFloat(selected.fare).toLocaleString('en-IN')}` : ''}
                  </p>
                )}
              </Section>
            )}

            {selected.status === 'cancelled' && (
              <Section title="Cancellation" defaultOpen>
                {selected.cancellation_actor && (
                  <p className="text-xs text-text-muted capitalize mb-1">By: {selected.cancellation_actor}</p>
                )}
                <p className="text-sm text-text-primary">
                  {selected.cancellation_reason
                    ?? (selected.cancellation_reason_code
                        ? selected.cancellation_reason_code.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
                        : 'No reason provided')}
                </p>
                {detail?.cancellation_fee_applicable && (
                  <p className="text-xs mt-2">
                    {detail.cancellation_fee_waived ? (
                      <span className="text-text-muted">
                        Fee ₹{parseFloat(detail.cancellation_fee_amount ?? '0').toLocaleString('en-IN')} waived
                        {detail.cancellation_fee_waived_reason ? ` — ${detail.cancellation_fee_waived_reason}` : ''}
                      </span>
                    ) : (
                      <span className="text-text-primary font-medium">
                        Cancellation fee: ₹{parseFloat(detail.cancellation_fee_amount ?? '0').toLocaleString('en-IN')}
                      </span>
                    )}
                  </p>
                )}
              </Section>
            )}

            {detail && detail.messages.length > 0 && (
              <Section title={`Chat (${detail.messages.length})`}>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {detail.messages.map(m => {
                    const fromDriver = m.senderType === 'driver'
                    return (
                      <div key={m.id} className={`flex ${fromDriver ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[80%] rounded-lg px-2.5 py-1.5 ${fromDriver ? 'bg-primary/10' : 'bg-surface border border-border-light'}`}>
                          <p className="text-xs text-text-primary whitespace-pre-wrap break-words">{m.body}</p>
                          <p className="text-[10px] text-text-muted mt-0.5">
                            {fromDriver ? selected.driver_name ?? 'Driver' : selected.user_name} · {fmt(m.createdAt)}
                          </p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </Section>
            )}

            {detail && (detail.disputes.length > 0 || detail.sos_alerts.length > 0 || detail.ratings.length > 0) && (
              <Section title="Related">
                {detail.disputes.map(d => (
                  <Link key={d.id} href="/disputes" className="flex justify-between items-center text-xs hover:underline">
                    <span className="text-text-primary capitalize">Dispute · {d.type.replace(/_/g, ' ')}</span>
                    <StatusPill status={d.status} />
                  </Link>
                ))}
                {detail.sos_alerts.map(s => (
                  <Link key={s.id} href="/sos" className="flex justify-between items-center text-xs hover:underline">
                    <span className="text-text-primary capitalize">SOS · {s.severity}</span>
                    <StatusPill status={s.status} />
                  </Link>
                ))}
                {detail.ratings.map((r, i) => (
                  <div key={i} className="flex justify-between items-start gap-2 text-xs">
                    <span className="text-text-muted capitalize">{r.direction.replace(/_/g, ' ')}</span>
                    <div className="text-right">
                      <span className="inline-flex items-center gap-0.5 font-medium text-text-primary">
                        {r.score} <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                      </span>
                      {r.comment && <p className="text-[11px] text-text-muted max-w-[170px]">{r.comment}</p>}
                    </div>
                  </div>
                ))}
              </Section>
            )}
          </div>
        )}
      </SlideOver>

      <ReasonDialog
        open={resolveTarget !== null}
        title={resolveTarget === 'cancel' ? `Force cancel ride #${selected?.id ?? ''}?` : `Force complete ride #${selected?.id ?? ''}?`}
        description={resolveTarget === 'cancel'
          ? 'This ends the trip as cancelled and releases the driver. It is recorded in the ride history with your reason, and cannot be undone from here.'
          : 'This ends the trip as completed and skips any stops the driver did not finish. It is recorded in the ride history with your reason, and cannot be undone from here.'}
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
