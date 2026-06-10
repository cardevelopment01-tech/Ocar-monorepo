'use client'

import { useState, useEffect, useCallback } from 'react'
import { Clock } from 'lucide-react'
import { rideApi, type RideHistoryItem } from '@/lib/ride-api'
import { cn } from '@/lib/utils'

type Tab = 'all' | 'completed' | 'cancelled'

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function RideCard({ ride }: { ride: RideHistoryItem }) {
  const isCompleted = ride.status === 'completed'
  const isCancelled = ride.status === 'cancelled'

  return (
    <div className="card">
      <div className="flex items-start justify-between mb-3">
        <span className={cn(
          'text-xs font-semibold px-2.5 py-1 rounded-full capitalize',
          isCompleted ? 'bg-status-success/10 text-status-success'
            : isCancelled ? 'bg-status-error/10 text-status-error'
            : 'bg-primary/10 text-primary'
        )}>
          {ride.status.replace(/_/g, ' ')}
        </span>
        <div className="text-right">
          {ride.fare && <p className="font-bold text-text-primary">₹{parseFloat(ride.fare).toLocaleString('en-IN')}</p>}
          <p className="text-xs text-text-muted">{fmt(ride.requested_at)}</p>
        </div>
      </div>

      <div className="space-y-2 mb-3">
        <div className="flex items-start gap-2">
          <div className="mt-1.5 w-2 h-2 rounded-full bg-primary flex-shrink-0" />
          <p className="text-sm text-text-primary line-clamp-1">{ride.origin_address ?? '—'}</p>
        </div>
        <div className="ml-[3px] w-px h-3 bg-border" />
        <div className="flex items-start gap-2">
          <div className="mt-1.5 w-2 h-2 rounded-full bg-text-primary flex-shrink-0" />
          <p className="text-sm text-text-primary line-clamp-1">{ride.destination_address ?? '—'}</p>
        </div>
      </div>

      {ride.driver_name && (
        <div className="pt-2 border-t border-border">
          <p className="text-xs text-text-muted">Driver: <span className="text-text-secondary">{ride.driver_name}</span></p>
        </div>
      )}
    </div>
  )
}

const LIMIT = 20

export default function HistoryPage() {
  const [tab, setTab] = useState<Tab>('all')
  const [rides, setRides] = useState<RideHistoryItem[]>([])
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const fetchHistory = useCallback(async (p: number) => {
    setLoading(true)
    setError(false)
    try {
      const data = await rideApi.getHistory(p, LIMIT)
      setRides(data.rides)
      setPage(data.pagination.page)
      setPages(data.pagination.pages)
      setTotal(data.pagination.total)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void fetchHistory(1) }, [fetchHistory])

  const filtered = tab === 'all'
    ? rides
    : rides.filter(r => r.status === tab)

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <div className="bg-surface px-4 pt-safe-top pb-0 shadow-card sticky top-0 z-10">
        <div className="flex items-center justify-between pt-5 pb-1">
          <h1 className="text-xl font-bold text-text-primary">Ride History</h1>
          {!loading && <p className="text-xs text-text-muted">{total} rides</p>}
        </div>

        {/* Tabs */}
        <div className="flex gap-1">
          {(['all', 'completed', 'cancelled'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                'px-4 py-2.5 text-sm font-medium capitalize border-b-2 transition-colors',
                tab === t
                  ? 'border-primary text-primary'
                  : 'border-transparent text-text-muted'
              )}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div className="px-4 pt-4 space-y-3">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card animate-pulse">
              <div className="flex justify-between mb-3">
                <div className="h-5 w-20 bg-surface-2 rounded-full" />
                <div className="h-5 w-16 bg-surface-2 rounded" />
              </div>
              <div className="space-y-2 mb-2">
                <div className="h-4 bg-surface-2 rounded w-3/4" />
                <div className="h-4 bg-surface-2 rounded w-2/3" />
              </div>
            </div>
          ))
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-20 text-text-muted">
            <p className="text-sm mb-3">Failed to load history</p>
            <button onClick={() => void fetchHistory(1)} className="text-primary text-sm font-semibold">Retry</button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-text-muted">
            <Clock size={40} className="mb-3 opacity-30" />
            <p className="text-sm">No rides found</p>
          </div>
        ) : (
          <>
            {filtered.map(ride => <RideCard key={ride.id} ride={ride} />)}

            {pages > 1 && (
              <div className="flex items-center justify-between pt-2 pb-4">
                <button
                  disabled={page <= 1}
                  onClick={() => void fetchHistory(page - 1)}
                  className="px-4 py-2 text-sm font-semibold text-primary disabled:opacity-40"
                >
                  ← Previous
                </button>
                <span className="text-xs text-text-muted">{page} / {pages}</span>
                <button
                  disabled={page >= pages}
                  onClick={() => void fetchHistory(page + 1)}
                  className="px-4 py-2 text-sm font-semibold text-primary disabled:opacity-40"
                >
                  Next →
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
