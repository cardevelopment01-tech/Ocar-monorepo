'use client'

import { Suspense, useState, useEffect, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { Clock, MapPin, CheckCircle2, XCircle, ChevronRight, ChevronLeft, CalendarClock, Inbox, Plus, X } from 'lucide-react'
import axios from 'axios'
import { rideApi, type RideDetail, type RideHistoryItem, type UpcomingRide } from '@/lib/ride-api'
import { cn } from '@/lib/utils'
import { formatPickupTime } from '@/lib/format-pickup-time'
import OcarSpinner from '@/components/ui/OcarSpinner'
import SchedulePickerSheet from '@/components/ui/SchedulePickerSheet'
import { MIN_ADVANCE_MINUTES, MAX_ADVANCE_DAYS } from '@/lib/advance-booking-limits'
import { cancelCopy, rescheduleErrorMessage, termsLines, upcomingStatusLine, FALLBACK_TERMS, type AdvanceTerms, type CancelPreview } from '@/lib/advance-model'
import { DriverAvatar, driverViewFromName } from '@/components/ride/DriverIdentity'

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
      whileTap={{ scale: 0.97 }}
      transition={SPRING}
      className="card w-full text-left"
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
          <DriverAvatar view={driverViewFromName(ride.driver_name)} photo={null} size="sm" />
          <p className="text-xs text-text-muted">
            Driver: <span className="font-medium text-text-secondary">{ride.driver_name}</span>
          </p>
        </div>
      )}
    </motion.button>
  )
}

function UpcomingCard({
  ride, terms, onOpen, onAskCancel, onKeep, onConfirmCancel, onChangeTime, confirm, notice, cancelling,
}: {
  ride: UpcomingRide
  terms: AdvanceTerms
  onOpen: () => void
  onAskCancel: () => void
  onKeep: () => void
  onConfirmCancel: () => void
  onChangeTime: () => void
  /** Set while the rider is deciding: what cancelling costs (null = still checking). */
  confirm: CancelPreview | 'checking' | 'unknown' | null
  notice: string | null
  cancelling: boolean
}) {
  const copy = confirm && confirm !== 'checking' && confirm !== 'unknown' ? cancelCopy(confirm) : null
  return (
    <motion.div
      variants={cardVariant}
      className="card"
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
        whileTap={{ scale: 0.97 }}
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

      <p className="text-xs text-text-secondary mb-3">{upcomingStatusLine(ride.scheduled_for, terms)}</p>

      {notice && <p role="alert" className="text-xs font-semibold text-status-error mb-3">{notice}</p>}

      {confirm === null ? (
        <div className="flex border-t border-border">
          <button type="button" onClick={onChangeTime} disabled={cancelling}
            className="flex-1 min-h-[44px] pt-3 text-xs font-semibold text-primary disabled:opacity-50">Change time</button>
          <button type="button" onClick={onAskCancel} disabled={cancelling}
            className="flex-1 min-h-[44px] pt-3 text-xs font-semibold text-status-error disabled:opacity-50">
            {cancelling ? 'Cancelling…' : 'Cancel ride'}
          </button>
        </div>
      ) : (
        // The fee is stated before the rider confirms, in the card itself (no modal for a yes/no).
        <div className="pt-3 border-t border-border" role="group" aria-label="Confirm cancellation">
          <p className="text-sm font-semibold text-text-primary">
            {confirm === 'checking' ? 'Checking the cost of cancelling…' : confirm === 'unknown' ? 'Cancel this ride?' : copy?.title}
          </p>
          <p className="text-xs text-text-secondary mt-0.5 mb-3">
            {confirm === 'checking' ? 'One moment.' : confirm === 'unknown' ? "We couldn't check whether a fee applies. If one does, you will see it on your receipt." : copy?.body}
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={onKeep} disabled={cancelling}
              className="flex-1 min-h-[44px] rounded-xl bg-surface-2 text-xs font-semibold text-text-primary disabled:opacity-50">Keep ride</button>
            <button type="button" onClick={onConfirmCancel} disabled={cancelling || confirm === 'checking'}
              className="flex-1 min-h-[44px] rounded-xl bg-status-error text-xs font-semibold text-white disabled:opacity-50">
              {cancelling ? 'Cancelling…' : confirm === 'checking' ? 'Cancel ride' : confirm === 'unknown' ? 'Cancel ride' : copy?.confirm}
            </button>
          </div>
        </div>
      )}
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
      whileTap={{ scale: 0.97 }}
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
    <div className="bg-surface rounded-2xl border border-border p-4">
      <div className="flex justify-between mb-3">
        <div className="skeleton h-5 w-24 rounded-full" />
        <div className="skeleton h-5 w-16 rounded" />
      </div>
      <div className="space-y-2 mb-2">
        <div className="skeleton h-4 rounded w-4/5" />
        <div className="skeleton h-4 rounded w-2/3" />
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
          whileTap={{ scale: 0.97 }}
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
        whileTap={{ scale: 0.97 }}
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
  const [terms, setTerms] = useState<AdvanceTerms>(FALLBACK_TERMS)
  const [confirming, setConfirming] = useState<{ id: string; state: CancelPreview | 'checking' | 'unknown' } | null>(null)
  const [editing, setEditing] = useState<UpcomingRide | null>(null)
  const [notice, setNotice] = useState<{ id: string; text: string } | null>(null)

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
  useEffect(() => { void rideApi.advanceTerms().then(setTerms) }, [])
  useEffect(() => { void fetchActive() }, [fetchActive])

  // Cancel asks what it costs first, so a fee is never a surprise. If the check fails the rider can still cancel.
  async function askCancel(rideId: string) {
    setNotice(null)
    setConfirming({ id: rideId, state: 'checking' })
    try {
      setConfirming({ id: rideId, state: await rideApi.cancelPreview(rideId) })
    } catch {
      setConfirming({ id: rideId, state: 'unknown' })
    }
  }

  async function handleCancelUpcoming(rideId: string) {
    setCancellingId(rideId)
    try {
      await rideApi.cancelRide(rideId)
      setUpcoming(prev => prev.filter(r => r.id !== rideId))
      setConfirming(null)
    } catch {
      setUpcomingError(true)
    } finally {
      setCancellingId(null)
    }
  }

  async function saveNewTime(ride: UpcomingRide, when: Date | null) {
    setEditing(null)
    if (!when) return // the picker's "Now" does not apply to a booking that already exists
    setNotice(null)
    try {
      const out = await rideApi.reschedule(ride.id, when.toISOString())
      setUpcoming(prev => prev
        .map(r => (r.id === ride.id ? { ...r, scheduled_for: out.scheduledFor } : r))
        .sort((a, b) => new Date(a.scheduled_for).getTime() - new Date(b.scheduled_for).getTime()))
    } catch (err) {
      const code = axios.isAxiosError(err) ? (err.response?.data as { code?: string } | undefined)?.code : undefined
      const serverMsg = axios.isAxiosError(err) ? (err.response?.data as { error?: string } | undefined)?.error : undefined
      setNotice({ id: ride.id, text: rescheduleErrorMessage(code, serverMsg ?? "We couldn't change the time. Your booking is unchanged.") })
    }
  }

  const filtered = tab === 'all' ? rides : rides.filter(r => r.status === tab)
  const pickerMin = new Date(Date.now() + MIN_ADVANCE_MINUTES * 60_000)
  const pickerMax = new Date(Date.now() + MAX_ADVANCE_DAYS * 24 * 60 * 60_000)

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
              whileTap={{ scale: 0.97 }}
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
                    terms={terms}
                    onOpen={() => router.push(`/ride/${ride.id}`)}
                    onAskCancel={() => void askCancel(ride.id)}
                    onKeep={() => setConfirming(null)}
                    onConfirmCancel={() => void handleCancelUpcoming(ride.id)}
                    onChangeTime={() => { setNotice(null); setEditing(ride) }}
                    confirm={confirming?.id === ride.id ? confirming.state : null}
                    notice={notice?.id === ride.id ? notice.text : null}
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
                    whileTap={{ scale: 0.97 }}
                  >
                    <ChevronLeft size={16} strokeWidth={2.5} /> Prev
                  </motion.button>
                  <span className="text-xs text-text-muted">{page} / {pages}</span>
                  <motion.button
                    disabled={page >= pages}
                    onClick={() => void fetchHistory(page + 1)}
                    className="inline-flex items-center gap-1 pl-4 pr-2.5 py-2 rounded-full text-sm font-semibold text-primary bg-surface-2 disabled:opacity-30"
                    whileTap={{ scale: 0.97 }}
                  >
                    Next <ChevronRight size={16} strokeWidth={2.5} />
                  </motion.button>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Change time: the same calendar the booking flow uses, limited to the bookable window. The rules sit with the booking, not here. */}
      <SchedulePickerSheet
        open={editing !== null}
        value={editing ? new Date(editing.scheduled_for) : null}
        min={pickerMin}
        max={pickerMax}
        onChange={(d) => { if (editing) void saveNewTime(editing, d) }}
        onClose={() => setEditing(null)}
        notes={termsLines(terms)}
        reschedule
      />
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
