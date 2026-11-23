import type { DispatchRow } from './dispatch-api'

// What the dispatch desk shows for a ride, as plain functions of the row and the clock so they can be tested without a screen.

/** Mirrors the API (MANUAL_ASSIGN_REQUEST_TIMEOUT_SECONDS / FORCE_ASSIGN_GRACE_MINUTES in api/src/constants/limits.ts); shown to the admin in the mode descriptions. */
export const ASK_TIMEOUT_SECONDS = 30
export const BOOK_GRACE_MINUTES = 4
/** A scheduled ride still waiting this long after its dispatch time means the sweep missed it. Same number the API's summary uses. */
export const OVERDUE_MINUTES = 5
/** Assigning an advance booking more than this long before its automatic dispatch pulls it forward; the panel says so. */
export const EARLY_ASSIGN_MINUTES = 10

const MIN = 60_000

/** "under 1m", "12m", "2h 10m", "3d 4h": coarse on purpose, a countdown is not a stopwatch. */
export function fmtDuration(ms: number): string {
  const abs = Math.abs(ms)
  if (abs < MIN) return 'under 1m'
  const mins = Math.floor(abs / MIN)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return mins % 60 ? `${hours}h ${mins % 60}m` : `${hours}h`
  const days = Math.floor(hours / 24)
  return hours % 24 ? `${days}d ${hours % 24}h` : `${days}d`
}

export type DispatchTone = 'muted' | 'info' | 'warning' | 'danger'
export interface DispatchState {
  kind: 'scheduled' | 'due_soon' | 'dispatching' | 'overdue' | 'searching' | 'no_drivers'
  label: string
  tone: DispatchTone
}

export function dispatchState(r: Pick<DispatchRow, 'status' | 'dispatch_at'>, nowMs: number): DispatchState {
  const at = new Date(r.dispatch_at).getTime()
  const diff = at - nowMs // positive: dispatch is still ahead
  if (r.status === 'scheduled') {
    if (diff <= -OVERDUE_MINUTES * MIN) return { kind: 'overdue', label: `Overdue by ${fmtDuration(diff)}`, tone: 'danger' }
    if (diff <= 0) return { kind: 'dispatching', label: 'Dispatching now', tone: 'info' }
    if (diff <= 60 * MIN) return { kind: 'due_soon', label: `Dispatches in ${fmtDuration(diff)}`, tone: 'info' }
    return { kind: 'scheduled', label: `Dispatches in ${fmtDuration(diff)}`, tone: 'muted' }
  }
  const waited = Math.max(0, nowMs - at)
  if (r.status === 'requested') return { kind: 'searching', label: `Searching for ${fmtDuration(waited)}`, tone: waited > 5 * MIN ? 'danger' : 'warning' }
  return { kind: 'no_drivers', label: `No drivers, ${fmtDuration(waited)} ago`, tone: 'danger' }
}

/** "in 2h 10m" / "5m ago" for a moment in the past or future. */
export function relativeTo(iso: string, nowMs: number): string {
  const diff = new Date(iso).getTime() - nowMs
  return diff >= 0 ? `in ${fmtDuration(diff)}` : `${fmtDuration(diff)} ago`
}

/**
 * Assigning an advance booking before its dispatch time is not a reservation: it opens the ride for dispatch immediately and the driver
 * must be online right now. Returns the sentence to show, or null when assigning is the normal thing to do.
 */
export function earlyAssignWarning(r: Pick<DispatchRow, 'status' | 'dispatch_at' | 'scheduled_for'>, nowMs: number): string | null {
  if (r.status !== 'scheduled') return null
  const ahead = new Date(r.dispatch_at).getTime() - nowMs
  if (ahead <= EARLY_ASSIGN_MINUTES * MIN) return null
  return `This ride is not due to dispatch for ${fmtDuration(ahead)}. Assigning now opens it for dispatch immediately, and the driver has to be online right now. Unless the pickup is close, automatic dispatch at the usual time is usually the better choice.`
}

/** Sort key for "needs a person first" ordering when rows from both lanes are mixed (not used by the API, which orders per lane). */
export function urgencyRank(s: DispatchState['kind']): number {
  return { overdue: 0, no_drivers: 1, searching: 2, dispatching: 3, due_soon: 4, scheduled: 5 }[s]
}
