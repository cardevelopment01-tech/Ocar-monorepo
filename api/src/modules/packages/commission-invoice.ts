// Pure rules for the consolidated commission invoice (no I/O, unit-tested).
//
// Ocar deducts commission from a driver's wallet on every ride, and the amount cut already includes the GST. A driver therefore gets one
// invoice per period for everything cut in it, with the tax backed out of the total, and the rides listed as an annexure. The GST is worked
// out on the period total, never added up from per-ride rounded amounts, so the paise cannot drift.

const IST_OFFSET_MS = 5.5 * 3_600_000
const DAY_MS = 86_400_000

export type InvoiceFrequency = 'monthly' | 'weekly'

export interface InvoicePeriod {
  /** First instant of the period (00:00 IST), inclusive. */
  start: Date
  /** First instant after the period (00:00 IST of the next day), exclusive. */
  end: Date
  /** First and last day of the period as IST dates, 'YYYY-MM-DD'. */
  startDate: string
  endDate: string
  /** 'November 2026' or '9 Nov to 15 Nov 2026'. */
  label: string
}

/** Anything other than 'weekly' is monthly: a mistyped setting must not stop invoicing. */
export function parseFrequency(v: string | null | undefined): InvoiceFrequency {
  return (v ?? '').trim().toLowerCase() === 'weekly' ? 'weekly' : 'monthly'
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const iso = (istMidnightUtcMs: number) => new Date(istMidnightUtcMs).toISOString().slice(0, 10)
// An IST wall-clock midnight, held as the UTC timestamp whose date parts read as that date, becomes the real instant by subtracting the offset.
const toInstant = (istWallMs: number) => new Date(istWallMs - IST_OFFSET_MS)

function period(startWallMs: number, endWallMs: number, label: string): InvoicePeriod {
  return { start: toInstant(startWallMs), end: toInstant(endWallMs), startDate: iso(startWallMs), endDate: iso(endWallMs - DAY_MS), label }
}

/**
 * The most recent `count` periods that have fully ended by `now` (IST), newest first. Monthly: whole calendar months. Weekly: Monday to Sunday.
 * The sweep runs daily and looks back over a few of these, so a missed day (an outage, or the first deploy) heals itself.
 */
export function closedPeriods(now: Date, frequency: InvoiceFrequency, count: number): InvoicePeriod[] {
  const ist = new Date(now.getTime() + IST_OFFSET_MS)
  const y = ist.getUTCFullYear(), m = ist.getUTCMonth()
  const out: InvoicePeriod[] = []
  if (frequency === 'monthly') {
    for (let i = 1; i <= count; i++) {
      const start = Date.UTC(y, m - i, 1), end = Date.UTC(y, m - i + 1, 1)
      const s = new Date(start)
      out.push(period(start, end, `${MONTHS[s.getUTCMonth()]} ${s.getUTCFullYear()}`))
    }
    return out
  }
  const today = Date.UTC(y, m, ist.getUTCDate())
  const mondayThisWeek = today - ((ist.getUTCDay() + 6) % 7) * DAY_MS
  for (let i = 1; i <= count; i++) {
    const start = mondayThisWeek - 7 * i * DAY_MS, end = start + 7 * DAY_MS
    const a = new Date(start), b = new Date(end - DAY_MS)
    const fmt = (d: Date) => `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]!.slice(0, 3)}`
    out.push(period(start, end, `${fmt(a)} to ${fmt(b)} ${b.getUTCFullYear()}`))
  }
  return out
}

/** Backs the tax out of an amount that already includes it: 30 at 18% is 25.42 taxable and 4.58 GST. The two always add back to the amount. */
export function taxFromInclusive(gross: number, gstPercent: number): { taxable: number; gst: number } {
  const grossPaise = Math.round(gross * 100)
  const taxablePaise = Math.round(grossPaise / (1 + gstPercent / 100))
  return { taxable: taxablePaise / 100, gst: (grossPaise - taxablePaise) / 100 }
}

/** What the invoice line says. */
export function commissionDescription(p: Pick<InvoicePeriod, 'label'>, rideCount: number): string {
  return `Platform service fee (commission) on ${rideCount} ${rideCount === 1 ? 'ride' : 'rides'}, ${p.label}`
}
