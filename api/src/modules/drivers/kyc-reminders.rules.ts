// Which onboarding reminder (1, 2 or 3) a stalled driver is due, if any. Pure: the sweep supplies the clock, the driver's last progress time,
// how many reminders went out since that progress, and the admin settings. Day numbers count from the last progress.
//
// A driver who stalled so long ago that they were already past the pause day before any reminder reached them (reminders switched on later) gets a
// "catch-up" cycle when that setting is on: the same three reminders at the same spacing, counted from the first one instead of from their last
// step, so the experience is identical to a newer driver's.
export interface ReminderInput {
  now: Date
  lastProgressAt: Date
  sentSinceProgress: number
  enabled: boolean
  days: [number, number, number]
  /** From this day on the application is paused: no more messages. */
  pauseDay: number
  /** The first reminder sent after the driver's last progress, if any. */
  firstSentAt?: Date | null
  /** Setting: also remind drivers who were already past the pause day before any reminder reached them. */
  catchUp?: boolean
}

const DAY_MS = 86_400_000

export interface ReminderCycle {
  /** The moment the day count starts from: the last step, or for a catch-up cycle its first reminder. */
  anchor: Date
  /** Days already counted at the anchor: the first reminder's day for a catch-up cycle (it is due at once), else 0. */
  shift: number
  catchUp: boolean
}

export function reminderCycle(i: Pick<ReminderInput, 'now' | 'lastProgressAt' | 'days' | 'pauseDay' | 'firstSentAt' | 'catchUp'>): ReminderCycle {
  const elapsed = (i.now.getTime() - i.lastProgressAt.getTime()) / DAY_MS
  const first = i.firstSentAt ?? null
  // A normal first reminder is always sent before the pause day, so one sent at or after it can only belong to a catch-up cycle.
  if (first !== null && (first.getTime() - i.lastProgressAt.getTime()) / DAY_MS >= i.pauseDay) return { anchor: first, shift: i.days[0], catchUp: true }
  if (first === null && elapsed >= i.pauseDay && i.catchUp) return { anchor: i.now, shift: i.days[0], catchUp: true }
  return { anchor: i.lastProgressAt, shift: 0, catchUp: false }
}

/** When the application pauses for this cycle: the pause day counted from the anchor (less the days a catch-up cycle starts with). */
export function pausesAt(c: ReminderCycle, pauseDay: number): Date {
  return new Date(c.anchor.getTime() + (pauseDay - c.shift) * DAY_MS)
}

export function nextReminder(i: ReminderInput): 1 | 2 | 3 | null {
  if (!i.enabled) return null
  const c = reminderCycle(i)
  if (c.catchUp && !i.catchUp) return null // switched off part way: the cycle stops
  const elapsed = (i.now.getTime() - c.anchor.getTime()) / DAY_MS + c.shift
  if (elapsed >= i.pauseDay) return null
  // The earliest unsent reminder that is due: a late sweep sends one message, the next sweep the next one.
  const k = i.sentSinceProgress
  if (k >= 3) return null
  return elapsed >= i.days[k]! ? ((k + 1) as 1 | 2 | 3) : null
}
