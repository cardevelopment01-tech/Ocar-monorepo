'use client'
import React from 'react'
import { useState, useEffect, useRef, useCallback } from 'react'
import { Car } from 'lucide-react'
import StatusPill from '@/components/ui/StatusPill'
import DataTable from '@/components/ui/DataTable'
import FilterBar from '@/components/ui/FilterBar'
import SlideOver from '@/components/ui/SlideOver'
import { adminRideApi, type AdminRideItem } from '@/lib/admin-api'

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

export default function RidesPage() {
  const [rides, setRides] = useState<AdminRideItem[]>([])
  const [total, setTotal] = useState(0)
  const [pages, setPages] = useState(1)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [debouncedSearch, setDebouncedSearch] = useState('')

  const [selected, setSelected] = useState<AdminRideItem | null>(null)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => { setDebouncedSearch(search); setPage(1) }, 400)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [search])

  const fetchRides = useCallback(async () => {
    setLoading(true)
    try {
      const params: Record<string, unknown> = { page, limit: LIMIT }
      if (statusFilter) params['status'] = statusFilter
      if (debouncedSearch) params['search'] = debouncedSearch
      const data = await adminRideApi.list(params as Parameters<typeof adminRideApi.list>[0])
      setRides(data.rides)
      setTotal(data.pagination.total)
      setPages(data.pagination.pages)
    } catch {
      setRides([])
    } finally {
      setLoading(false)
    }
  }, [page, statusFilter, debouncedSearch])

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
        <p className="text-text-secondary text-sm">
          {r.origin_address ?? '—'}<span className="text-text-muted mx-1">→</span>{r.destination_address ?? '—'}
        </p>
      ),
    },
    { key: 'ride_type', header: 'Type',   render: (r: AdminRideItem) => <StatusPill status={r.ride_type} /> },
    {
      key: 'fare', header: 'Fare',
      render: (r: AdminRideItem) => r.fare
        ? <span className="font-bold text-text-primary">₹{parseFloat(r.fare).toLocaleString('en-IN')}</span>
        : <span className="text-text-muted">—</span>,
    },
    { key: 'status', header: 'Status', render: (r: AdminRideItem) => <StatusPill status={r.status} /> },
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
      <div className="flex items-center gap-3 mb-1">
        <Car className="w-5 h-5 text-primary" />
        <div>
          <h2 className="text-lg font-bold text-text-primary">Rides</h2>
          <p className="text-xs text-text-muted">{total} total rides</p>
        </div>
      </div>

      <div className="admin-card">
        <div className="mb-4">
          <FilterBar
            search={search}
            onSearch={setSearch}
            searchPlaceholder="Search by user name or phone…"
            filters={[{
              key: 'status', label: 'All Statuses',
              options: [
                { value: 'requested',   label: 'Requested'   },
                { value: 'accepted',    label: 'Accepted'    },
                { value: 'arrived',     label: 'Arrived'     },
                { value: 'in_progress', label: 'In Progress' },
                { value: 'completed',   label: 'Completed'   },
                { value: 'cancelled',   label: 'Cancelled'   },
              ],
              value: statusFilter,
              onChange: (v) => { setStatusFilter(v); setPage(1) },
            }]}
            onExport={() => {}}
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
            <div className="flex items-center gap-3">
              <StatusPill status={selected.status} />
              <StatusPill status={selected.ride_type} />
              <span className="text-text-muted text-sm">{fmt(selected.requested_at)}</span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {[
                { label: 'Rider',  name: selected.user_name,        sub: selected.user_phone },
                { label: 'Driver', name: selected.driver_name ?? 'Unassigned', sub: selected.driver_phone ?? '' },
              ].map(p => (
                <div key={p.label} className="bg-surface-2 rounded-xl p-3 border border-border-light">
                  <p className="text-xs text-text-muted uppercase tracking-wide mb-1">{p.label}</p>
                  <p className="font-semibold text-text-primary">{p.name}</p>
                  <p className="text-xs text-text-muted">{p.sub}</p>
                </div>
              ))}
            </div>

            <div className="bg-surface-2 rounded-xl p-3 border border-border-light">
              <p className="text-xs text-text-muted uppercase tracking-wide mb-1">Route</p>
              <p className="text-sm font-medium text-text-primary">{selected.origin_address ?? '—'}</p>
              <p className="text-xs text-text-muted my-1">→</p>
              <p className="text-sm font-medium text-text-primary">{selected.destination_address ?? '—'}</p>
              {selected.fare && (
                <p className="text-xl font-bold text-text-primary mt-2">₹{parseFloat(selected.fare).toLocaleString('en-IN')}</p>
              )}
            </div>

            {selected.completed_at && (
              <div className="bg-surface-2 rounded-xl p-3 border border-border-light">
                <p className="text-xs text-text-muted uppercase tracking-wide mb-1">Completed At</p>
                <p className="text-sm font-medium text-text-primary">{fmt(selected.completed_at)}</p>
              </div>
            )}
          </div>
        )}
      </SlideOver>
    </div>
  )
}
