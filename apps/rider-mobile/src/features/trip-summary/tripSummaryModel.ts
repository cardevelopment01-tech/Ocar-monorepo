import type { RideDetail } from '@ocar/mobile-shared'

// Pure logic behind the Trip summary screen, kept out of the component so it is unit-testable.

const num = (v: string | number | null | undefined): number => {
  if (v == null) return 0
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) ? n : 0
}

// One money format for the whole screen (hero, invoice, cash strip, rate screen): whole rupees
// drop the decimals, paise keep two, Indian grouping. Fixes "₹1480.00" next to "₹1480".
export function formatMoney(value: string | number | null | undefined): string {
  const n = num(value)
  const whole = Math.abs(n - Math.round(n)) < 0.005
  return `₹${n.toLocaleString('en-IN', whole ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// `detail` is the quiet second line under the label (quantity, rate); the label itself stays a plain noun.
export type InvoiceRow = { key: string; label: string; detail?: string; amount: number }

type InvoiceSource = Pick<RideDetail,
  'baseFare' | 'distanceFare' | 'timeFare' | 'stopFare' | 'hourSurcharge' | 'overageFare' | 'surgeFare' |
  'surgeMultiplier' | 'actualKm' | 'actualMin' | 'totalFinal' | 'totalEstimated'> &
  Partial<Pick<RideDetail, 'tripHours' | 'waitingFare' | 'overtimeMin' | 'overtimeFare' | 'overtimeGraceMin'>>

// Only components that were actually charged (> 0), each labelled with its quantity. If the
// components do not add up to the total, a single "Adjustments" row makes up the gap so the
// page never shows an invoice that silently disagrees with its own total.
export function buildInvoiceRows(r: InvoiceSource): { rows: InvoiceRow[]; total: number; isEstimate: boolean } {
  const isEstimate = r.totalFinal == null
  const total = num(isEstimate ? r.totalEstimated : r.totalFinal)
  const km = num(r.actualKm)
  const min = Math.round(num(r.actualMin))
  const surge = num(r.surgeMultiplier)

  const grace = r.overtimeGraceMin
  const candidates: InvoiceRow[] = [
    { key: 'base', label: 'Base fare', amount: num(r.baseFare) },
    { key: 'distance', label: 'Distance', ...(km > 0 && { detail: `${km} km` }), amount: num(r.distanceFare) },
    { key: 'time', label: 'Time', ...(min > 0 && { detail: `${min} min` }), amount: num(r.timeFare) },
    { key: 'stops', label: 'Extra stops', amount: num(r.stopFare) },
    { key: 'hours', label: 'Hourly package', amount: num(r.hourSurcharge) },
    // Hourly round trips: the booked hours are their own line, otherwise they would surface as an unexplained adjustment.
    { key: 'booked', label: 'Booked time', ...(r.tripHours && { detail: `${r.tripHours} ${r.tripHours === 1 ? 'hour' : 'hours'}` }), amount: num(r.waitingFare) },
    { key: 'overage', label: 'Extra distance or time', amount: num(r.overageFare) },
    { key: 'surge', label: 'Surge', ...(surge > 1 && { detail: `${surge}x` }), amount: num(r.surgeFare) },
    // After surge: overtime is not surged. Only present once the trip settled with time past the booked window.
    { key: 'overtime', label: 'Extra time', detail: `${num(r.overtimeMin)} min${grace ? `, after ${grace} free minutes` : ''}`, amount: (r.overtimeMin ?? 0) > 0 ? num(r.overtimeFare) : 0 },
  ]
  const rows = candidates.filter((c) => c.amount > 0)
  const gap = Math.round((total - rows.reduce((s, c) => s + c.amount, 0)) * 100) / 100
  // Sub-rupee differences are rounding, not something to show a rider as a line item.
  if (Math.abs(gap) >= 1) rows.push({ key: 'adjust', label: 'Adjustments', amount: gap })
  return { rows, total, isEstimate }
}

export type PaymentState =
  | { kind: 'cash_due'; text: string }
  | { kind: 'paid'; text: string }

export function paymentState(
  r: Pick<RideDetail, 'totalFinal' | 'totalEstimated'> & { paymentChannel: string | null; cashCollectedAt: string | null },
): PaymentState {
  const channel = r.paymentChannel ?? 'cash'
  if (channel === 'cash') {
    return r.cashCollectedAt
      ? { kind: 'paid', text: 'Paid in cash' }
      : { kind: 'cash_due', text: `Pay ${formatMoney(r.totalFinal ?? r.totalEstimated)} cash to your driver` }
  }
  return { kind: 'paid', text: channel === 'wallet' ? 'Paid via wallet' : 'Paid online' }
}

const rideTypeLabels: Record<string, string> = { round_trip: 'Round trip', rental: 'Rental' }

export function formatTripWhen(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const date = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
  const time = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true })
  return `${date} · ${time.toUpperCase()}`
}

export function tripTitle(r: Pick<RideDetail, 'rideType' | 'assignedCategoryName' | 'bookedCategoryName'>): string {
  const cat = r.assignedCategoryName ?? r.bookedCategoryName
  const type = rideTypeLabels[r.rideType]
  return [cat, type].filter(Boolean).join(' · ') || 'Ride'
}

// "58 min · 28.4 km". Actuals when the trip settled them; otherwise the duration from the ride's own
// start/finish times (one-way rides never get actuals). No stop count: the stops are listed right above.
export function tripMetrics(r: Pick<RideDetail, 'actualKm' | 'actualMin' | 'startedAt' | 'completedAt'>): string | null {
  const parts: string[] = []
  let min = Math.round(num(r.actualMin))
  if (min <= 0 && r.startedAt && r.completedAt) {
    min = Math.round((new Date(r.completedAt).getTime() - new Date(r.startedAt).getTime()) / 60000)
  }
  const km = num(r.actualKm)
  if (Number.isFinite(min) && min > 0) parts.push(`${min} min`)
  if (km > 0) parts.push(`${km} km`)
  return parts.length ? parts.join(' · ') : null
}

export type TimelineStep = { key: string; time: string; label: string; note?: string }

const clock = (d: Date) =>
  d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase()

// Only hourly round trips that ran past the booked window get a breakdown. The start is derived
// (booked end minus booked hours) because the ride payload carries the window end, not the start.
export function buildTimeline(
  r: Pick<RideDetail, 'tripHours' | 'startedAt' | 'bookedUntil' | 'overtimeMin' | 'overtimeGraceMin' | 'overtimeRate' | 'completedAt'>,
): TimelineStep[] | null {
  if (!r.bookedUntil || !r.tripHours || !r.completedAt || (r.overtimeMin ?? 0) <= 0) return null
  const end = new Date(r.bookedUntil)
  const done = new Date(r.completedAt)
  if (Number.isNaN(end.getTime()) || Number.isNaN(done.getTime())) return null
  const grace = r.overtimeGraceMin ?? 0
  const start = r.startedAt ? new Date(r.startedAt) : new Date(end.getTime() - r.tripHours * 3_600_000)
  const extraStart = new Date(end.getTime() + grace * 60_000)
  return [
    { key: 'start', time: clock(start), label: 'Trip started' },
    { key: 'booked', time: clock(end), label: 'Booked time ended', ...(grace > 0 && { note: `${grace} free minutes` }) },
    { key: 'extra', time: clock(extraStart), label: 'Extra time started', ...(r.overtimeRate ? { note: `${formatMoney(r.overtimeRate)} an hour` } : {}) },
    { key: 'done', time: clock(done), label: 'Trip ended', note: `${r.overtimeMin} min extra` },
  ]
}
