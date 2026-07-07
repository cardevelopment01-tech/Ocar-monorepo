'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { Clock, MapPin, CheckCircle2, XCircle } from 'lucide-react'
import { rideApi, type RideHistoryItem, type UpcomingRide } from '@/lib/ride-api'
import { cn } from '@/lib/utils'

const EASE   = [0.22, 1, 0.36, 1] as const
const SPRING = { type: 'spring', stiffness: 340, damping: 30 } as const

const fadeUp = {
  hidden: { opacity: 0, y: 10 },
  show:   { opacity: 1, y: 0, transition: { duration: 0.3, ease: EASE } },
}
const listStagger = {
  hidden: {},
  show:   { transition: { staggerChildren: 0.06 } },
}
const cardVariant = {
  hidden: { opacity: 0, y: 14 },
  show:   { opacity: 1, y: 0, transition: { duration: 0.3, ease: EASE } },
}

type Tab = 'upcoming' | 'all' | 'completed' | 'cancelled'

const TABS: { id: Tab; label: string }[] = [
  { id: 'upcoming',  label: 'Upcoming'  },
  { id: 'all',       label: 'All'       },
  { id: 'completed', label: 'Completed' },
  { id: 'cancelled', label: 'Cancelled' },
]

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function StatusBadge({ status }: { status: string }) {
  const isCompleted = status === 'completed'
  const isCancelled = status === 'cancelled'
  return (
    <span className={cn(
      'inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full capitalize',
      isCompleted ? 'bg-status-success/10 text-status-success'
        : isCancelled ? 'bg-status-error/10 text-status-error'
        : 'bg-primary/10 text-primary'
    )}>
      {isCompleted && <CheckCircle2 size={10} strokeWidth={2.5} />}
      {isCancelled && <XCircle size={10} strokeWidth={2.5} />}
      {status.replace(/_/g, ' ')}
    </span>
  )
}

function RideCard({ ride }: { ride: RideHistoryItem }) {
  return (
    <motion.div
      variants={cardVariant}
      className="bg-surface rounded-2xl border border-border p-4 shadow-card"
    >
      <div className="flex items-start justify-between mb-3">
        <StatusBadge status={ride.status} />
        <div className="text-right">
          {ride.fare && (
            <p className="text-sm font-bold text-text-primary">
              ₹{parseFloat(ride.fare).toLocaleString('en-IN')}
            </p>
          )}
          <p className="text-[11px] text-text-muted mt-0.5">{fmt(ride.requested_at)}</p>
        </div>
      </div>

      {/* Route */}
      <div className="flex gap-3 mb-3">
        <div className="flex flex-col items-center gap-0.5 flex-shrink-0 pt-1.5">
          <span className="w-2 h-2 rounded-full bg-primary" />
          <span className="w-px flex-1 bg-border min-h-[20px]" />
          <span className="w-2 h-2 rounded-full bg-text-primary" />
        </div>
        <div className="flex-1 min-w-0 flex flex-col justify-between gap-2">
          <p className="text-sm font-medium text-text-primary line-clamp-1">{ride.origin_address ?? '—'}</p>
          <p className="text-sm font-medium text-text-secondary line-clamp-1">{ride.destination_address ?? '—'}</p>
        </div>
      </div>

      {ride.driver_name && (
        <div className="flex items-center gap-2 pt-3 border-t border-border">
          <MapPin size={12} className="text-text-muted flex-shrink-0" strokeWidth={1.8} />
          <p className="text-xs text-text-muted">
            Driver: <span className="font-medium text-text-secondary">{ride.driver_name}</span>
          </p>
        </div>
      )}
    </motion.div>
  )
}

function UpcomingCard({
  ride, onOpen, onCancel, cancelling,
}: {
  ride: UpcomingRide
  onOpen: () => void
  onCancel: () => void
  cancelling: boolean
}) {
  return (
    <motion.div
      variants={cardVariant}
      className="bg-surface rounded-2xl border border-border p-4 shadow-card"
    >
      <div className="flex items-start justify-between mb-3">
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-indigo-50 text-indigo-700">
          <Clock size={11} strokeWidth={2} /> Scheduled
        </span>
        <div className="text-right">
          {ride.fare && (
            <p className="text-sm font-bold text-text-primary">
              ₹{parseFloat(ride.fare).toLocaleString('en-IN')}
            </p>
          )}
          <p className="text-[11px] text-text-muted mt-0.5">{fmt(ride.scheduled_for)}</p>
        </div>
      </div>

      <button type="button" onClick={onOpen} className="flex gap-3 mb-3 w-full text-left">
        <div className="flex flex-col items-center gap-0.5 flex-shrink-0 pt-1.5">
          <span className="w-2 h-2 rounded-full bg-primary" />
          <span className="w-px flex-1 bg-border min-h-[20px]" />
          <span className="w-2 h-2 rounded-full bg-text-primary" />
        </div>
        <div className="flex-1 min-w-0 flex flex-col justify-between gap-2">
          <p className="text-sm font-medium text-text-primary line-clamp-1">{ride.origin_address ?? '—'}</p>
          <p className="text-sm font-medium text-text-secondary line-clamp-1">{ride.destination_address ?? '—'}</p>
        </div>
      </button>

      <button
        type="button"
        onClick={onCancel}
        disabled={cancelling}
        className="w-full pt-3 border-t border-border text-xs font-semibold text-red-600 disabled:opacity-50"
      >
        {cancelling ? 'Cancelling…' : 'Cancel ride'}
      </button>
    </motion.div>
  )
}

function SkeletonCard() {
  return (
    <div className="bg-surface rounded-2xl border border-border p-4 animate-pulse">
      <div className="flex justify-between mb-3">
        <div className="h-5 w-24 bg-surface-2 rounded-full" />
        <div className="h-5 w-16 bg-surface-2 rounded" />
      </div>
      <div className="space-y-2 mb-2">
        <div className="h-4 bg-surface-2 rounded w-4/5" />
        <div className="h-4 bg-surface-2 rounded w-2/3" />
      </div>
    </div>
  )
}

const LIMIT = 20

export default function HistoryPage() {
  const router = useRouter()
  const [tab,     setTab]     = useState<Tab>('upcoming')
  const [rides,   setRides]   = useState<RideHistoryItem[]>([])
  const [page,    setPage]    = useState(1)
  const [pages,   setPages]   = useState(1)
  const [total,   setTotal]   = useState(0)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(false)

  const [upcoming,        setUpcoming]        = useState<UpcomingRide[]>([])
  const [upcomingLoading, setUpcomingLoading] = useState(true)
  const [upcomingError,   setUpcomingError]   = useState(false)
  const [cancellingId,    setCancellingId]    = useState<string | null>(null)

  const fetchHistory = useCallback(async (p: number) => {
    setLoading(true); setError(false)
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

  const fetchUpcoming = useCallback(async () => {
    setUpcomingLoading(true); setUpcomingError(false)
    try {
      setUpcoming(await rideApi.getUpcoming())
    } catch {
      setUpcomingError(true)
    } finally {
      setUpcomingLoading(false)
    }
  }, [])

  useEffect(() => { void fetchHistory(1) }, [fetchHistory])
  useEffect(() => { void fetchUpcoming() }, [fetchUpcoming])

  async function handleCancelUpcoming(rideId: string) {
    setCancellingId(rideId)
    try {
      await rideApi.cancelRide(rideId)
      setUpcoming(prev => prev.filter(r => r.id !== rideId))
    } catch {
      setUpcomingError(true)
    } finally {
      setCancellingId(null)
    }
  }

  const filtered = tab === 'all' ? rides : rides.filter(r => r.status === tab)

  return (
    <div className="h-full flex flex-col bg-background">

      {/* ── Sticky header ── */}
      <div className="flex-shrink-0 bg-surface border-b border-border pt-safe-top">
        <div className="flex items-center justify-between px-5 pt-4 pb-3">
          <h1 className="text-lg font-bold text-text-primary">My Rides</h1>
          {tab !== 'upcoming' && !loading && total > 0 && (
            <span className="text-[11px] font-semibold text-text-muted bg-surface-2 px-2.5 py-1 rounded-full">
              {total} total
            </span>
          )}
        </div>

        {/* Tab pills */}
        <div className="flex gap-2 px-5 pb-3">
          {TABS.map(t => (
            <motion.button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors',
                tab === t.id
                  ? 'bg-primary text-white'
                  : 'bg-surface-2 text-text-muted'
              )}
              whileTap={{ scale: 0.94 }}
              transition={SPRING}
            >
              {t.label}
            </motion.button>
          ))}
        </div>
      </div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-y-auto scrollbar-none px-4 pt-4 pb-28">
        <AnimatePresence mode="wait">
          {tab === 'upcoming' ? (
            upcomingLoading ? (
              <motion.div
                key="upcoming-skeleton"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-col gap-3"
              >
                {Array.from({ length: 2 }).map((_, i) => <SkeletonCard key={i} />)}
              </motion.div>
            ) : upcomingError ? (
              <motion.div
                key="upcoming-error"
                variants={fadeUp} initial="hidden" animate="show"
                className="flex flex-col items-center justify-center py-20 gap-3"
              >
                <p className="text-sm text-text-muted">Failed to load upcoming rides</p>
                <button
                  onClick={() => void fetchUpcoming()}
                  className="text-primary text-sm font-semibold"
                >
                  Retry
                </button>
              </motion.div>
            ) : upcoming.length === 0 ? (
              <motion.div
                key="upcoming-empty"
                variants={fadeUp} initial="hidden" animate="show"
                className="flex flex-col items-center justify-center py-20 gap-3"
              >
                <Clock size={36} className="text-text-muted opacity-30" />
                <p className="text-sm text-text-muted">No scheduled rides</p>
              </motion.div>
            ) : (
              <motion.div
                key="upcoming-list"
                className="flex flex-col gap-3"
                variants={listStagger}
                initial="hidden"
                animate="show"
              >
                {upcoming.map(ride => (
                  <UpcomingCard
                    key={ride.id}
                    ride={ride}
                    onOpen={() => router.push(`/ride/${ride.id}`)}
                    onCancel={() => void handleCancelUpcoming(ride.id)}
                    cancelling={cancellingId === ride.id}
                  />
                ))}
              </motion.div>
            )
          ) : loading ? (
            <motion.div
              key="skeleton"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col gap-3"
            >
              {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
            </motion.div>
          ) : error ? (
            <motion.div
              key="error"
              variants={fadeUp} initial="hidden" animate="show"
              className="flex flex-col items-center justify-center py-20 gap-3"
            >
              <p className="text-sm text-text-muted">Failed to load rides</p>
              <button
                onClick={() => void fetchHistory(1)}
                className="text-primary text-sm font-semibold"
              >
                Retry
              </button>
            </motion.div>
          ) : filtered.length === 0 ? (
            <motion.div
              key="empty"
              variants={fadeUp} initial="hidden" animate="show"
              className="flex flex-col items-center justify-center py-20 gap-3"
            >
              <Clock size={36} className="text-text-muted opacity-30" />
              <p className="text-sm text-text-muted">No rides here yet</p>
            </motion.div>
          ) : (
            <motion.div
              key={`list-${tab}`}
              className="flex flex-col gap-3"
              variants={listStagger}
              initial="hidden"
              animate="show"
            >
              {filtered.map(ride => <RideCard key={ride.id} ride={ride} />)}

              {pages > 1 && (
                <div className="flex items-center justify-between pt-2 pb-4">
                  <motion.button
                    disabled={page <= 1}
                    onClick={() => void fetchHistory(page - 1)}
                    className="px-4 py-2 text-sm font-semibold text-primary disabled:opacity-30"
                    whileTap={{ scale: 0.95 }}
                  >
                    ← Prev
                  </motion.button>
                  <span className="text-xs text-text-muted">{page} / {pages}</span>
                  <motion.button
                    disabled={page >= pages}
                    onClick={() => void fetchHistory(page + 1)}
                    className="px-4 py-2 text-sm font-semibold text-primary disabled:opacity-30"
                    whileTap={{ scale: 0.95 }}
                  >
                    Next →
                  </motion.button>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
