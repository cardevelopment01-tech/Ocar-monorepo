// Pure logic for advance bookings in the rider app: what to tell the rider, and what to refuse. No React Native imports, so it is unit tested.

export type LateCancelTerms = { windowMin: number; mode: 'percent' | 'flat'; percent: number; cap: number; flat: number }

/** GET /rides/advance-policy */
export type AdvanceTerms = {
  searchLeadMin: number
  minAheadMin: number
  maxAheadDays: number
  rescheduleMax: number
  lateCancel: LateCancelTerms | null
}

/** GET /rides/:id/cancel-preview */
export type CancelPreview = {
  canCancel: boolean
  status: string
  fee: number
  reason: 'none' | 'late_cancel' | 'arrived'
  freeUntil: string | null
  windowMin: number | null
}

/** Shown until the terms load, or if they cannot be loaded: the numbers the server has always used. */
export const FALLBACK_TERMS: AdvanceTerms = { searchLeadMin: 15, minAheadMin: 60, maxAheadDays: 7, rescheduleMax: 3, lateCancel: null }

const clock = (d: Date) => d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }).replace(/\s+/g, ' ').toLowerCase()
const inr = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`

/** "1 hour", "45 minutes", "1 hour 30 minutes" */
export function minutesText(min: number): string {
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'}`
  const h = Math.floor(min / 60); const m = min % 60
  return `${h} hour${h === 1 ? '' : 's'}${m ? ` ${m} minute${m === 1 ? '' : 's'}` : ''}`
}

/** When we start looking for a driver for this pickup. */
export function searchStartsAt(pickupIso: string, leadMin: number): Date {
  return new Date(new Date(pickupIso).getTime() - leadMin * 60_000)
}

/** The lines under the schedule picker: what happens, and what it costs to change your mind. Fee line only when an admin has turned it on. */
export function termsLines(terms: AdvanceTerms, pickupIso?: string): string[] {
  const lines: string[] = []
  lines.push(pickupIso
    ? `We start finding your driver at ${clock(searchStartsAt(pickupIso, terms.searchLeadMin))}. You can change the time for free until then.`
    : `We start finding your driver ${minutesText(terms.searchLeadMin)} before pickup. You can change the time for free until then.`)
  lines.push('The final fare is confirmed when the search starts and may differ a little from this estimate.')
  const lc = terms.lateCancel
  if (lc) {
    const how = lc.mode === 'flat' ? `${inr(lc.flat)}` : `${lc.percent}% of the fare${lc.cap > 0 ? `, up to ${inr(lc.cap)}` : ''}`
    lines.push(`Cancelling within ${minutesText(lc.windowMin)} of pickup, after a driver has accepted, costs ${how}. Earlier is free.`)
  }
  return lines
}

/** Why a picked pickup time is not allowed, or null. Mirrors the server (which stays the judge). */
export function pickupProblem(when: Date, terms: AdvanceTerms, now = Date.now()): string | null {
  if (Number.isNaN(when.getTime())) return 'Pick a date and time.'
  if (when.getTime() < now + terms.minAheadMin * 60_000) return `Pick a time at least ${minutesText(terms.minAheadMin)} from now.`
  if (when.getTime() > now + terms.maxAheadDays * 86_400_000) return `You can book up to ${terms.maxAheadDays} days ahead.`
  return null
}

/** The earliest and latest times the picker should allow. */
export function pickupBounds(terms: AdvanceTerms, now = Date.now()): { min: Date; max: Date } {
  // One minute of slack: a time picked at exactly the minimum would be refused by the time it reaches the server.
  return { min: new Date(now + (terms.minAheadMin + 1) * 60_000), max: new Date(now + terms.maxAheadDays * 86_400_000) }
}

/** The headline and the detail for the cancel confirmation. */
export function cancelCopy(p: CancelPreview): { title: string; body: string; confirm: string; fee: number } {
  if (p.fee > 0) {
    const why = p.reason === 'arrived'
      ? 'Your driver has arrived at your pickup point.'
      : `A driver has accepted and your pickup is within ${p.windowMin ? minutesText(p.windowMin) : 'the free-cancellation window'}.`
    return { title: `Cancelling costs ${inr(p.fee)}`, body: `${why} The fee goes towards your driver's time.`, confirm: `Cancel and pay ${inr(p.fee)}`, fee: p.fee }
  }
  if (p.freeUntil && new Date(p.freeUntil).getTime() > Date.now()) {
    return { title: 'Cancel this ride?', body: `It is free to cancel until ${clock(new Date(p.freeUntil))}.`, confirm: 'Cancel ride', fee: 0 }
  }
  return { title: 'Cancel this ride?', body: 'You will not be charged.', confirm: 'Cancel ride', fee: 0 }
}

/** A short, plain message for a failed reschedule, from the API's code. */
export function rescheduleErrorMessage(code: string | undefined, fallback: string): string {
  switch (code) {
    case 'RESCHEDULE_LIMIT': return 'You have used all the time changes for this booking. Cancel and book again if you need another time.'
    case 'NOT_RESCHEDULABLE': return 'We have already started looking for your driver, so the time can no longer be changed.'
    default: return fallback
  }
}

/** What the upcoming card says about the ride's state, in one line. */
export function upcomingStatusLine(scheduledForIso: string, terms: AdvanceTerms, now = Date.now()): string {
  const start = searchStartsAt(scheduledForIso, terms.searchLeadMin)
  if (start.getTime() > now) return `Driver search starts at ${clock(start)}`
  return 'Finding your driver'
}
