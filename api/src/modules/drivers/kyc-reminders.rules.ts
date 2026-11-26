// Which onboarding reminder (1, 2 or 3) a stalled driver is due, if any. Pure: the sweep supplies the clock, the driver's last progress time,
// how many reminders went out since that progress, and the admin settings. Day numbers count from the last progress.
export interface ReminderInput {
  now: Date
  lastProgressAt: Date
  sentSinceProgress: number
  enabled: boolean
  days: [number, number, number]
  /** From this day on the application is paused: no more messages. */
  pauseDay: number
}

const DAY_MS = 86_400_000

export function nextReminder(i: ReminderInput): 1 | 2 | 3 | null {
  if (!i.enabled) return null
  const elapsed = (i.now.getTime() - i.lastProgressAt.getTime()) / DAY_MS
  if (elapsed >= i.pauseDay) return null
  // The earliest unsent reminder that is due: a late sweep sends one message, the next sweep the next one.
  const k = i.sentSinceProgress
  if (k >= 3) return null
  return elapsed >= i.days[k]! ? ((k + 1) as 1 | 2 | 3) : null
}
