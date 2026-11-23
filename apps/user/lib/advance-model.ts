// Advance bookings on the rider web app: what to tell the rider, in the same words as the mobile app (apps/rider-mobile/src/features/advance).
// No shared runtime package exists yet (see CLAUDE.md), so update both places together.

export type LateCancelTerms = { windowMin: number; mode: 'percent' | 'flat'; percent: number; cap: number; flat: number }

/** GET /rides/advance-policy */
export type AdvanceTerms = { searchLeadMin: number; minAheadMin: number; maxAheadDays: number; rescheduleMax: number; lateCancel: LateCancelTerms | null }

/** GET /rides/:id/cancel-preview */
export type CancelPreview = { canCancel: boolean; status: string; fee: number; reason: 'none' | 'late_cancel' | 'arrived'; freeUntil: string | null; windowMin: number | null }

export const FALLBACK_TERMS: AdvanceTerms = { searchLeadMin: 15, minAheadMin: 60, maxAheadDays: 7, rescheduleMax: 3, lateCancel: null }

const clock = (d: Date) => d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }).replace(/\s+/g, ' ').toLowerCase()
const inr = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`

export function minutesText(min: number): string {
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'}`
  const h = Math.floor(min / 60); const m = min % 60
  return `${h} hour${h === 1 ? '' : 's'}${m ? ` ${m} minute${m === 1 ? '' : 's'}` : ''}`
}

export function searchStartsAt(pickupIso: string, leadMin: number): Date {
  return new Date(new Date(pickupIso).getTime() - leadMin * 60_000)
}

/** The lines shown with the schedule picker: when search starts, that the fare can move a little, and the late-cancel fee if an admin turned it on. */
export function termsLines(terms: AdvanceTerms): string[] {
  const lines = [
    `We start finding your driver ${minutesText(terms.searchLeadMin)} before pickup. You can change the time for free until then.`,
    'The final fare is confirmed when the search starts and may differ a little from this estimate.',
  ]
  const lc = terms.lateCancel
  if (lc) {
    const how = lc.mode === 'flat' ? inr(lc.flat) : `${lc.percent}% of the fare${lc.cap > 0 ? `, up to ${inr(lc.cap)}` : ''}`
    lines.push(`Cancelling within ${minutesText(lc.windowMin)} of pickup, after a driver has accepted, costs ${how}. Earlier is free.`)
  }
  return lines
}

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

export function rescheduleErrorMessage(code: string | undefined, fallback: string): string {
  switch (code) {
    case 'RESCHEDULE_LIMIT': return 'You have used all the time changes for this booking. Cancel and book again if you need another time.'
    case 'NOT_RESCHEDULABLE': return 'We have already started looking for your driver, so the time can no longer be changed.'
    default: return fallback
  }
}

export function upcomingStatusLine(scheduledForIso: string, terms: AdvanceTerms, now = Date.now()): string {
  const start = searchStartsAt(scheduledForIso, terms.searchLeadMin)
  return start.getTime() > now ? `Driver search starts at ${clock(start)}` : 'Finding your driver'
}
