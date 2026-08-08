'use client'
import React from 'react'
import { Suspense, useState, useEffect, useRef, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Car, ArrowRight, RefreshCw, Clock, MapPin, Star } from 'lucide-react'
import StatusPill from '@/components/ui/StatusPill'
import DataTable from '@/components/ui/DataTable'
import FilterBar from '@/components/ui/FilterBar'
import SlideOver from '@/components/ui/SlideOver'
import { adminRideApi, type AdminRideItem, type AdminUpcomingRideItem, type AdminRideStop, type AdminRideDetail } from '@/lib/admin-api'
import { cityApi, type AdminCity } from '@/lib/city-api'

function fmt(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function SkeletonRows({ cols }: { cols: number }) {
  return (
    <>
      {Array.from({ length: 6 }).map((_, i) => (
        <tr key={i} className="border-b border-border-light last:border-b-0">
          {Array.from({ length: cols }).map((_, j) => (
            <td key={j} className="px-4 py-3">
              <div className="h-4 bg-surface-2 rounded animate-pulse" style={{ width: j === 0 ? '80px' : '90px' }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}

const LIMIT = 20

function RidesPageContent() {
  const searchParams = useSearchParams()
  const [rides, setRides] = useState<AdminRideItem[]>([])
  const [total, setTotal] = useState(0)
  const [pages, setPages] = useState(1)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [rideTypeFilter, setRideTypeFilter] = useState('')
  const [cashFlagFilter, setCashFlagFilter] = useState('')
  const [cityFilter, setCityFilter] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [cities, setCities] = useState<AdminCity[]>([])
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [debouncedSearch, setDebouncedSearch] = useState('')

  useEffect(() => { cityApi.list().then(setCities).catch(() => setCities([])) }, [])

  const [selected, setSelected] = useState<AdminRideItem | null>(null)
  const [detailStops, setDetailStops] = useState<AdminRideStop[]>([])
  const [detail, setDetail] = useState<AdminRideDetail | null>(null)
  const [resolving, setResolving] = useState(false)

  const [upcoming, setUpcoming] = useState<AdminUpcomingRideItem[]>([])
  const [upcomingLoading, setUpcomingLoading] = useState(true)

  const fetchUpcoming = useCallback(async () => {
    setUpcomingLoading(true)
    try {
      setUpcoming(await adminRideApi.upcoming())
    } catch {
      setUpcoming([])
    } finally {
      setUpcomingLoading(false)
    }
  }, [])

  useEffect(() => { void fetchUpcoming() }, [fetchUpcoming])

  // Fetch the ride's stop timeline (incl. wait charges) when a ride is opened —
  // the list row doesn't carry stops. Needed for wait-charge dispute resolution.
  useEffect(() => {
    if (!selected) { setDetailStops([]); setDetail(null); return }
    let cancelled = false
    adminRideApi.getById(selected.id)
      .then(d => { if (!cancelled) { setDetailStops(d.stops ?? []); setDetail(d) } })
      .catch(() => { if (!cancelled) { setDetailStops([]); setDetail(null) } })
    return () => { cancelled = true }
  }, [selected?.id])

  async function handleForceResolve(action: 'complete' | 'cancel') {
    if (!selected) return
    setResolving(true)
    try {
      await adminRideApi.forceResolve(selected.id, action)
      setSelected(null)
      await fetchRides()
    } finally {
      setResolving(false)
    }
  }

  // Deep link from other admin pages (e.g. SOS "View ride"), opens the ride
  // detail directly regardless of the current list/filters/pagination.
  useEffect(() => {
    const rideId = searchParams.get('ride')
    if (!rideId) return
    let cancelled = false
    adminRideApi.getById(rideId).then(d => { if (!cancelled) setSelected(d) }).catch(() => {})
    return () => { cancelled = true }
  }, [searchParams])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => { setDebouncedSearch(search); setPage(1) }, 400)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [search])

  const fetchRides = useCallback(async () => {
    setLoading(true)
    try {
      const params: Parameters<typeof adminRideApi.list>[0] = { page, limit: LIMIT }
      if (statusFilter)    params.status    = statusFilter
      if (rideTypeFilter)  params.ride_type = rideTypeFilter
      if (debouncedSearch) params.search    = debouncedSearch
      if (cashFlagFilter)  params.cashDiscrepancy = true
      if (cityFilter)      params.cityId    = parseInt(cityFilter, 10)
      if (dateFrom)         params.dateFrom  = dateFrom
      if (dateTo)           params.dateTo    = dateTo
      const data = await adminRideApi.list(params)
      setRides(data.rides)
      setTotal(data.pagination.total)
      setPages(data.pagination.pages)
    } catch {
      setRides([])
    } finally {
      setLoading(false)
    }
  }, [page, statusFilter, rideTypeFilter, debouncedSearch, cashFlagFilter, cityFilter, dateFrom, dateTo])

  useEffect(() => { void fetchRides() }, [fetchRides])

  const columns = [
    {
      key: 'id', header: 'Ride ID',
      render: (r: AdminRideItem) => <span className="font-mono text-xs text-primary">#{r.id}</span>,
    },
    {
      key: 'user', header: 'User',
      render: (r: AdminRideItem) => (
        <div>
          <p className="font-semibold text-text-primary">{r.user_name}</p>
          <p className="text-xs text-text-muted">{r.user_phone}</p>
        </div>
      ),
    },
    {
      key: 'driver', header: 'Driver',
      render: (r: AdminRideItem) => r.driver_name
        ? <div><p className="font-medium text-text-secondary">{r.driver_name}</p><p className="text-xs text-text-muted">{r.driver_phone}</p></div>
        : <span className="text-text-muted italic text-xs">Unassigned</span>,
    },
    {
      key: 'route', header: 'Route',
      render: (r: AdminRideItem) => (
        <div className="space-y-0.5 max-w-[260px]">
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
      render: (r: AdminRideItem) => {
        const icons: Record<string, React.ReactNode> = {
          one_way:    <ArrowRight className="w-3 h-3" />,
          round_trip: <RefreshCw  className="w-3 h-3" />,
          rental:     <Clock      className="w-3 h-3" />,
        }
        return (
          <span className="inline-flex items-center gap-1">
            <StatusPill status={r.ride_type} />
            {icons[r.ride_type] && (
              <span className="text-text-muted">{icons[r.ride_type]}</span>
            )}
          </span>
        )
      },
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
      key: 'requested_at', header: 'Time',
      render: (r: AdminRideItem) => <span className="text-text-muted text-xs">{fmt(r.requested_at)}</span>,
    },
    {
      key: 'actions', header: '',
      render: (r: AdminRideItem) => (
        <button
          onClick={e => { e.stopPropagation(); setSelected(r) }}
          className="px-3 py-1 text-xs font-semibold border border-border rounded-lg hover:bg-surface-2 transition-colors text-text-secondary"
        >
          View
        </button>
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
            <p className="text-xs text-text-muted">{total.toLocaleString('en-IN')} total rides</p>
          </div>
        </div>
      </div>

      {!upcomingLoading && upcoming.length > 0 && (
        <div className="admin-card">
          <h3 className="text-sm font-bold text-text-primary mb-3">
            Upcoming scheduled rides ({upcoming.length})
          </h3>
          <div className="flex flex-col gap-2">
            {upcoming.map(r => (
              <div
                key={r.id}
                className={`flex items-center justify-between gap-3 px-3 py-2 rounded-xl border text-sm ${
                  r.is_stuck ? 'border-red-300 bg-red-50' : 'border-border'
                }`}
              >
                <div className="min-w-0">
                  <p className="font-semibold text-text-primary truncate">
                    {r.user_name} · {r.user_phone}
                  </p>
                  <p className="text-xs text-text-muted truncate">
                    {r.origin_address ?? '—'} → {r.destination_address ?? '—'}
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-xs font-semibold text-text-primary">
                    {new Date(r.scheduled_for).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true })}
                  </p>
                  {r.is_stuck ? (
                    <p className="text-[11px] font-semibold text-red-600">Stuck, sweep may have failed</p>
                  ) : (
                    <p className="text-[11px] text-text-muted">{r.advance_status}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="admin-card">
        <div className="mb-4">
          <FilterBar
            search={search}
            onSearch={setSearch}
            searchPlaceholder="Search by user or driver name/phone…"
            actions={
              <>
                <input
                  type="date" value={dateFrom}
                  onChange={e => { setDateFrom(e.target.value); setPage(1) }}
                  className="px-3 py-2 text-sm bg-surface border border-border rounded-xl text-text-secondary focus:outline-none focus:border-primary"
                />
                <input
                  type="date" value={dateTo}
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
                  { value: 'accepted',    label: 'Accepted'    },
                  { value: 'driver_arrived', label: 'Arrived'  },
                  { value: 'in_progress', label: 'In Progress' },
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
        {loading
          ? <table className="w-full"><tbody><SkeletonRows cols={9} /></tbody></table>
          : (
            <DataTable
              columns={columns as unknown as { key: string; header: string; render?: (row: Record<string, unknown>) => React.ReactNode }[]}
              data={rides as unknown as Record<string, unknown>[]}
              onRowClick={row => setSelected(row as unknown as AdminRideItem)}
              emptyMessage="No rides match your filters"
            />
          )
        }
        {pages > 1 && (
          <div className="flex items-center justify-between mt-4 pt-4 border-t border-border-light">
            <p className="text-xs text-text-muted">{total} total</p>
            <div className="flex gap-2">
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="px-3 py-1 text-xs border border-border rounded-lg disabled:opacity-40 hover:bg-surface-2 transition-colors">Prev</button>
              <span className="px-3 py-1 text-xs text-text-muted">{page} / {pages}</span>
              <button disabled={page >= pages} onClick={() => setPage(p => p + 1)} className="px-3 py-1 text-xs border border-border rounded-lg disabled:opacity-40 hover:bg-surface-2 transition-colors">Next</button>
            </div>
          </div>
        )}
      </div>

      <SlideOver isOpen={!!selected} onClose={() => setSelected(null)} title={selected ? `Ride #${selected.id}` : ''}>
        {selected && (
          <div className="p-6 space-y-5">
            <div className="flex items-center gap-2 flex-wrap">
              <StatusPill status={selected.status} />
              <StatusPill status={selected.ride_type} />
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

            {selected.status === 'in_progress' && (
              <div className={selected.review_flagged_at
                ? 'bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-2'
                : 'bg-surface-2 border border-border-light rounded-xl p-3 space-y-2'}>
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
                <div className="flex gap-2 pt-1">
                  <button
                    disabled={resolving}
                    onClick={() => void handleForceResolve('cancel')}
                    className="px-3 py-1.5 text-xs font-semibold bg-danger text-white rounded-lg disabled:opacity-50 hover:opacity-90 transition-opacity"
                  >
                    Force cancel
                  </button>
                  <button
                    disabled={resolving}
                    onClick={() => void handleForceResolve('complete')}
                    className="px-3 py-1.5 text-xs font-semibold bg-success text-white rounded-lg disabled:opacity-50 hover:opacity-90 transition-opacity"
                  >
                    Force complete
                  </button>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              {[
                { label: 'Rider',  name: selected.user_name,        sub: selected.user_phone },
                { label: 'Driver', name: selected.driver_name ?? 'Unassigned', sub: selected.driver_phone ?? '' },
              ].map(p => (
                <div key={p.label} className="bg-surface-2 rounded-xl p-3 border border-border-light">
                  <p className="text-xs font-semibold text-text-secondary mb-1">{p.label}</p>
                  <p className="font-semibold text-text-primary">{p.name}</p>
                  <p className="text-xs text-text-muted">{p.sub}</p>
                </div>
              ))}
            </div>

            {detail?.vehicle_number_plate && (
              <div className="bg-surface-2 rounded-xl p-3 border border-border-light">
                <p className="text-xs font-semibold text-text-secondary mb-1">Vehicle</p>
                <p className="font-semibold text-text-primary">{detail.vehicle_name ?? '—'} {detail.vehicle_color ? `· ${detail.vehicle_color}` : ''}</p>
                <p className="text-xs text-text-muted font-mono">{detail.vehicle_number_plate}</p>
              </div>
            )}

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

            {detail && [detail.base_fare, detail.distance_fare, detail.time_fare, detail.stop_fare, detail.hour_surcharge, detail.overage_fare, detail.surge_fare, detail.refund_amount].some(v => v && parseFloat(v) > 0) && (
              <div className="bg-surface-2 rounded-xl p-3 border border-border-light space-y-1.5">
                <p className="text-xs font-semibold text-text-secondary mb-2">Fare breakdown</p>
                {(
                  [
                    ['Base', detail.base_fare], ['Distance', detail.distance_fare], ['Time', detail.time_fare],
                    ['Stops', detail.stop_fare], ['Hour surcharge', detail.hour_surcharge],
                    ['Overage', detail.overage_fare],
                    ['Surge', detail.surge_fare, detail.surge_multiplier && parseFloat(detail.surge_multiplier) > 1 ? `×${detail.surge_multiplier}` : ''],
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
              </div>
            )}

            <div className="bg-surface-2 rounded-xl p-3 border border-border-light space-y-1.5">
              <p className="text-xs font-semibold text-text-secondary mb-2">Timeline</p>
              {detail?.status_history.map((ev, i) => (
                <div key={i} className="flex justify-between items-start gap-2">
                  <div>
                    <span className="text-xs font-medium text-text-primary capitalize">{ev.to_status.replace(/_/g, ' ')}</span>
                    <span className="text-xs text-text-muted capitalize"> · {ev.actor}</span>
                    {ev.note && <p className="text-[11px] text-text-muted">{ev.note}</p>}
                  </div>
                  <span className="text-xs text-text-muted whitespace-nowrap">{fmt(ev.created_at)}</span>
                </div>
              ))}
              {(() => {
                const loggedStatuses = new Set((detail?.status_history ?? []).map(ev => ev.to_status))
                return (
                  [
                    { label: 'Requested',       ts: selected.requested_at,       status: 'requested' },
                    { label: 'Accepted',        ts: selected.accepted_at,        status: 'accepted' },
                    { label: 'Driver Arrived',  ts: selected.driver_arrived_at,  status: 'driver_arrived' },
                    { label: 'Trip Started',    ts: selected.started_at,         status: 'in_progress' },
                    { label: 'Completed',       ts: selected.completed_at,       status: 'completed' },
                  ]
                    .filter(({ ts, status }) => ts && !loggedStatuses.has(status))
                    .map(({ label, ts }) => (
                      <div key={label} className="flex justify-between items-center">
                        <span className="text-xs text-text-muted">{label}</span>
                        <span className="text-xs font-medium text-text-primary">{fmt(ts)}</span>
                      </div>
                    ))
                )
              })()}
            </div>

            {detailStops.length > 0 && (
              <div className="bg-surface-2 rounded-xl p-3 border border-border-light space-y-1.5">
                <p className="text-xs font-semibold text-text-secondary mb-2">Stops</p>
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
              </div>
            )}

            {(selected.payment_status || selected.payment_channel) && (
              <div className="bg-surface-2 rounded-xl p-3 border border-border-light">
                <p className="text-xs font-semibold text-text-secondary mb-2">Payment</p>
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
              </div>
            )}

            {selected.status === 'cancelled' && (
              <div className="bg-surface-2 rounded-xl p-3 border border-border-light">
                <p className="text-xs font-semibold text-text-secondary mb-1">Cancellation</p>
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
              </div>
            )}

            {detail && detail.messages.length > 0 && (
              <div className="bg-surface-2 rounded-xl p-3 border border-border-light">
                <p className="text-xs font-semibold text-text-secondary mb-2">Chat</p>
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
              </div>
            )}

            {detail && (detail.disputes.length > 0 || detail.sos_alerts.length > 0 || detail.ratings.length > 0) && (
              <div className="bg-surface-2 rounded-xl p-3 border border-border-light space-y-2">
                <p className="text-xs font-semibold text-text-secondary mb-1">Related</p>
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
                      {r.comment && <p className="text-[11px] text-text-muted max-w-[200px]">{r.comment}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </SlideOver>
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
