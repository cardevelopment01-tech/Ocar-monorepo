'use client'

import { Suspense, useState, useEffect, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { Clock, MapPin, CheckCircle2, XCircle, ChevronRight, ChevronLeft, CalendarClock, Inbox, Plus, X } from 'lucide-react'
import { rideApi, type RideDetail, type RideHistoryItem, type UpcomingRide } from '@/lib/ride-api'
import { cn } from '@/lib/utils'
import { formatPickupTime } from '@/lib/format-pickup-time'
import OcarSpinner from '@/components/ui/OcarSpinner'

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

const STATUS_KIND: Record<string, 'success' | 'error' | 'info' | 'warning'> = {
  completed:      'success',
  cancelled:      'error',
  no_drivers:     'error',
  scheduled:      'info',
  requested:      'warning',
  accepted:       'warning',
  driver_arrived: 'warning',
  in_progress:    'warning',
}

function StatusBadge({ status }: { status: string }) {
  const kind = STATUS_KIND[status] ?? 'warning'
  return (
    <span className={cn(
      'inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full capitalize',
      kind === 'success' && 'bg-status-success/10 text-status-success',
      kind === 'error'   && 'bg-status-error/10 text-status-error',
      kind === 'info'    && 'bg-status-info/10 text-status-info',
      kind === 'warning' && 'bg-status-warning/10 text-status-warning',
    )}>
      {kind === 'success' && <CheckCircle2 size={10} strokeWidth={2.5} />}
      {kind === 'error'   && <XCircle size={10} strokeWidth={2.5} />}
      {kind === 'info'    && <Clock size={10} strokeWidth={2.5} />}
      {kind === 'warning' && <span className="w-1.5 h-1.5 rounded-full bg-status-warning" />}
      {status.replace(/_/g, ' ')}
    </span>
  )
}

function RideCard({ ride, onOpen }: { ride: RideHistoryItem; onOpen: () => void }) {
  return (
    <motion.button
      type="button"
      onClick={onOpen}
      variants={cardVariant}
      whileTap={{ scale: 0.98 }}
      transition={SPRING}
      className="w-full text-left bg-surface rounded-2xl border border-border p-4 shadow-card"
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
      <div className="flex gap-3 items-center mb-3">
        <div className="flex flex-col items-center gap-0.5 flex-shrink-0 self-stretch pt-1.5">
          <span className="w-2 h-2 rounded-full bg-primary" />
          <span className="w-px flex-1 bg-border min-h-[20px]" />
          <span className="w-2 h-2 rounded-full bg-text-primary" />
        </div>
        <div className="flex-1 min-w-0 flex flex-col justify-between gap-2">
          <p className="text-sm font-medium text-text-primary line-clamp-1">{ride.origin_address ?? '—'}</p>
          <p className="text-sm font-medium text-text-secondary line-clamp-1">{ride.destination_address ?? '—'}</p>
        </div>
        <ChevronRight size={16} className="text-text-muted flex-shrink-0" />
      </div>

      {ride.driver_name && (
        <div className="flex items-center gap-2 pt-3 border-t border-border">
          <MapPin size={12} className="text-text-muted flex-shrink-0" strokeWidth={1.8} />
          <p className="text-xs text-text-muted">
            Driver: <span className="font-medium text-text-secondary">{ride.driver_name}</span>
          </p>
        </div>
      )}
    </motion.button>
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
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-status-info/10 text-status-info">
          <CalendarClock size={11} strokeWidth={2} /> Scheduled
        </span>
        <div className="text-right">
          {ride.fare && (
            <p className="text-sm font-bold text-text-primary">
              ₹{parseFloat(ride.fare).toLocaleString('en-IN')}
            </p>
          )}
          <p className="text-[11px] text-text-muted mt-0.5">{formatPickupTime(new Date(ride.scheduled_for))}</p>
        </div>
      </div>

      <motion.button
        type="button"
        onClick={onOpen}
        whileTap={{ scale: 0.98 }}
        transition={SPRING}
        className="flex gap-3 items-center mb-3 w-full text-left"
      >
        <div className="flex flex-col items-center gap-0.5 flex-shrink-0 self-stretch pt-1.5">
          <span className="w-2 h-2 rounded-full bg-primary" />
          <span className="w-px flex-1 bg-border min-h-[20px]" />
          <span className="w-2 h-2 rounded-full bg-text-primary" />
        </div>
        <div className="flex-1 min-w-0 flex flex-col justify-between gap-2">
          <p className="text-sm font-medium text-text-primary line-clamp-1">{ride.origin_address ?? '—'}</p>
          <p className="text-sm font-medium text-text-secondary line-clamp-1">{ride.destination_address ?? '—'}</p>
        </div>
        <ChevronRight size={16} className="text-text-muted flex-shrink-0" />
      </motion.button>

      <button
        type="button"
        onClick={onCancel}
        disabled={cancelling}
        className="w-full pt-3 border-t border-border text-xs font-semibold text-status-error disabled:opacity-50"
      >
        {cancelling ? 'Cancelling…' : 'Cancel ride'}
      </button>
    </motion.div>
  )
}

const ACTIVE_STATUS_LABEL: Record<string, string> = {
  requested:      'Finding driver',
  accepted:       'Driver on the way',
  driver_arrived: 'Driver has arrived',
  in_progress:    'Trip in progress',
}

function ActiveRideCard({ ride, onOpen }: { ride: RideDetail; onOpen: () => void }) {
  return (
    <motion.button
      type="button"
      onClick={onOpen}
      variants={cardVariant}
      whileTap={{ scale: 0.98 }}
      transition={SPRING}
      className="w-full text-left bg-primary/[0.04] rounded-2xl border border-primary/20 p-4 shadow-float"
    >
      <div className="flex items-center justify-between mb-3">
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-primary text-white">
          <span className="relative flex w-2 h-2">
            <span className="absolute inset-0 rounded-full bg-white animate-ping opacity-70" />
            <span className="relative w-2 h-2 rounded-full bg-white" />
          </span>
          Live · {ACTIVE_STATUS_LABEL[ride.status] ?? 'Active'}
        </span>
        {ride.total_estimated && (
          <p className="text-sm font-bold text-text-primary">
            ₹{Math.round(parseFloat(ride.total_estimated)).toLocaleString('en-IN')}
          </p>
        )}
      </div>

      <div className="flex gap-3 items-center mb-3">
        <div className="flex flex-col items-center gap-0.5 flex-shrink-0 self-stretch pt-1.5">
          <span className="w-2 h-2 rounded-full bg-primary" />
          <span className="w-px flex-1 bg-primary/20 min-h-[20px]" />
          <span className="w-2 h-2 rounded-full bg-text-primary" />
        </div>
        <div className="flex-1 min-w-0 flex flex-col justify-between gap-2">
          <p className="text-sm font-medium text-text-primary line-clamp-1">{ride.origin_address ?? '—'}</p>
          <p className="text-sm font-medium text-text-secondary line-clamp-1">{ride.destination_address ?? '—'}</p>
        </div>
        <ChevronRight size={16} className="text-primary flex-shrink-0" />
      </div>

      {ride.driver_name && (
        <div className="flex items-center gap-2 pt-3 border-t border-primary/10">
          <MapPin size={12} className="text-text-muted flex-shrink-0" strokeWidth={1.8} />
          <p className="text-xs text-text-muted">
            Driver: <span className="font-medium text-text-secondary">{ride.driver_name}</span>
          </p>
        </div>
      )}
    </motion.button>
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

function EmptyState({
  icon: Icon, title, subtitle, cta,
}: {
  icon: React.ElementType
  title: string
  subtitle: string
  cta?: { label: string; onClick: () => void }
}) {
  return (
    <motion.div
      variants={fadeUp} initial="hidden" animate="show"
      className="flex flex-col items-center justify-center py-20 gap-3 text-center px-6"
    >
      <div className="w-14 h-14 rounded-2xl bg-surface-2 flex items-center justify-center">
        <Icon size={22} className="text-text-muted" strokeWidth={1.6} />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-semibold text-text-primary">{title}</p>
        <p className="text-xs text-text-muted max-w-[220px]">{subtitle}</p>
      </div>
      {cta && (
        <motion.button
          type="button"
          onClick={cta.onClick}
          whileTap={{ scale: 0.96 }}
          transition={SPRING}
          className="mt-2 inline-flex items-center gap-1.5 bg-primary text-white text-sm font-semibold px-5 py-2.5 rounded-full shadow-button"
        >
          <Plus size={15} strokeWidth={2.5} />
          {cta.label}
        </motion.button>
      )}
    </motion.div>
  )
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <motion.div
      variants={fadeUp} initial="hidden" animate="show"
      className="flex flex-col items-center justify-center py-20 gap-3 text-center px-6"
    >
      <div className="w-14 h-14 rounded-2xl bg-status-error/10 flex items-center justify-center">
        <XCircle size={22} className="text-status-error" strokeWidth={1.6} />
      </div>
      <p className="text-sm font-semibold text-text-primary">{message}</p>
      <motion.button
        type="button"
        onClick={onRetry}
        whileTap={{ scale: 0.96 }}
        transition={SPRING}
        className="mt-1 inline-flex items-center px-5 py-2.5 rounded-full text-sm font-semibold text-primary bg-surface-2"
      >
        Retry
      </motion.button>
    </motion.div>
  )
}

const LIMIT = 20

function HistoryContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [showScheduledBanner, setShowScheduledBanner] = useState(() => searchParams.get('scheduled') === '1')
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

  const [activeRide, setActiveRide] = useState<RideDetail | null>(null)

  const fetchActive = useCallback(async () => {
    try {
      const res = await rideApi.getActiveRide()
      setActiveRide(res?.rideId ? await rideApi.getRide(res.rideId) : null)
    } catch {
      setActiveRide(null)
    }
  }, [])

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
  useEffect(() => { void fetchActive() }, [fetchActive])

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
          <h1 className="text-xl font-bold text-text-primary tracking-tight">My Rides</h1>
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
        <AnimatePresence>
          {showScheduledBanner && (
            <motion.div
              initial={{ opacity: 0, y: -8, height: 0 }}
              animate={{ opacity: 1, y: 0, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mb-3 overflow-hidden"
            >
              <div
                className="flex items-start gap-3 px-4 py-3 rounded-2xl"
                style={{ background: 'rgba(10, 159, 176,0.08)', border: '1px solid rgba(10, 159, 176,0.20)' }}
              >
                <CheckCircle2 size={16} className="text-indigo-600 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-bold text-indigo-900">Ride scheduled</p>
                  <p className="text-[12px] text-indigo-700 mt-0.5">
                    We&apos;ll match you with a driver closer to pickup time and notify you here.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowScheduledBanner(false)}
                  aria-label="Dismiss"
                  className="w-6 h-6 flex-shrink-0 flex items-center justify-center rounded-full"
                >
                  <X size={13} className="text-indigo-400" />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        {tab === 'upcoming' && activeRide && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-3"
          >
            <ActiveRideCard ride={activeRide} onOpen={() => router.push(`/ride/${activeRide.id}`)} />
          </motion.div>
        )}
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
              <ErrorState key="upcoming-error" message="Failed to load upcoming rides" onRetry={() => void fetchUpcoming()} />
            ) : upcoming.length === 0 ? (
              <EmptyState
                key="upcoming-empty"
                icon={CalendarClock}
                title="No scheduled rides"
                subtitle="Schedule now and we'll find your driver closer to pickup. No need to book last-minute."
                cta={{ label: 'Book a ride', onClick: () => router.push('/home') }}
              />
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
            <ErrorState key="error" message="Failed to load rides" onRetry={() => void fetchHistory(1)} />
          ) : filtered.length === 0 ? (
            <EmptyState
              key="empty"
              icon={Inbox}
              title={tab === 'all' ? 'No rides yet' : `No ${tab} rides`}
              subtitle={tab === 'all' ? 'Your ride history will show up here once you take your first trip.' : `Rides that get ${tab} will show up here.`}
              cta={tab === 'all' ? { label: 'Book a ride', onClick: () => router.push('/home') } : undefined}
            />
          ) : (
            <motion.div
              key={`list-${tab}`}
              className="flex flex-col gap-3"
              variants={listStagger}
              initial="hidden"
              animate="show"
            >
              {filtered.map(ride => {
                const isTerminal = ride.status === 'completed' || ride.status === 'cancelled' || ride.status === 'no_drivers'
                return (
                  <RideCard
                    key={ride.id}
                    ride={ride}
                    onOpen={() => router.push(isTerminal ? `/ride/${ride.id}/receipt` : `/ride/${ride.id}`)}
                  />
                )
              })}

              {pages > 1 && (
                <div className="flex items-center justify-between pt-2 pb-4">
                  <motion.button
                    disabled={page <= 1}
                    onClick={() => void fetchHistory(page - 1)}
                    className="inline-flex items-center gap-1 pl-2.5 pr-4 py-2 rounded-full text-sm font-semibold text-primary bg-surface-2 disabled:opacity-30"
                    whileTap={{ scale: 0.95 }}
                  >
                    <ChevronLeft size={16} strokeWidth={2.5} /> Prev
                  </motion.button>
                  <span className="text-xs text-text-muted">{page} / {pages}</span>
                  <motion.button
                    disabled={page >= pages}
                    onClick={() => void fetchHistory(page + 1)}
                    className="inline-flex items-center gap-1 pl-4 pr-2.5 py-2 rounded-full text-sm font-semibold text-primary bg-surface-2 disabled:opacity-30"
                    whileTap={{ scale: 0.95 }}
                  >
                    Next <ChevronRight size={16} strokeWidth={2.5} />
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

export default function HistoryPage() {
  return (
    <Suspense fallback={
      <div className="h-full flex items-center justify-center bg-background">
        <OcarSpinner size={32} variant="mono" />
      </div>
    }>
      <HistoryContent />
    </Suspense>
  )
}
