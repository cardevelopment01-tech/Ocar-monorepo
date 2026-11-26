'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, CalendarClock, CheckCircle2, ChevronDown, Loader2, MapPin, Search, Zap, Send } from 'lucide-react'
import SlideOver from '@/components/ui/SlideOver'
import ReasonDialog from '@/components/ui/ReasonDialog'
import RescheduleDialog from './RescheduleDialog'
import { dispatchApi } from '@/lib/dispatch-api'
import RideOffers, { offerSummary } from '@/components/rides/RideOffers'
import { adminRideApi, type AdminRideDetail, type AssignCandidate } from '@/lib/admin-api'
import { extractErrorCode, extractErrorMessage } from '@/lib/http-errors'
import { fmtIst } from '@/lib/ist'
import { useNow } from '@/lib/use-now'
import {
  ASK_TIMEOUT_SECONDS, BOOK_GRACE_MINUTES, dispatchState, earlyAssignWarning, relativeTo, reservationNote, type DispatchTone,
} from '@/lib/dispatch-model'

type Mode = 'reserve' | 'ask' | 'book'

const TONE_PILL: Record<DispatchTone, string> = { muted: 'pill-muted', info: 'pill-info', warning: 'pill-warning', danger: 'pill-danger' }

// Why a driver is not a clean choice, in priority order (a driver can fail more than one gate).
function whyNot(c: AssignCandidate): string {
  if (!c.is_online) return 'Offline'
  if (!c.category_ok) return 'Wrong vehicle category'
  return c.city_billing_mode === 'package' ? 'Package balance empty' : 'Below minimum balance'
}

export default function DispatchPanel({ rideId, canAssign, onClose, onAssigned, onChanged, onCandidates, overMap }: {
  rideId: string | null
  /** Only ops and super admins can assign; everyone else sees the ride and its history. */
  canAssign: boolean
  onClose: () => void
  onAssigned: (message: string) => void
  /** The ride's time was changed or the ride was cancelled by support. */
  onChanged: (message: string) => void
  /** Called with the drivers shown in the list each time it loads (and with none when the panel closes): the live map marks the nearest ones. */
  onCandidates?: (candidates: AssignCandidate[]) => void
  /** Opened over a map: a narrower panel with no dimming layer, so the map stays visible and usable beside it. */
  overMap?: boolean
}) {
  const now = useNow(15_000)
  const [detail, setDetail] = useState<AdminRideDetail | null>(null)
  const [detailError, setDetailError] = useState(false)
  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [cands, setCands] = useState<AssignCandidate[]>([])
  const [loading, setLoading] = useState(false)
  const [candError, setCandError] = useState('')
  const [mode, setMode] = useState<Mode>('ask')
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [assignError, setAssignError] = useState<{ id: string; message: string; overlap?: boolean } | null>(null)
  const [releasing, setReleasing] = useState<'ask' | 'busy' | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const seq = useRef(0)
  const [action, setAction] = useState<'cancel' | 'reschedule' | null>(null)
  const [acting, setActing] = useState(false)
  const [actionError, setActionError] = useState('')

  // New ride: reset everything and load its detail (rider, route, history).
  useEffect(() => {
    setDetail(null); setDetailError(false); setQ(''); setDebouncedQ(''); setCands([]); setConfirmId(null); setAssignError(null); setMode('ask'); setShowHistory(false); setAction(null); setActionError('')
    if (!rideId) return
    let cancelled = false
    adminRideApi.getById(rideId).then(d => { if (!cancelled) { setDetail(d); setMode(d.status === 'scheduled' ? 'reserve' : 'ask'); setShowHistory(d.offers?.length > 0 && d.status !== 'scheduled') } }).catch(() => { if (!cancelled) setDetailError(true) })
    return () => { cancelled = true }
  }, [rideId])

  useEffect(() => { const t = setTimeout(() => setDebouncedQ(q.trim()), 300); return () => clearTimeout(t) }, [q])

  // Drivers: online ones by default (the only ones that can take a ride); a search looks across every driver in the city, offline included.
  const loadCandidates = useCallback(() => {
    if (!rideId) return
    const mySeq = ++seq.current
    setLoading(true); setCandError('')
    // Reserving is for later, so offline drivers are fine; asking or booking needs someone online right now.
    adminRideApi.getAssignCandidates(rideId, debouncedQ ? { q: debouncedQ } : mode === 'reserve' ? {} : { online: true })
      .then(list => { if (mySeq === seq.current) setCands(list) })
      .catch(err => { if (mySeq === seq.current) setCandError(extractErrorMessage(err, 'Could not load drivers for this ride.')) })
      .finally(() => { if (mySeq === seq.current) setLoading(false) })
  }, [rideId, debouncedQ, mode])
  useEffect(() => { loadCandidates() }, [loadCandidates])
  const onCandidatesRef = useRef(onCandidates)
  onCandidatesRef.current = onCandidates
  useEffect(() => { onCandidatesRef.current?.(rideId ? cands : []) }, [rideId, cands])

  const ctx = detail ? { status: detail.status as 'scheduled' | 'requested' | 'no_drivers', dispatch_at: detail.dispatch_at, scheduled_for: detail.scheduled_for } : null
  const state = ctx ? dispatchState(ctx, now) : null
  const warning = ctx && mode !== 'reserve' ? earlyAssignWarning(ctx, now) : null
  const reserved = detail?.reserved_driver_id ? reservationNote({ ...detail, scheduled_for: detail.scheduled_for }, now) : null
  const assignable = !!ctx && ['scheduled', 'requested', 'no_drivers'].includes(ctx.status)

  async function assign(c: AssignCandidate, override = false) {
    if (!rideId) return
    setBusyId(c.driver_id); setAssignError(null)
    try {
      if (mode === 'reserve') {
        await dispatchApi.reserveDriver(rideId, c.driver_id, override)
        onAssigned(`${c.driver_name ?? 'Driver'} reserved. They keep taking rides until then, and are reminded before the pickup.`)
      } else {
        await adminRideApi.assignDriver(rideId, c.driver_id, mode === 'ask' ? 'request' : 'force', !c.eligible)
        onAssigned(mode === 'ask' ? `Request sent to ${c.driver_name}` : `Ride booked to ${c.driver_name}`)
      }
    } catch (err) {
      setAssignError({
        id: c.driver_id,
        message: extractErrorMessage(err, mode === 'reserve' ? 'Could not reserve this driver. The ride may have changed: refresh the queue.' : 'Assignment failed. The ride may already have been taken: refresh the queue.'),
        overlap: extractErrorCode(err) === 'RESERVATION_OVERLAP',
      })
    } finally { setBusyId(null); setConfirmId(null) }
  }

  async function release() {
    if (!rideId) return
    setReleasing('busy')
    try {
      await dispatchApi.releaseReservation(rideId)
      onChanged('Reservation released. The driver was told.')
    } catch (err) {
      setActionError(extractErrorMessage(err, 'Could not release the reservation. Close and reopen the ride.'))
    } finally { setReleasing(null) }
  }

  // Booking directly, an advance booking pulled forward, and overriding a failed check all need a second, explicit click.
  const needsConfirm = (c: AssignCandidate) => mode !== 'reserve' && (mode === 'book' || !!warning || !c.eligible)
  function onPick(c: AssignCandidate) {
    if (needsConfirm(c) && confirmId !== c.driver_id) { setConfirmId(c.driver_id); return }
    void assign(c)
  }

  const clean = cands.filter(c => c.eligible)
  const others = cands.filter(c => !c.eligible)

  return (
    <SlideOver isOpen={!!rideId} onClose={onClose} title={rideId ? `Assign a driver: ride #${rideId}` : ''} width={overMap ? 'md' : 'lg'} backdrop={!overMap}>
      <div className="p-5 space-y-4">
        {detailError && <p role="alert" className="text-xs text-danger font-semibold">Could not load this ride. Close and open it again.</p>}

        {detail && (
          <div className="rounded-2xl border border-border-light bg-surface-2 p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-text-primary truncate">{detail.user_name ?? detail.user_phone}</p>
                <p className="text-xs text-text-muted">{detail.user_phone}</p>
              </div>
              <div className="text-right flex-shrink-0">
                {state && <span className={TONE_PILL[state.tone]}>{state.label}</span>}
                <p className="text-sm font-bold text-text-primary mt-1">{detail.fare ? `₹${parseFloat(detail.fare).toLocaleString('en-IN')}` : '—'}</p>
              </div>
            </div>
            <div className="space-y-1.5 text-sm">
              <p className="flex items-start gap-2 text-text-primary"><MapPin className="w-3.5 h-3.5 text-success mt-0.5 shrink-0" />{detail.origin_address ?? '—'}</p>
              <p className="flex items-start gap-2 text-text-secondary"><MapPin className="w-3.5 h-3.5 text-danger mt-0.5 shrink-0" />{detail.destination_address ?? 'No fixed destination'}</p>
            </div>
            <p className="text-xs text-text-muted">
              {[detail.category_name, detail.origin_city].filter(Boolean).join(' · ')}
              {detail.scheduled_for ? ` · Pickup ${fmtIst(detail.scheduled_for)} (${relativeTo(detail.scheduled_for, now)})` : ` · Booked ${fmtIst(detail.requested_at)}`}
            </p>
            <div className="flex items-center gap-2 flex-wrap pt-1">
              <Link href={`/rides/${detail.id}`} className="text-xs font-semibold text-primary hover:underline mr-auto">Open full ride details</Link>
              {canAssign && detail.status === 'scheduled' && (
                <button type="button" onClick={() => { setActionError(''); setAction('reschedule') }}
                  className="px-3 py-1.5 text-xs font-semibold text-text-secondary border border-border rounded-lg hover:bg-surface transition-colors">Change time</button>
              )}
              {canAssign && ['scheduled', 'requested', 'no_drivers'].includes(detail.status) && (
                <button type="button" onClick={() => { setActionError(''); setAction('cancel') }}
                  className="px-3 py-1.5 text-xs font-semibold text-danger border border-danger/30 rounded-lg hover:bg-danger-light transition-colors">Cancel ride</button>
              )}
            </div>
          </div>
        )}

        {actionError && action === null && <p role="alert" className="text-xs text-danger font-semibold">{actionError}</p>}

        {detail && detail.status === 'scheduled' && detail.reserved_driver_id && reserved && (
          <div className={`rounded-2xl border p-4 space-y-2 ${reserved.tone === 'danger' ? 'border-danger/40 bg-danger-light' : reserved.tone === 'warn' ? 'border-warning/40 bg-warning-light' : 'border-success/40 bg-success-light'}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-text-secondary flex items-center gap-1.5">
                  {reserved.tone === 'ok' ? <CheckCircle2 className="w-3.5 h-3.5 text-success" /> : <CalendarClock className="w-3.5 h-3.5" />}Reserved driver
                </p>
                <Link href={`/drivers/${detail.reserved_driver_id}`} className="text-sm font-semibold text-text-primary hover:underline block truncate">{detail.reserved_driver_name ?? detail.reserved_driver_phone}</Link>
                <p className="text-xs text-text-secondary">{detail.reserved_driver_phone}</p>
              </div>
              {canAssign && (releasing !== null ? (
                <span className="flex items-center gap-1.5 flex-shrink-0">
                  <button type="button" disabled={releasing === 'busy'} onClick={() => void release()} className="px-2.5 py-1 text-xs font-semibold rounded-full bg-danger text-white">Release</button>
                  <button type="button" onClick={() => setReleasing(null)} className="px-2.5 py-1 text-xs font-semibold rounded-full border border-border text-text-secondary">Keep</button>
                </span>
              ) : (
                <button type="button" onClick={() => setReleasing('ask')} className="px-3 py-1.5 text-xs font-semibold text-text-secondary border border-border rounded-lg hover:bg-surface transition-colors flex-shrink-0">Release</button>
              ))}
            </div>
            <p className="text-xs text-text-primary">
              {reserved.text.replace(/^.*?reserved: /, '').replace(/^./, ch => ch.toUpperCase())}.
              {' '}This ride goes to them automatically {detail.dispatch_at ? `at ${fmtIst(detail.dispatch_at)}` : 'at dispatch time'}; if they are offline or still on a ride then, it is opened to everyone.
            </p>
            {(detail.reserved_driver_late_releases ?? 0) > 0 && (
              <p className="text-xs font-semibold text-warning flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" />{detail.reserved_driver_late_releases} late hand-back{detail.reserved_driver_late_releases === 1 ? '' : 's'} in the last 30 days</p>
            )}
          </div>
        )}

        {warning && (
          <div role="note" className="rounded-xl border border-warning/40 bg-warning-light px-3 py-2.5 text-xs text-text-primary flex gap-2">
            <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-px" />
            <span>{warning}</span>
          </div>
        )}

        {detail?.offers && (
          <div className="rounded-2xl border border-border-light">
            <button type="button" onClick={() => setShowHistory(v => !v)} aria-expanded={showHistory}
              className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left">
              <span className="text-xs font-semibold text-text-secondary">Already offered: {offerSummary(detail.offers)}</span>
              <ChevronDown className={`w-4 h-4 text-text-muted transition-transform ${showHistory ? 'rotate-180' : ''}`} />
            </button>
            {showHistory && <div className="px-4 pb-4"><RideOffers offers={detail.offers} hideSummary /></div>}
          </div>
        )}

        {assignable && canAssign && (
          <>
            <div role="radiogroup" aria-label="How to assign" className={`grid grid-cols-1 gap-2 ${detail?.status === 'scheduled' ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
              {([
                ...(detail?.status === 'scheduled' ? [['reserve', 'Reserve a driver', CalendarClock, 'Recommended for a booking made ahead. The driver keeps taking rides, only ones that finish in time, and is reminded and asked to confirm. The ride goes to them at dispatch time.'] as const] : []),
                ['ask', 'Ask the driver', Send, `They get a request and ${ASK_TIMEOUT_SECONDS} seconds to accept. If they decline or do not answer, the ride goes back to open dispatch.`] as const,
                ['book', 'Book directly', Zap, `The driver is booked at once. If their app shows no activity within ${BOOK_GRACE_MINUTES} minutes the ride is released and offered to everyone again.`] as const,
              ]).map(([value, label, Icon, help]) => (
                <button key={value} type="button" role="radio" aria-checked={mode === value} onClick={() => { setMode(value); setConfirmId(null) }}
                  className={`text-left rounded-xl border p-3 transition-colors ${mode === value ? 'border-primary bg-primary-light' : 'border-border bg-surface hover:bg-surface-2'}`}>
                  <span className="flex items-center gap-1.5 text-sm font-semibold text-text-primary"><Icon className="w-3.5 h-3.5" />{label}</span>
                  <span className="block text-[11px] text-text-muted mt-1 leading-snug">{help}</span>
                </button>
              ))}
            </div>

            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
              <input value={q} onChange={e => setQ(e.target.value)} aria-label="Search drivers by name or phone"
                placeholder="Search any driver in this city by name or phone"
                className="w-full pl-9 pr-3 py-2 text-sm rounded-xl bg-surface border border-border focus:outline-none focus:ring-2 focus:ring-primary/20" />
            </div>

            {candError && (
              <div role="alert" className="rounded-xl bg-danger-light text-danger text-xs px-3 py-2 flex items-center justify-between gap-2">
                <span>{candError}</span><button onClick={loadCandidates} className="font-semibold underline">Retry</button>
              </div>
            )}

            <div aria-busy={loading}>
              {loading && cands.length === 0 && <div className="space-y-2">{[0, 1, 2].map(i => <div key={i} className="h-14 rounded-xl bg-surface-2 animate-pulse" />)}</div>}

              {!loading && !candError && cands.length === 0 && (
                <p className="text-sm text-text-muted py-4 text-center">
                  {debouncedQ ? 'No driver in this city matches that search.' : 'No drivers are online in this city right now. Search by name to check a specific driver.'}
                </p>
              )}

              <ul className="space-y-1.5">
                {[...clean, ...others].map(c => {
                  const isConfirm = confirmId === c.driver_id
                  // Asking or booking needs the driver online now; a reservation does not.
                  const blocked = !c.is_online && mode !== 'reserve'
                  return (
                    <li key={c.driver_id} className={`rounded-xl border px-3 py-2.5 ${c.eligible ? 'border-border-light' : 'border-border-light bg-surface-2/60'}`}>
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <Link href={`/drivers/${c.driver_id}`} className="text-sm font-medium text-text-primary hover:underline truncate block">{c.driver_name ?? c.driver_phone}</Link>
                          <p className="text-xs text-text-muted flex items-center gap-1.5 flex-wrap">
                            {c.category_name ?? 'No vehicle category'}
                            {c.distance_metres != null && <span>· {(c.distance_metres / 1000).toFixed(1)} km from pickup</span>}
                            {!c.eligible && (mode === 'reserve' && !c.is_online && c.category_ok && c.wallet_ok ? <span className="pill-muted">Offline now</span> : <span className={blocked ? 'pill-muted' : 'pill-warning'}>{whyNot(c)}</span>)}
                            {(c.late_releases ?? 0) > 0 && <span className="pill-warning">{c.late_releases} late hand-back{c.late_releases === 1 ? '' : 's'}</span>}
                          </p>
                        </div>
                        <button disabled={blocked || busyId !== null} onClick={() => onPick(c)}
                          className={`px-3 py-1.5 text-xs font-semibold rounded-full flex-shrink-0 inline-flex items-center gap-1.5 transition-colors disabled:opacity-50 ${
                            c.eligible ? 'bg-primary text-white hover:bg-primary-dark' : 'bg-surface text-text-primary border border-border hover:bg-surface-2'}`}>
                          {busyId === c.driver_id && <Loader2 size={12} className="animate-spin" />}
                          {blocked ? 'Offline' : !c.eligible ? (mode === 'reserve' ? 'Reserve anyway' : 'Assign anyway') : mode === 'reserve' ? 'Reserve' : mode === 'ask' ? 'Ask' : 'Book'}
                        </button>
                      </div>
                      {isConfirm && (
                        <div className="mt-2 rounded-lg bg-warning-light text-text-primary text-xs px-3 py-2 flex items-center justify-between gap-3">
                          <span>
                            {!c.eligible ? `${c.driver_name ?? 'This driver'} is flagged: ${whyNot(c).toLowerCase()}. ` : ''}
                            {mode === 'book' ? 'Book this ride to them now?' : 'Send them the request now?'}
                          </span>
                          <button disabled={busyId !== null} onClick={() => void assign(c)} className="px-2.5 py-1 rounded-full bg-warning text-white font-semibold flex-shrink-0">Confirm</button>
                        </div>
                      )}
                      {assignError?.id === c.driver_id && (
                        <p role="alert" className="mt-1.5 text-xs text-danger">
                          {assignError.message}
                          {assignError.overlap && canAssign && <button type="button" disabled={busyId !== null} onClick={() => void assign(c, true)} className="ml-2 font-semibold underline">Reserve anyway</button>}
                        </p>
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
          </>
        )}

        {detail && !assignable && <p className="text-sm text-text-muted">This ride is {detail.status.replace(/_/g, ' ')}, so it can no longer be assigned.</p>}
        {detail && assignable && !canAssign && <p className="text-sm text-text-muted">Your role can see the queue but not assign drivers. Ask an ops admin.</p>}
      </div>

      {/* Support actions on the rider's behalf. Both need a reason; both tell the rider. */}
      <ReasonDialog
        open={action === 'cancel'}
        title={`Cancel ride #${rideId ?? ''}?`}
        description="The rider is told Ocar support cancelled it and that they have not been charged. Any offer they used is given back. This cannot be undone."
        confirmLabel="Cancel ride"
        variant="danger"
        loading={acting}
        onCancel={() => setAction(null)}
        onConfirm={async reason => {
          if (!rideId) return
          setActing(true); setActionError('')
          try { await dispatchApi.cancelRide(rideId, reason.trim()); setAction(null); onChanged(`Ride #${rideId} cancelled`) }
          catch (err) { setAction(null); setActionError(extractErrorMessage(err, 'Could not cancel this ride. It may have changed: close and reopen it.')) }
          finally { setActing(false) }
        }}
      />
      <RescheduleDialog
        open={action === 'reschedule'}
        current={detail?.scheduled_for ?? null}
        loading={acting}
        error={action === 'reschedule' ? actionError : ''}
        onCancel={() => setAction(null)}
        onConfirm={async (iso, reason) => {
          if (!rideId) return
          setActing(true); setActionError('')
          try { await dispatchApi.rescheduleRide(rideId, iso, reason); setAction(null); onChanged(`Ride #${rideId} moved to the new time`) }
          catch (err) { setActionError(extractErrorMessage(err, 'Could not change the time. Close and reopen the ride and try again.')) }
          finally { setActing(false) }
        }}
      />
    </SlideOver>
  )
}
