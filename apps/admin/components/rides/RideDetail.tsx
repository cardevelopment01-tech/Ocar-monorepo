'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { AlertTriangle, ArrowLeft, CheckCircle2, ChevronLeft, ChevronRight, Clock, Copy, Check, ExternalLink, Headset, Info, KeyRound, Link2, MapPin, MoreHorizontal, Navigation, Phone, Star, X, Zap } from 'lucide-react'
import StatusPill from '@/components/ui/StatusPill'
import ReasonDialog from '@/components/ui/ReasonDialog'
import { cardMode } from '@/lib/rate-card-mode'
import { adminRideApi, type AdminRideDetail, type AdminRideTrailPoint } from '@/lib/admin-api'
import { useAdminAuth } from '@/lib/auth-context'
import { useNow } from '@/lib/use-now'
import { extractErrorMessage } from '@/lib/http-errors'
import { fmtIst, fmtIstTime } from '@/lib/ist'
import { fmtDuration } from '@/lib/dispatch-model'
import { FORCE_CONSEQUENCE, ago, keyFacts, rideSituation, rideSummaryText, riderRating, tabsFor, timelineEvents, channelLabel, type RideLike, type TabId, type Tone } from '@/lib/ride-situation'
import BookedTimeBlock from './BookedTimeBlock'
import RideOffers from './RideOffers'
import RideMap from './RideMap'

// Active trips refresh themselves, finished ones do not: nothing changes on a completed ride and a refresh would only reset what you were reading.
const LIVE_STATUSES = ['requested', 'accepted', 'driver_arrived', 'in_progress', 'returning']
const MAP_STATUSES = ['accepted', 'driver_arrived', 'in_progress', 'returning', 'completed']
const LIVE_MS = 15_000
/** The rides list leaves its visible ids here so J / K can step through them from the detail page. */
export const RIDES_NAV_KEY = 'ocar_rides_nav'

const readNav = (): string[] => { try { const v = JSON.parse(sessionStorage.getItem(RIDES_NAV_KEY) ?? '[]'); return Array.isArray(v) ? v.map(String) : [] } catch { return [] } }

const TONE_BOX: Record<Tone, string> = {
  neutral: 'bg-surface-2 border-border-light',
  info: 'bg-primary-light/60 border-primary/20',
  success: 'bg-success-light border-success/25',
  warning: 'bg-warning-light border-warning/35',
  danger: 'bg-danger-light border-danger/30',
}
const TONE_TEXT: Record<Tone, string> = { neutral: 'text-text-primary', info: 'text-primary-dark', success: 'text-success', warning: 'text-warning', danger: 'text-danger' }
const TONE_ICON = { neutral: Info, info: Navigation, success: CheckCircle2, warning: AlertTriangle, danger: AlertTriangle } as const

const rupees = (v: string | number | null | undefined) => (v == null || v === '' ? null : `₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`)
const initials = (name: string | null | undefined) => {
  const p = (name ?? '').trim().split(/\s+/)
  return (((p[0]?.[0] ?? '') + (p.length > 1 ? p[p.length - 1]?.[0] ?? '' : '')).toUpperCase()) || '?'
}

function Person({ role, name, phone, href, tone, extra }: { role: string; name: string | null; phone: string | null; href?: string | null; tone: 'primary' | 'muted'; extra?: string | null }) {
  return (
    <div className="flex items-center gap-3 min-w-0">
      <span className={`inline-flex items-center justify-center w-10 h-10 rounded-full text-xs font-semibold shrink-0 ${tone === 'primary' ? 'bg-primary/10 text-primary' : 'bg-surface-2 text-text-muted border border-border-light'}`}>{initials(name)}</span>
      <div className="min-w-0">
        <p className="text-[11px] text-text-muted">{role}</p>
        {name && href ? <Link href={href} className="block text-sm font-semibold text-primary hover:underline truncate">{name}</Link>
          : <p className="text-sm font-semibold text-text-primary truncate">{name ?? 'Not assigned'}</p>}
        {phone && <a href={`tel:${phone}`} className="inline-flex items-center gap-1 text-xs text-text-secondary hover:text-primary tabular-nums"><Phone className="w-3 h-3" />{phone}</a>}
        {extra && <p className="text-[11px] text-text-muted truncate">{extra}</p>}
      </div>
    </div>
  )
}

function Row({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: 'danger' | 'muted' }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span className="text-xs text-text-muted">{label}</span>
      <span className={`text-sm tabular-nums ${strong ? 'font-bold text-text-primary' : 'font-medium text-text-primary'} ${tone === 'danger' ? '!text-danger' : ''}`}>{value}</span>
    </div>
  )
}

function Card({ title, children, icon }: { title: string; children: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border-light bg-surface p-4">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold text-text-secondary mb-3">{icon}{title}</h3>
      {children}
    </section>
  )
}

function OtpLine({ label, otp }: { label: string; otp: { verified_at: string | null; failed_attempts: number } }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="text-xs text-text-muted">{label}</span>
      <span className="text-sm text-right tabular-nums">
        {otp.verified_at ? <span className="font-medium text-text-primary">Verified {fmtIstTime(new Date(otp.verified_at))}</span> : <span className="text-text-muted">Not verified</span>}
        {otp.failed_attempts > 0 && <span className="block text-[11px] text-warning font-medium">{otp.failed_attempts} wrong {otp.failed_attempts === 1 ? 'try' : 'tries'}</span>}
      </span>
    </div>
  )
}

function Notes({ rideId, notes, onAdded }: { rideId: string; notes: AdminRideDetail['notes']; onAdded: () => void }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  async function add() {
    const t = text.trim()
    if (!t) return
    setBusy(true); setErr('')
    try { await adminRideApi.addNote(rideId, t); setText(''); onAdded() }
    catch (e) { setErr(extractErrorMessage(e, 'Could not save the note. Try again.')) }
    finally { setBusy(false) }
  }
  return (
    <Card title="Internal notes">
      {notes.length === 0 && <p className="text-xs text-text-muted mb-3">Nothing yet. Notes here are for the team only; riders and drivers never see them.</p>}
      {notes.length > 0 && (
        <ul className="space-y-3 mb-3">
          {notes.map(n => (
            <li key={n.id}>
              <p className="text-sm text-text-primary whitespace-pre-wrap break-words">{n.note}</p>
              <p className="text-[11px] text-text-muted mt-0.5">{n.admin_name ?? 'Admin'} · {fmtIst(n.created_at, true)}</p>
            </li>
          ))}
        </ul>
      )}
      <label htmlFor="ride-note" className="sr-only">Add a note</label>
      <textarea id="ride-note" value={text} onChange={e => setText(e.target.value)} maxLength={2000} rows={3} placeholder="What did you do or learn? Notes cannot be edited or deleted."
        className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/30 resize-y" />
      {err && <p role="alert" className="text-xs text-danger font-semibold mt-1">{err}</p>}
      <div className="flex justify-end mt-2">
        <button onClick={() => void add()} disabled={busy || !text.trim()} className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-primary text-white hover:bg-primary-dark disabled:opacity-40">{busy ? 'Saving…' : 'Add note'}</button>
      </div>
    </Card>
  )
}

export default function RideDetail({ rideId }: { rideId: string }) {
  const router = useRouter()
  const now = useNow(30_000)
  const { admin } = useAdminAuth()
  // Only ops and super admins resolve or reassign a ride; support can read everything and add notes.
  const canAct = admin?.role === 'super_admin' || admin?.role === 'ops_admin'
  const [detail, setDetail] = useState<AdminRideDetail | null>(null)
  const [detailError, setDetailError] = useState(false)
  const [tick, setTick] = useState(0)
  const [tab, setTab] = useState<TabId>('overview')
  const [trail, setTrail] = useState<AdminRideTrailPoint[]>([])
  const [trailState, setTrailState] = useState<'loading' | 'ready' | 'failed' | 'none'>('none')
  const [copied, setCopied] = useState<'id' | 'link' | 'summary' | null>(null)
  const [copyError, setCopyError] = useState('')
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null)
  const [resolveTarget, setResolveTarget] = useState<'complete' | 'cancel' | null>(null)
  const [resolving, setResolving] = useState(false)
  const [actionError, setActionError] = useState('')
  const [nav, setNav] = useState<string[]>([])
  useEffect(() => { setNav(readNav()) }, [rideId])

  // New ride: start from its own overview.
  useEffect(() => { setTab('overview'); setDetail(null); setDetailError(false); setTrail([]); setTrailState('none'); setCopyError(''); setActionError(''); window.scrollTo({ top: 0 }) }, [rideId])

  // The full detail, refreshed every 15 s while the ride is live and the tab is visible. A failed refresh keeps what is on screen.
  const load = useCallback((silent: boolean) => {
    adminRideApi.getById(rideId)
      .then(d => { setDetail(d); setDetailError(false); setRefreshedAt(Date.now()) })
      .catch(() => { if (!silent) setDetailError(true) })
  }, [rideId])
  useEffect(() => { load(false) }, [load, tick])
  const live = detail ? LIVE_STATUSES.includes(detail.status) : false
  useEffect(() => {
    if (!live) return
    const run = () => { if (document.visibilityState === 'visible') load(true) }
    const id = setInterval(run, LIVE_MS)
    document.addEventListener('visibilitychange', run)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', run) }
  }, [live, load])

  const r = (detail ?? {}) as AdminRideDetail

  // The driver's route, once there is a driver and the map is worth showing. Its last point is when we last heard from them.
  useEffect(() => {
    if (!detail?.driver_name || !MAP_STATUSES.includes(detail.status)) { setTrail([]); setTrailState('none'); return }
    let cancelled = false
    setTrailState(s => (s === 'ready' ? s : 'loading'))
    adminRideApi.trail(rideId)
      .then(pts => { if (!cancelled) { setTrail(pts); setTrailState(pts.length ? 'ready' : 'none') } })
      .catch(() => { if (!cancelled) setTrailState(s => (s === 'ready' ? s : 'failed')) })
    return () => { cancelled = true }
    // refreshedAt: a live ride re-reads its route with each detail refresh
  }, [rideId, detail?.status, detail?.driver_name, refreshedAt])
  // The exact last point beats the thinned route, so the banner and the Last signal card always agree.
  const lastSignalAt = detail?.last_position?.recorded_at ?? (trail.length ? trail[trail.length - 1]!.recorded_at : null)

  const situation = useMemo(() => (detail ? rideSituation(detail as RideLike, now, { lastSignalAt }) : null), [detail, now, lastSignalAt])
  const facts = useMemo(() => (detail ? keyFacts(detail as RideLike, now) : []), [detail, now])
  const tabs = useMemo(() => (detail ? tabsFor(detail as RideLike) : []), [detail])
  useEffect(() => { if (tabs.length && !tabs.some(t => t.id === tab)) setTab('overview') }, [tabs, tab])
  const events = useMemo(() => (detail ? timelineEvents(detail as RideLike) : []), [detail])
  const rating = detail ? riderRating(detail as RideLike) : null
  const canForce = canAct && (r.status === 'in_progress' || r.status === 'returning')

  const idx = nav.indexOf(rideId)
  const prevId = idx > 0 ? nav[idx - 1]! : null
  const nextId = idx >= 0 && idx < nav.length - 1 ? nav[idx + 1]! : null
  const goPrev = prevId ? () => router.push(`/rides/${prevId}`) : null
  const goNext = nextId ? () => router.push(`/rides/${nextId}`) : null

  // J / K step through the list you came from (not while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (e.key === 'j' && goNext) goNext()
      if (e.key === 'k' && goPrev) goPrev()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  async function copy(what: 'id' | 'link' | 'summary') {
    const link = `${window.location.origin}/rides/${rideId}`
    const text = what === 'id' ? rideId : what === 'link' ? link : rideSummaryText(detail as RideLike, now, link)
    try { await navigator.clipboard.writeText(text); setCopied(what); setCopyError(''); setTimeout(() => setCopied(null), 1500) }
    catch { setCopyError('Could not copy. Select the text and copy it by hand.') }
  }

  // A forced outcome moves a live trip's state and money, so it needs a typed reason; the API stores it in the ride's history.
  async function handleForceResolve(action: 'complete' | 'cancel', reason: string) {
    setResolving(true); setActionError('')
    try {
      await adminRideApi.forceResolve(rideId, action, reason.trim())
      setResolveTarget(null)
      load(true)
    } catch (err) {
      setResolveTarget(null)
      setActionError(extractErrorMessage(err, `Could not force ${action} this ride. It may have changed: refresh and try again.`))
    } finally { setResolving(false) }
  }

  if (!detail || !situation) {
    return (
      <div className="max-w-[1200px] mx-auto px-6 py-5">
        <Link href="/rides" className="inline-flex items-center gap-1.5 text-xs font-semibold text-text-secondary hover:text-primary"><ArrowLeft className="w-3.5 h-3.5" />All rides</Link>
        <h1 className="text-xl font-bold text-text-primary tabular-nums mt-2">Ride #{rideId}</h1>
        {detailError
          ? <div role="alert" className="mt-4 rounded-xl border border-warning/40 bg-warning-light px-3 py-2 text-sm flex items-center justify-between gap-3"><span>This ride could not be loaded. It may not exist, or the connection dropped.</span><button onClick={() => setTick(t => t + 1)} className="font-semibold underline flex-shrink-0">Retry</button></div>
          : <p className="text-sm text-text-muted mt-4" aria-live="polite">Loading ride…</p>}
      </div>
    )
  }

  const SituationIcon = TONE_ICON[situation.tone]
  const needsDriverSignal = live && !!r.driver_id

  return (
    <div className="max-w-[1200px] mx-auto px-6 py-5">
      {/* ── Header: where you are, who this is, and the actions ── */}
      <header className="mb-5">
        <Link href="/rides" className="inline-flex items-center gap-1.5 text-xs font-semibold text-text-secondary hover:text-primary"><ArrowLeft className="w-3.5 h-3.5" />All rides</Link>
        <div className="flex items-center gap-2 flex-wrap mt-2">
          <h1 className="text-xl font-bold text-text-primary tabular-nums">Ride #{rideId}</h1>
          {live && <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-success"><span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse motion-reduce:animate-none" />Live</span>}
          <div className="ml-auto flex items-center gap-1.5 flex-wrap">
            {nav.length > 0 && idx >= 0 && <span className="text-[11px] text-text-muted tabular-nums mr-1">{idx + 1} of {nav.length}</span>}
            <button onClick={() => goPrev?.()} disabled={!goPrev} aria-label="Previous ride (K)" title="Previous ride (K)" className="p-1.5 rounded-lg text-text-secondary hover:bg-surface-2 disabled:opacity-30"><ChevronLeft className="w-4 h-4" /></button>
            <button onClick={() => goNext?.()} disabled={!goNext} aria-label="Next ride (J)" title="Next ride (J)" className="p-1.5 rounded-lg text-text-secondary hover:bg-surface-2 disabled:opacity-30"><ChevronRight className="w-4 h-4" /></button>
            <button onClick={() => void copy('summary')} className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl border border-border text-text-secondary hover:bg-surface-2" title="Copies a short summary of this ride">
              {copied === 'summary' ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}{copied === 'summary' ? 'Copied' : 'Copy summary'}
            </button>
            <button onClick={() => void copy('link')} className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl border border-border text-text-secondary hover:bg-surface-2">
              {copied === 'link' ? <Check className="w-3.5 h-3.5 text-success" /> : <Link2 className="w-3.5 h-3.5" />}{copied === 'link' ? 'Copied' : 'Copy link'}
            </button>
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button aria-label="More actions" className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl border border-border text-text-secondary hover:bg-surface-2"><MoreHorizontal className="w-4 h-4" />More</button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content align="end" sideOffset={8} className="z-[80] w-[320px] rounded-2xl bg-surface border border-border shadow-hover p-1.5">
                  {['scheduled', 'requested', 'no_drivers'].includes(r.status) && (
                    <DropdownMenu.Item asChild>
                      <Link href={`/dispatch?ride=${rideId}`} className="flex gap-2.5 rounded-xl px-3 py-2.5 outline-none data-[highlighted]:bg-surface-2 cursor-pointer">
                        <Zap className="w-4 h-4 mt-0.5 text-primary flex-shrink-0" />
                        <span><span className="block text-sm font-semibold text-text-primary">Assign, change time or cancel</span><span className="block text-xs text-text-muted mt-0.5">Opens this ride on the Dispatch desk.</span></span>
                      </Link>
                    </DropdownMenu.Item>
                  )}
                  {canForce && (
                    <>
                      <DropdownMenu.Item disabled={resolving} onSelect={() => setResolveTarget('complete')} className="flex gap-2.5 rounded-xl px-3 py-2.5 outline-none data-[highlighted]:bg-surface-2 cursor-pointer data-[disabled]:opacity-50">
                        <CheckCircle2 className="w-4 h-4 mt-0.5 text-success flex-shrink-0" />
                        <span><span className="block text-sm font-semibold text-text-primary">Force complete</span><span className="block text-xs text-text-muted mt-0.5">Ends the trip as completed and settles the fare at the booked estimate. You will be asked for a reason.</span></span>
                      </DropdownMenu.Item>
                      <DropdownMenu.Item disabled={resolving} onSelect={() => setResolveTarget('cancel')} className="flex gap-2.5 rounded-xl px-3 py-2.5 outline-none data-[highlighted]:bg-danger-light cursor-pointer data-[disabled]:opacity-50">
                        <X className="w-4 h-4 mt-0.5 text-danger flex-shrink-0" />
                        <span><span className="block text-sm font-semibold text-danger">Force cancel</span><span className="block text-xs text-text-muted mt-0.5">Ends the trip as cancelled and frees the driver. The rider is not charged. You will be asked for a reason.</span></span>
                      </DropdownMenu.Item>
                    </>
                  )}
                  <DropdownMenu.Separator className="h-px bg-border-light my-1" />
                  <DropdownMenu.Item onSelect={() => void copy('id')} className="flex items-center gap-2.5 rounded-xl px-3 py-2 outline-none data-[highlighted]:bg-surface-2 cursor-pointer text-xs font-medium text-text-secondary"><Copy className="w-3.5 h-3.5" />Copy ride ID</DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap mt-1.5">
          <StatusPill status={r.status} />
          <StatusPill status={cardMode(r)} />
          {r.is_return_cab && <span className="pill-warning">Return cab</span>}
          {r.sos_triggered && <span className="pill-danger">SOS</span>}
          <span className="text-xs text-text-muted" title={fmtIst(r.requested_at, true)}>Requested {ago(r.requested_at, now)}</span>
          {(r.category_name || r.origin_city) && <span className="text-xs text-text-muted">· {[r.category_name, r.origin_city && r.destination_city && r.origin_city !== r.destination_city ? `${r.origin_city} → ${r.destination_city}` : r.origin_city].filter(Boolean).join(' · ')}</span>}
          {copyError && <span role="alert" className="text-xs text-danger font-semibold">{copyError}</span>}
          {!copyError && refreshedAt && live && <span className="text-[11px] text-text-muted ml-auto" aria-live="off"><Clock className="w-3 h-3 inline -mt-0.5 mr-1" />Updated {fmtIstTime(new Date(refreshedAt))}</span>}
        </div>
      </header>

      {/* ── What this ride means, in words, with the next step beside it ── */}
      <section aria-label="Situation" className={`rounded-2xl border p-4 mb-4 ${TONE_BOX[situation.tone]}`}>
        <div className="flex gap-3">
          <SituationIcon className={`w-5 h-5 mt-0.5 flex-shrink-0 ${TONE_TEXT[situation.tone]}`} aria-hidden />
          <div className="min-w-0 flex-1">
            <p className={`text-sm font-bold leading-snug ${TONE_TEXT[situation.tone]}`}>{situation.headline}</p>
            {situation.lines.map((l, i) => <p key={i} className="text-xs text-text-secondary mt-1 leading-relaxed">{l}</p>)}
            <div className="flex gap-2 flex-wrap mt-3">
              {situation.suggested.map(s => s === 'call_driver' && r.driver_phone
                ? <a key={s} href={`tel:${r.driver_phone}`} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-full bg-surface border border-border text-text-primary hover:bg-surface-2"><Phone className="w-3.5 h-3.5" />Call driver</a>
                : s === 'call_rider'
                  ? <a key={s} href={`tel:${r.user_phone}`} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-full bg-surface border border-border text-text-primary hover:bg-surface-2"><Phone className="w-3.5 h-3.5" />Call rider</a>
                  : s === 'open_dispatch'
                    ? <Link key={s} href={`/dispatch?ride=${rideId}`} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-full bg-primary text-white hover:bg-primary-dark"><Headset className="w-3.5 h-3.5" />Open in Dispatch</Link>
                    : null)}
            </div>
          </div>
        </div>
      </section>

      {actionError && <p role="alert" className="mb-4 rounded-xl border border-danger/30 bg-danger-light px-3 py-2 text-xs font-semibold text-danger">{actionError}</p>}
      {detailError && (
        <div role="alert" className="mb-4 rounded-xl border border-warning/40 bg-warning-light px-3 py-2 text-xs flex items-center justify-between gap-3">
          <span>The latest details could not be loaded. What you see may be out of date.</span>
          <button onClick={() => setTick(t => t + 1)} className="font-semibold underline flex-shrink-0">Retry</button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-6 items-start">
        <div className="min-w-0 space-y-5 order-2 lg:order-1">
          {/* ── The few numbers that matter ── */}
          {facts.length > 0 && (
            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3 border-y border-border-light py-4">
              {facts.map(f => (
                <div key={f.label} className="min-w-0">
                  <dt className="text-[11px] text-text-muted">{f.label}</dt>
                  <dd className={`text-lg font-bold tabular-nums leading-tight truncate ${f.tone === 'danger' ? 'text-danger' : 'text-text-primary'}`}>{f.value}</dd>
                  {f.hint && <dd className="text-[11px] text-text-muted first-letter:uppercase">{f.hint}</dd>}
                </div>
              ))}
            </dl>
          )}

          {/* ── Tabs: only the ones with something to say ── */}
          <div role="tablist" aria-label="Ride details" className="flex gap-1 border-b border-border-light -mb-px">
            {tabs.map(t => (
              <button key={t.id} role="tab" id={`tab-${t.id}`} aria-selected={tab === t.id} aria-controls={`panel-${t.id}`} onClick={() => setTab(t.id)}
                className={`relative px-3 py-2 text-sm font-semibold transition-colors ${tab === t.id ? 'text-primary' : 'text-text-muted hover:text-text-secondary'}`}>
                {t.label}
                {t.count ? <span className="ml-1.5 text-[11px] font-mono text-text-muted">{t.count}</span> : null}
                {t.alert && <span className="absolute top-1.5 right-0.5 w-1.5 h-1.5 rounded-full bg-danger" aria-label="needs attention" />}
                {tab === t.id && <span className="absolute left-2 right-2 -bottom-px h-0.5 bg-primary rounded-full" />}
              </button>
            ))}
          </div>

          <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="pt-1 pb-10">
            {tab === 'overview' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-xs font-semibold text-text-secondary mb-2">Route</h3>
                  <ol className="space-y-1">
                    {[{ label: 'Pickup', addr: r.origin_address, color: 'text-success', lat: r.origin_lat, lng: r.origin_lng }, { label: 'Drop', addr: r.destination_address ?? 'No fixed destination', color: 'text-danger', lat: r.destination_lat, lng: r.destination_lng }].map(p => (
                      <li key={p.label} className="flex items-start gap-2.5">
                        <MapPin className={`w-4 h-4 mt-0.5 shrink-0 ${p.color}`} />
                        <div className="min-w-0 flex-1">
                          <p className="text-[11px] text-text-muted">{p.label}</p>
                          <p className="text-sm font-medium text-text-primary leading-snug">{p.addr ?? '—'}</p>
                        </div>
                        {p.lat != null && p.lng != null && (
                          <a href={`https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`} target="_blank" rel="noopener noreferrer" aria-label={`Open ${p.label.toLowerCase()} in Google Maps`}
                            className="p-1.5 rounded-lg text-text-muted hover:text-primary hover:bg-surface-2"><ExternalLink className="w-3.5 h-3.5" /></a>
                        )}
                      </li>
                    ))}
                  </ol>
                </div>

                {r.origin_lat != null && r.origin_lng != null && MAP_STATUSES.includes(r.status) && (
                  <RideMap pickup={{ lat: r.origin_lat, lng: r.origin_lng }}
                    drop={r.destination_lat != null && r.destination_lng != null ? { lat: r.destination_lat, lng: r.destination_lng } : null} trail={trail} trailState={trailState} />
                )}

                {r.offers && r.offers.length > 0 && (
                  <div><h3 className="text-xs font-semibold text-text-secondary mb-2">Who was asked</h3><RideOffers offers={r.offers} hideSummary /></div>
                )}

                {detail && <BookedTimeBlock ride={detail} />}

                {r.stops && r.stops.length > 0 && (
                  <div>
                    <h3 className="text-xs font-semibold text-text-secondary mb-2">Stops</h3>
                    <ol className="space-y-1.5">
                      {r.stops.map(s => {
                        const dwell = s.arrived_at && s.reached_at ? Math.round((new Date(s.reached_at).getTime() - new Date(s.arrived_at).getTime()) / 60000) : null
                        const wait = parseFloat(s.wait_charge)
                        return (
                          <li key={s.id} className="flex justify-between gap-3 text-sm">
                            <span className="truncate text-text-primary">{s.sequence}. {s.address ?? 'Stop'}</span>
                            <span className="text-xs text-text-muted whitespace-nowrap capitalize">{s.status}{dwell != null ? ` · ${dwell}m wait` : ''}{wait > 0 ? ` · ₹${Math.round(wait)}` : ''}</span>
                          </li>
                        )
                      })}
                    </ol>
                  </div>
                )}

                <div>
                  <h3 className="text-xs font-semibold text-text-secondary mb-3">What happened</h3>
                  <ol className="relative">
                    {events.map((ev, i) => (
                      <li key={`${ev.label}-${i}`} className="relative pl-5 pb-4 last:pb-0">
                        {i < events.length - 1 && <span className="absolute left-[4px] top-3 bottom-0 w-px bg-border" />}
                        <span className={`absolute left-0 top-1.5 w-[9px] h-[9px] rounded-full ring-2 ring-surface ${i === events.length - 1 ? 'bg-primary' : 'bg-text-muted'}`} />
                        <div className="flex justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-text-primary capitalize">{ev.label}{ev.actor && <span className="text-xs font-normal text-text-muted"> · {ev.actor}</span>}</p>
                            {ev.note && <p className="text-xs text-text-secondary mt-0.5">{ev.note}</p>}
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className="text-xs text-text-secondary tabular-nums">{fmtIstTime(new Date(ev.ts))}</p>
                            {ev.gapMin != null && ev.gapMin > 0 && <p className="text-[11px] text-text-muted tabular-nums">+{fmtDuration(ev.gapMin * 60_000)}</p>}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
              </div>
            )}

            {tab === 'money' && (
              <div className="space-y-5">
                {(() => {
                  const parts: Array<[string, string | null, string?]> = [
                    ['Base fare', r.base_fare ?? null], ['Distance', r.distance_fare ?? null], ['Time', r.time_fare ?? null], ['Stops', r.stop_fare ?? null], ['Hour surcharge', r.hour_surcharge ?? null],
                    ['Booked time', r.waiting_fare ?? null], ['Overage', r.overage_fare ?? null],
                    ['Surge', r.surge_fare ?? null, r.surge_multiplier && parseFloat(r.surge_multiplier) > 1 ? `×${r.surge_multiplier}` : ''],
                    ['Extra time', r.overtimeFare != null ? String(r.overtimeFare) : null],
                    ['Airport toll', r.toll_charge ?? null, r.toll_detail?.length ? `(${r.toll_detail.map(t => t.zone).join(', ')})` : ''],
                    ['Waiting at pickup', r.pickup_wait_charge ?? null, r.pickup_wait_min ? `(${Math.round(parseFloat(r.pickup_wait_min))} min${r.pickup_free_wait_min != null ? `, ${r.pickup_free_wait_min} free` : ''})` : ''],
                  ]
                  const shown = parts.filter(([, v]) => v && parseFloat(v) > 0)
                  return (
                    <div>
                      <h3 className="text-xs font-semibold text-text-secondary mb-1">Fare</h3>
                      {shown.length === 0 && <p className="text-xs text-text-muted py-2">No fare breakdown yet. It is worked out when the ride is booked and confirmed at the end.</p>}
                      <div className="divide-y divide-border-light">
                        {shown.map(([label, v, suffix]) => <Row key={label} label={`${label}${suffix ? ` ${suffix}` : ''}`} value={rupees(v) ?? ''} />)}
                      </div>
                      {r.refund_amount && parseFloat(r.refund_amount) > 0 && <Row label="Refunded" value={`−${rupees(r.refund_amount)}`} tone="danger" />}
                      {r.fare && <div className="border-t border-border mt-1 pt-1"><Row label={r.status === 'completed' ? 'Total' : 'Estimated total'} value={rupees(r.fare) ?? ''} strong /></div>}
                      {(r.actual_km || r.estimated_km) && (
                        <p className="text-[11px] text-text-muted mt-1">
                          {r.actual_km ? `${parseFloat(r.actual_km).toFixed(1)} km driven` : `${parseFloat(r.estimated_km ?? '0').toFixed(1)} km estimated`}
                          {r.overage_km && parseFloat(r.overage_km) > 0 ? ` · ${parseFloat(r.overage_km).toFixed(1)} km over the booked distance` : ''}
                        </p>
                      )}
                    </div>
                  )
                })()}

                <div>
                  <h3 className="text-xs font-semibold text-text-secondary mb-1">Payment</h3>
                  {r.payment_status || r.payment_channel ? (
                    <div className="divide-y divide-border-light">
                      <div className="flex items-center justify-between py-1.5"><span className="text-xs text-text-muted">Status</span><span className="inline-flex gap-1"><StatusPill status={r.payment_status ?? 'pending'} />{r.cash_discrepancy && <StatusPill status="cash_flagged" />}</span></div>
                      {r.payment_channel && <Row label="Paid by" value={(channelLabel(r.payment_channel) ?? '').replace(/^./, c => c.toUpperCase())} />}
                      {r.payment_amount && <Row label="Amount" value={rupees(r.payment_amount) ?? ''} />}
                      {r.payment_captured_at && <Row label="Received" value={fmtIst(r.payment_captured_at, true)} />}
                      {r.payment_txn_id && <Row label="Gateway reference" value={r.payment_txn_id} />}
                      {r.payment_failed_at && <Row label="Failed" value={`${fmtIst(r.payment_failed_at, true)}${r.payment_failure_reason ? `: ${r.payment_failure_reason}` : ''}`} tone="danger" />}
                      {r.cash_discrepancy && <Row label="Cash the driver collected" value={rupees(r.cash_collected_amount ?? 0) ?? '₹0'} tone="danger" />}
                    </div>
                  ) : <p className="text-xs text-text-muted py-2">No payment yet. It is taken when the trip ends.</p>}
                </div>

                {r.driver_earning != null && parseFloat(r.driver_earning) > 0 && (
                  <div>
                    <h3 className="text-xs font-semibold text-text-secondary mb-1">Driver earnings</h3>
                    <div className="divide-y divide-border-light">
                      <Row label={`Commission${r.commission_percent ? ` (${parseFloat(r.commission_percent)}%)` : ''}`} value={rupees(r.commission_amount ?? 0) ?? '₹0'} />
                      <Row label="Driver keeps" value={rupees(r.driver_earning) ?? ''} strong />
                    </div>
                  </div>
                )}

                {r.status === 'cancelled' && (
                  <div>
                    <h3 className="text-xs font-semibold text-text-secondary mb-1">Cancellation fee</h3>
                    {r.cancellation_fee_applicable
                      ? <div className="divide-y divide-border-light">
                          <Row label="Fee" value={rupees(r.cancellation_fee_amount ?? 0) ?? '₹0'} />
                          <Row label="Outcome" value={r.cancellation_fee_waived ? `Waived${r.cancellation_fee_waived_reason ? `: ${r.cancellation_fee_waived_reason}` : ''}` : 'Charged'} />
                        </div>
                      : <p className="text-xs text-text-muted py-2">No fee applied.</p>}
                  </div>
                )}
              </div>
            )}

            {tab === 'activity' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-xs font-semibold text-text-secondary mb-2">Chat between rider and driver</h3>
                  {r.messages && r.messages.length > 0 ? (
                    <div className="space-y-2">
                      {r.messages.map(m => {
                        const fromDriver = m.senderType === 'driver'
                        return (
                          <div key={m.id} className={`flex ${fromDriver ? 'justify-end' : 'justify-start'}`}>
                            <div className={`max-w-[80%] rounded-2xl px-3 py-2 ${fromDriver ? 'bg-primary/10' : 'bg-surface-2 border border-border-light'}`}>
                              <p className="text-sm text-text-primary whitespace-pre-wrap break-words">{m.body}</p>
                              <p className="text-[11px] text-text-muted mt-0.5">{fromDriver ? r.driver_name ?? 'Driver' : r.user_name} · {fmtIstTime(new Date(m.createdAt))}</p>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  ) : <p className="text-xs text-text-muted">No messages were sent on this ride.</p>}
                </div>
                {rating && (
                  <div>
                    <h3 className="text-xs font-semibold text-text-secondary mb-2">Ratings</h3>
                    {(r.ratings ?? []).map((x, i) => (
                      <div key={i} className="flex justify-between gap-3 py-1.5 text-sm">
                        <span className="text-text-muted">{x.direction === 'user_to_driver' ? 'Rider rated the driver' : 'Driver rated the rider'}</span>
                        <span className="text-right"><span className="inline-flex items-center gap-0.5 font-semibold text-text-primary">{x.score}<Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" /></span>{x.comment && <span className="block text-xs text-text-muted max-w-[220px]">{x.comment}</span>}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {tab === 'safety' && (
              <div className="space-y-3">
                {r.sos_triggered && (
                  <div className="rounded-xl border border-danger/30 bg-danger-light px-3 py-2.5 text-sm text-danger font-semibold">SOS raised{r.sos_triggered_at ? ` ${ago(r.sos_triggered_at, now)} (${fmtIst(r.sos_triggered_at)})` : ''}</div>
                )}
                {(r.sos_alerts ?? []).map(s => (
                  <Link key={s.id} href="/sos" className="flex items-center justify-between rounded-xl border border-border-light px-3 py-2.5 hover:bg-surface-2">
                    <span className="text-sm text-text-primary capitalize">SOS alert · {s.severity}</span><span className="flex items-center gap-2"><StatusPill status={s.status} /><ExternalLink className="w-3.5 h-3.5 text-text-muted" /></span>
                  </Link>
                ))}
                {(r.disputes ?? []).map(d => (
                  <Link key={d.id} href="/disputes" className="flex items-center justify-between rounded-xl border border-border-light px-3 py-2.5 hover:bg-surface-2">
                    <span className="text-sm text-text-primary capitalize">Dispute · {d.type.replace(/_/g, ' ')}</span><span className="flex items-center gap-2"><StatusPill status={d.status} /><ExternalLink className="w-3.5 h-3.5 text-text-muted" /></span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Who and what is on this ride ── */}
        <aside aria-label="People and notes" className="space-y-4 order-1 lg:order-2 lg:sticky lg:top-4">
          <Card title="People">
            <div className="space-y-4">
              <Person role="Rider" name={r.user_name} phone={r.user_phone} tone="primary" />
              <Person role="Driver" name={r.driver_name} phone={r.driver_phone} tone="muted" href={r.driver_id ? `/drivers/${r.driver_id}` : null}
                extra={r.vehicle_number_plate ? `${r.vehicle_name ?? 'Vehicle'}${r.vehicle_color ? ` · ${r.vehicle_color}` : ''} · ${r.vehicle_number_plate}` : null} />
            </div>
          </Card>

          {needsDriverSignal && (
            <Card title="Last signal" icon={<Navigation className="w-3.5 h-3.5" />}>
              {r.last_position
                ? <div className="flex items-center justify-between gap-3"><p className="text-sm text-text-primary">Driver heard from <strong>{ago(r.last_position.recorded_at, now)}</strong></p>
                    <a href={`https://www.google.com/maps/search/?api=1&query=${r.last_position.lat},${r.last_position.lng}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">Open in Maps<ExternalLink className="w-3 h-3" /></a></div>
                : <p className="text-xs text-text-muted">No location has been recorded for this trip yet.</p>}
            </Card>
          )}

          {r.otp && r.driver_id && (
            <Card title="Trip codes" icon={<KeyRound className="w-3.5 h-3.5" />}>
              <div className="divide-y divide-border-light">
                <OtpLine label="Start code" otp={r.otp.trip_start} />
                <OtpLine label="End code" otp={r.otp.trip_end} />
              </div>
            </Card>
          )}

          <Notes rideId={rideId} notes={r.notes ?? []} onAdded={() => load(true)} />
        </aside>
      </div>

      <ReasonDialog
        open={resolveTarget !== null}
        title={resolveTarget === 'cancel' ? `Force cancel ride #${rideId}?` : `Force complete ride #${rideId}?`}
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
