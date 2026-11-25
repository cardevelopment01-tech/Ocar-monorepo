import type { RideDetail } from '@ocar/mobile-shared'
// Deep path, like clampToRadius: the barrel pulls in React Native, which this pure-logic file (and its test) must not.
import { rentalFareLines } from '@ocar/mobile-shared/src/utils/tripFacts'

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
export type InvoiceRow = { key: string; label: string; detail?: string; amount: number; /** shown as a minus (an offer taken off) */ negative?: boolean }

type InvoiceSource = Pick<RideDetail,
  'baseFare' | 'distanceFare' | 'timeFare' | 'stopFare' | 'hourSurcharge' | 'overageFare' | 'surgeFare' |
  'surgeMultiplier' | 'actualKm' | 'actualMin' | 'totalFinal' | 'totalEstimated'> &
  Partial<Pick<RideDetail, 'tripHours' | 'waitingFare' | 'overtimeMin' | 'overtimeFare' | 'overtimeGraceMin' | 'discountAmount' |
    'pickupWaitMin' | 'pickupFreeWaitMin' | 'pickupWaitCharge' | 'tollCharge' | 'tollDetail' | 'stops' |
    'rideType' | 'overageKm' | 'overageMin' | 'rentalExtraPerKm' | 'rentalExtraPerMin' | 'rentalKmLimit' | 'rentalDurationMinutes'>>

// Only components that were actually charged (> 0), each labelled with its quantity. If the
// components do not add up to the total, a single "Adjustments" row makes up the gap so the
// page never shows an invoice that silently disagrees with its own total.
export function buildInvoiceRows(r: InvoiceSource): { rows: InvoiceRow[]; total: number; isEstimate: boolean; discount: number } {
  const isEstimate = r.totalFinal == null
  // The components add up to the GROSS fare; an offer is taken off afterwards, so the total is what the rider pays.
  const gross = num(isEstimate ? r.totalEstimated : r.totalFinal)
  const discount = Math.min(num(r.discountAmount), gross)
  const total = gross
  const km = num(r.actualKm)
  const min = Math.round(num(r.actualMin))
  const surge = num(r.surgeMultiplier)

  const grace = r.overtimeGraceMin
  const r2 = (n: number) => Math.round(n * 100) / 100
  // Same layout as the PDF receipt (api/.../receipt.model.ts buildFareRows): the trip itself is ONE "Ride fare" line (base, distance,
  // time, extra stops, waiting at pickup, surge); only what is charged on top of it is listed below. The ride fare is the total MINUS
  // those lines, so settlement repricing can never leave a stale component or an "Adjustments" row.
  const rental = rentalFareLines({ ...r, rideType: r.rideType ?? '' })
  const overtime = (r.overtimeMin ?? 0) > 0 ? num(r.overtimeFare) : 0
  const below: InvoiceRow[] = [
    { key: 'toll', label: 'Airport toll', ...(r.tollDetail?.length && { detail: r.tollDetail.map((t) => t.zone).join(', ') }), amount: num(r.tollCharge) },
    ...(rental ? rental.filter((x) => x.key !== 'package') : []),
    // Round trips: the driver's per-day allowance. Not surged on this line; the surge on it stays inside Ride fare.
    { key: 'allowance', label: 'Driver allowance', amount: num(r.hourSurcharge) },
    { key: 'overtime', label: 'Extra time', detail: `${num(r.overtimeMin)} min${grace ? `, after ${grace} free minutes` : ''}`, amount: overtime },
  ].filter((c) => c.amount > 0).map((c) => ({ ...c, amount: r2(c.amount) }))

  const stops = r.stops ?? []
  const charged = stops.filter((s) => num(s.stopChargeApplied) > 0).length
  const extraStops = charged > 0 ? charged : stops.filter((s) => s.status !== 'skipped').length
  const waited = r2(num(r.pickupWaitCharge) + stops.reduce((n, s) => n + num(s.waitCharge), 0))
  const hours = num(r.tripHours)
  const detail = [
    rental?.find((x) => x.key === 'package')?.detail ?? '',
    !rental && km > 0 ? `${r2(km)} km` : '',
    !rental && min > 0 ? `${min} min` : '',
    !rental && hours > 0 ? `${hours} ${hours === 1 ? 'hour' : 'hours'} booked` : '',
    extraStops > 0 ? `${extraStops} ${extraStops === 1 ? 'stop' : 'stops'}` : '',
    surge > 1 ? `${surge}× surge` : '',
    waited > 0 ? `incl. ${formatMoney(waited)} waiting` : '',
  ].filter(Boolean).join(' · ')
  const rideFare = r2(total - below.reduce((n, c) => n + c.amount, 0))
  const rows: InvoiceRow[] = [...(rideFare > 0 ? [{ key: 'ride-fare', label: 'Ride fare', ...(detail ? { detail } : {}), amount: rideFare }] : []), ...below]
  const gap = Math.round((total - rows.reduce((s, c) => s + c.amount, 0)) * 100) / 100
  // Sub-rupee differences are rounding, not something to show a rider as a line item.
  if (Math.abs(gap) >= 1) rows.push({ key: 'adjust', label: 'Adjustments', amount: gap })
  if (discount > 0) rows.push({ key: 'offer', label: 'Offer', amount: discount, negative: true })
  return { rows, total: Math.round((total - discount) * 100) / 100, isEstimate, discount }
}

export type PaymentState =
  | { kind: 'cash_due'; text: string }
  | { kind: 'paid'; text: string }

export function paymentState(
  r: Pick<RideDetail, 'totalFinal' | 'totalEstimated'> & Partial<Pick<RideDetail, 'cashDue'>> & { paymentChannel: string | null; cashCollectedAt: string | null },
): PaymentState {
  const channel = r.paymentChannel ?? 'cash'
  if (channel === 'cash') {
    return r.cashCollectedAt
      ? { kind: 'paid', text: 'Paid in cash' }
      : { kind: 'cash_due', text: `Pay ${formatMoney(r.cashDue ?? r.totalFinal ?? r.totalEstimated)} cash to your driver` }
  }
  return { kind: 'paid', text: channel === 'wallet' ? 'Paid via wallet' : 'Paid online' }
}

// The hourly mode is Rental; a city ride is a one-way ride booked as City ride (trip mode city).
const rideTypeLabels: Record<string, string> = { round_trip: 'Round trip', rental: 'Rental' }

export function formatTripWhen(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const date = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
  const time = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true })
  return `${date} · ${time.toUpperCase()}`
}

export function tripTitle(r: Pick<RideDetail, 'rideType' | 'assignedCategoryName' | 'bookedCategoryName'> & { tripMode?: 'standard' | 'city' }): string {
  const cat = r.assignedCategoryName ?? r.bookedCategoryName
  const type = r.rideType === 'one_way' && r.tripMode === 'city' ? 'City ride' : rideTypeLabels[r.rideType]
  return [cat, type].filter(Boolean).join(' · ') || 'Ride'
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
