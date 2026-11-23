import type { AdminRideDetail, AdminRideItem } from './admin-api'
import { fmtDuration } from './dispatch-model'
import { fmtIst, fmtIstTime } from './ist'

// What a ride MEANS, in plain words, worked out from its own data: the line a support person reads first, the few numbers that matter,
// and which tabs have something to show. Pure functions of the ride and the clock, so they are tested without a screen.
// The row from the list and the full detail are both accepted: the drawer shows what it has the moment it opens, and sharpens as the detail loads.

export type RideLike = AdminRideItem & Partial<AdminRideDetail>
export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'
export type Suggested = 'call_driver' | 'call_rider' | 'open_dispatch'

export interface Situation {
  tone: Tone
  headline: string
  /** Supporting facts, most important first. Never empty text. */
  lines: string[]
  /** Contact and next-step actions that fit this state, best first. Destructive actions are never suggested here. */
  suggested: Suggested[]
}

const rupees = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
const num = (v: string | number | null | undefined): number | null => {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) ? n : null
}
const ms = (iso: string | null | undefined): number | null => {
  if (!iso) return null
  const t = new Date(iso).getTime()
  return Number.isNaN(t) ? null : t
}

/** "12m ago", "2h 10m ago"; "just now" under a minute. */
export function ago(iso: string | null | undefined, nowMs: number): string {
  const t = ms(iso)
  if (t === null) return ''
  const d = nowMs - t
  return d < 60_000 ? 'just now' : `${fmtDuration(d)} ago`
}

const ACTOR: Record<string, string> = { user: 'the rider', driver: 'the driver', admin: 'Ocar support', system: 'the system' }
const CHANNEL: Record<string, string> = { cash_direct: 'cash', online_upi: 'UPI', online_card: 'card', platform_wallet: 'wallet', company_qr: 'QR', online_wallet: 'wallet' }
export const channelLabel = (c: string | null | undefined) => (c ? (CHANNEL[c] ?? c.replace(/_/g, ' ')) : null)

const fareOf = (r: RideLike): number | null => num(r.fare)

function offerCounts(offers: AdminRideDetail['offers'] | undefined) {
  const list = offers ?? []
  const n = (s: string) => list.filter(o => o.status === s).length
  return { total: list.length, accepted: n('accepted'), declined: n('declined'), expired: n('expired') }
}

function offerLine(offers: AdminRideDetail['offers'] | undefined): string | null {
  const c = offerCounts(offers)
  if (c.total === 0) return null
  const parts = [c.declined ? `${c.declined} declined` : null, c.expired ? `${c.expired} did not respond` : null, c.accepted ? `${c.accepted} accepted` : null].filter(Boolean)
  return `${c.total} driver${c.total === 1 ? '' : 's'} asked${parts.length ? `: ${parts.join(', ')}` : ''}.`
}

/** The rating the rider gave the driver, if any. */
export function riderRating(r: RideLike): { score: number; comment: string | null } | null {
  const given = (r.ratings ?? []).find(x => x.direction === 'user_to_driver')
  return given ? { score: given.score, comment: given.comment } : null
}

export function tripDurationMs(r: RideLike, nowMs: number): number | null {
  const start = ms(r.started_at)
  if (start === null) return null
  const end = ms(r.completed_at) ?? nowMs
  return Math.max(0, end - start)
}

export function rideSituation(r: RideLike, nowMs: number, opts: { lastSignalAt?: string | null } = {}): Situation {
  const driver = r.driver_name ?? 'The driver'
  const lines: string[] = []
  let tone: Tone = 'neutral'
  let headline = ''
  let suggested: Suggested[] = []
  const fare = fareOf(r)

  switch (r.status) {
    case 'scheduled': {
      tone = 'info'
      const at = ms(r.dispatch_at)
      headline = r.scheduled_for ? `Pickup booked for ${fmtIst(r.scheduled_for)}` : 'Scheduled for later'
      lines.push(at !== null ? `Driver search starts ${at > nowMs ? `in ${fmtDuration(at - nowMs)} (${fmtIstTime(new Date(at))})` : 'now'}.` : 'No driver is assigned yet. Dispatch starts shortly before pickup.')
      suggested = ['open_dispatch', 'call_rider']
      break
    }
    case 'requested': {
      const since = ms(r.dispatch_at) ?? ms(r.requested_at) ?? nowMs
      const waited = Math.max(0, nowMs - since)
      tone = waited > 5 * 60_000 ? 'danger' : 'warning'
      headline = `Looking for a driver${waited >= 60_000 ? ` for ${fmtDuration(waited)}` : ''}`
      const o = offerLine(r.offers); if (o) lines.push(o)
      suggested = ['open_dispatch', 'call_rider']
      break
    }
    case 'no_drivers': {
      tone = 'danger'
      headline = 'No driver accepted this ride'
      lines.push(offerLine(r.offers) ?? 'No driver was offered it: nobody suitable was online nearby.')
      lines.push('The rider has been told. You can still assign a driver from the Dispatch desk.')
      suggested = ['open_dispatch', 'call_rider']
      break
    }
    case 'accepted': {
      tone = 'info'
      headline = `${driver} accepted ${ago(r.accepted_at, nowMs) || 'this ride'} and is on the way`
      suggested = ['call_driver', 'call_rider']
      break
    }
    case 'driver_arrived': {
      tone = 'info'
      headline = `${driver} reached the pickup ${ago(r.driver_arrived_at, nowMs) || ''}`.trim()
      const wait = num(r.pickup_wait_min)
      if (wait !== null && wait > 0) lines.push(`Has waited about ${Math.round(wait)} min at the pickup${r.pickup_free_wait_min != null ? ` (${r.pickup_free_wait_min} free)` : ''}.`)
      suggested = ['call_rider', 'call_driver']
      break
    }
    case 'in_progress':
    case 'returning': {
      const dur = tripDurationMs(r, nowMs)
      if (r.review_flagged_at) {
        tone = 'danger'
        const sig = ms(opts.lastSignalAt)
        headline = sig !== null
          ? `Possibly stuck: no signal from the driver for ${fmtDuration(nowMs - sig)}`
          : `Possibly stuck: flagged ${ago(r.review_flagged_at, nowMs)}${r.review_reason ? ` (${r.review_reason.replace(/_/g, ' ')})` : ''}`
        if (dur !== null) lines.push(`The trip has been running for ${fmtDuration(dur)}.`)
        lines.push('Try the driver first. If you cannot reach them, resolve the ride from More.')
        suggested = ['call_driver', 'call_rider']
      } else {
        tone = 'info'
        headline = dur !== null ? `Trip in progress for ${fmtDuration(dur)}` : 'Trip in progress'
        const est = num(r.estimated_min)
        if (est !== null) lines.push(`Booked for about ${Math.round(est)} min.`)
        suggested = ['call_driver', 'call_rider']
      }
      break
    }
    case 'completed': {
      tone = 'success'
      const dur = tripDurationMs(r, nowMs)
      // Only a measured distance is stated as fact; the booked estimate is marked with a tilde.
      const driven = num(r.actual_km)
      const km = driven ?? num(r.estimated_km)
      headline = `Completed${dur !== null ? ` in ${fmtDuration(dur)}` : ''}${km !== null ? ` · ${driven === null ? '~' : ''}${km.toFixed(1)} km` : ''}`
      const pay = [fare !== null ? rupees(fare) : null, r.payment_status ? (r.payment_status === 'paid' ? `paid${channelLabel(r.payment_channel) ? ` by ${channelLabel(r.payment_channel)}` : ''}` : r.payment_status.replace(/_/g, ' ')) : null].filter(Boolean).join(' ')
      if (pay) lines.push(pay.charAt(0).toUpperCase() + pay.slice(1) + '.')
      const rating = riderRating(r)
      if (rating) lines.push(`Rider rated the driver ${rating.score}★${rating.comment ? `: “${rating.comment}”` : ''}.`)
      suggested = ['call_rider', 'call_driver']
      break
    }
    case 'cancelled': {
      tone = 'neutral'
      const by = ACTOR[r.cancellation_actor ?? ''] ?? 'someone'
      headline = `Cancelled by ${by}`
      const reason = r.cancellation_reason ?? (r.cancellation_reason_code ? r.cancellation_reason_code.replace(/_/g, ' ') : null)
      if (reason) lines.push(`Reason: ${reason.charAt(0).toUpperCase() + reason.slice(1)}.`)
      const fee = num(r.cancellation_fee_amount)
      if (r.cancellation_fee_applicable && fee !== null && fee > 0) {
        lines.push(r.cancellation_fee_waived ? `A ${rupees(fee)} fee was waived${r.cancellation_fee_waived_reason ? `: ${r.cancellation_fee_waived_reason}` : ''}.` : `${rupees(fee)} cancellation fee charged.`)
        if (!r.cancellation_fee_waived) tone = 'warning'
      } else lines.push('No fee charged.')
      suggested = ['call_rider']
      break
    }
    default:
      headline = r.status.replace(/_/g, ' ')
  }

  // Overlays: a safety alert or a money mismatch outranks the ordinary state.
  if (r.sos_triggered) {
    tone = 'danger'
    lines.unshift(`SOS raised${r.sos_triggered_at ? ` ${ago(r.sos_triggered_at, nowMs)}` : ''}. Check the Safety tab.`)
  }
  if (r.cash_discrepancy) {
    if (tone !== 'danger') tone = 'warning'
    const got = num(r.cash_collected_amount) ?? 0
    lines.push(`Cash mismatch: the driver collected ${rupees(got)}${fare !== null ? ` against a ${rupees(fare)} fare` : ''}.`)
  }
  if (lines.length === 0) lines.push(' ')
  return { tone, headline, lines: lines.filter(l => l.trim() !== ''), suggested }
}

export interface KeyFact { label: string; value: string; hint?: string; tone?: 'danger' | 'muted' }

/** The handful of numbers that matter, only those the ride actually has. */
export function keyFacts(r: RideLike, nowMs: number): KeyFact[] {
  const out: KeyFact[] = []
  const fare = fareOf(r)
  if (fare !== null) {
    const paid = r.payment_status === 'paid'
    out.push({ label: 'Fare', value: rupees(fare), hint: r.status === 'completed' || r.status === 'cancelled' ? (paid ? 'paid' : r.payment_status ? r.payment_status.replace(/_/g, ' ') : undefined) : 'estimate' })
  }
  const actual = num(r.actual_km)
  const est = num(r.estimated_km)
  if (actual !== null) out.push({ label: 'Distance', value: `${actual.toFixed(1)} km`, hint: 'driven' })
  else if (est !== null) out.push({ label: 'Distance', value: `${est.toFixed(1)} km`, hint: 'estimated' })
  const dur = tripDurationMs(r, nowMs)
  if (dur !== null) out.push({ label: 'Duration', value: fmtDuration(dur), hint: r.completed_at ? 'trip time' : 'so far' })
  else {
    const m = num(r.estimated_min)
    if (m !== null) out.push({ label: 'Duration', value: `~${Math.round(m)} min`, hint: 'estimated' })
  }
  if (r.cash_discrepancy) out.push({ label: 'Payment', value: 'Cash mismatch', tone: 'danger' })
  else if (r.payment_status || r.payment_channel) out.push({ label: 'Payment', value: channelLabel(r.payment_channel) ? `${channelLabel(r.payment_channel)}`.replace(/^./, c => c.toUpperCase()) : (r.payment_status ?? '').replace(/_/g, ' '), hint: r.payment_status ? r.payment_status.replace(/_/g, ' ') : undefined })
  return out.slice(0, 4)
}

export type TabId = 'overview' | 'money' | 'activity' | 'safety'
export interface TabInfo { id: TabId; label: string; /** A red dot: something here needs attention. */ alert?: boolean; count?: number }

/** Which tabs to show. A tab with nothing to say is not shown at all. */
export function tabsFor(r: RideLike): TabInfo[] {
  const safetyItems = (r.sos_alerts?.length ?? 0) + (r.disputes?.length ?? 0) + (r.sos_triggered ? 1 : 0)
  const chat = r.messages?.length ?? 0
  const tabs: TabInfo[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'money', label: 'Money', ...(r.cash_discrepancy ? { alert: true } : {}) },
    { id: 'activity', label: 'Activity', ...(chat > 0 ? { count: chat } : {}) },
  ]
  if (safetyItems > 0 || r.sos_triggered) tabs.push({ id: 'safety', label: 'Safety', alert: true })
  return tabs
}

/** Plain text a support person can paste into a reply or a chat: the ride in a few lines. */
export function rideSummaryText(r: RideLike, nowMs: number, link?: string): string {
  const s = rideSituation(r, nowMs)
  const fare = fareOf(r)
  const lines = [
    `Ride #${r.id} · ${r.status.replace(/_/g, ' ')}${r.category_name ? ` · ${r.category_name}` : ''}`,
    `Rider: ${r.user_name ?? '—'} ${r.user_phone}`.trim(),
    `Driver: ${r.driver_name ? `${r.driver_name} ${r.driver_phone ?? ''}`.trim() : 'not assigned'}`,
    `Route: ${r.origin_address ?? '—'} → ${r.destination_address ?? 'no fixed destination'}`,
    ...(fare !== null ? [`Fare: ${rupees(fare)}`] : []),
    `Requested: ${fmtIst(r.requested_at, true)}`,
    `Status: ${s.headline}${s.lines.length ? '. ' + s.lines.join(' ') : ''}`,
    ...(link ? [link] : []),
  ]
  return lines.join('\n')
}

/** What each forced outcome really does, from api/src/modules/rides/rides.service.ts forceResolveRide. Shown before the reason box. */
export const FORCE_CONSEQUENCE = {
  complete: 'Ends the trip as completed now. Stops the driver did not finish are skipped. The fare is finalised at the booked estimate plus any waiting and toll, and payment is settled as normal. Distance is not re-measured.',
  cancel: 'Ends the trip as cancelled and frees the driver. The rider is not charged a fare or a cancellation fee, and any offer they used is given back.',
} as const

export interface TimelineEvent { label: string; ts: string; actor: string | null; note: string | null; /** Minutes since the previous event, for the "+5m" shown beside it. */ gapMin: number | null }

/** Every status change in order, with who did it and the pause before it. Falls back to the ride's own timestamps for steps the history did not record. */
export function timelineEvents(r: RideLike): TimelineEvent[] {
  const history = r.status_history ?? []
  const logged = new Set(history.map(e => e.to_status))
  const fromHistory = history.map(e => ({ label: e.to_status.replace(/_/g, ' '), ts: e.created_at, actor: e.actor as string | null, note: e.note }))
  const fromFlat = [
    { label: 'requested', ts: r.requested_at, status: 'requested' }, { label: 'accepted', ts: r.accepted_at, status: 'accepted' },
    { label: 'driver arrived', ts: r.driver_arrived_at, status: 'driver_arrived' }, { label: 'trip started', ts: r.started_at, status: 'in_progress' },
    { label: 'completed', ts: r.completed_at, status: 'completed' },
  ].filter(x => x.ts && !logged.has(x.status)).map(x => ({ label: x.label, ts: x.ts as string, actor: null as string | null, note: null as string | null }))
  const all = [...fromHistory, ...fromFlat].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())
  return all.map((e, i) => ({ ...e, gapMin: i === 0 ? null : Math.round((new Date(e.ts).getTime() - new Date(all[i - 1]!.ts).getTime()) / 60_000) }))
}
