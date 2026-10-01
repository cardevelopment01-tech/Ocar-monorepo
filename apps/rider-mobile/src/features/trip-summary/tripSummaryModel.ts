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

export type InvoiceRow = { key: string; label: string; amount: number; icon: 'tag' | 'navigation' | 'clock' | 'map-pin' | 'watch' | 'plus-circle' | 'trending-up' | 'sliders' }

type InvoiceSource = Pick<RideDetail,
  'baseFare' | 'distanceFare' | 'timeFare' | 'stopFare' | 'hourSurcharge' | 'overageFare' | 'surgeFare' |
  'surgeMultiplier' | 'actualKm' | 'actualMin' | 'totalFinal' | 'totalEstimated'>
// Only components that were actually charged (> 0), each labelled with its quantity. If the
// components do not add up to the total, a single "Adjustments" row makes up the gap so the
// page never shows an invoice that silently disagrees with its own total.
export function buildInvoiceRows(r: InvoiceSource): { rows: InvoiceRow[]; total: number; isEstimate: boolean } {
  const isEstimate = r.totalFinal == null
  const total = num(isEstimate ? r.totalEstimated : r.totalFinal)
  const km = num(r.actualKm)
  const min = Math.round(num(r.actualMin))
  const surge = num(r.surgeMultiplier)

  const candidates: InvoiceRow[] = [
    { key: 'base', icon: 'tag', label: 'Base fare', amount: num(r.baseFare) },
    { key: 'distance', icon: 'navigation', label: km > 0 ? `Distance · ${km} km` : 'Distance', amount: num(r.distanceFare) },
    { key: 'time', icon: 'clock', label: min > 0 ? `Time · ${min} min` : 'Time', amount: num(r.timeFare) },
    { key: 'stops', icon: 'map-pin', label: 'Extra stops', amount: num(r.stopFare) },
    { key: 'hours', icon: 'watch', label: 'Hourly package', amount: num(r.hourSurcharge) },
    { key: 'overage', icon: 'plus-circle', label: 'Extra distance / time', amount: num(r.overageFare) },
    { key: 'surge', icon: 'trending-up', label: surge > 1 ? `Surge · ${surge}x` : 'Surge', amount: num(r.surgeFare) },
  ]
  const rows = candidates.filter((c) => c.amount > 0)
  const gap = Math.round((total - rows.reduce((s, c) => s + c.amount, 0)) * 100) / 100
  // Sub-rupee differences are rounding, not something to show a rider as a line item.
  if (Math.abs(gap) >= 1) rows.push({ key: 'adjust', icon: 'sliders', label: 'Adjustments', amount: gap })
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

// "58 min · 28.4 km" -- actuals when the trip ended, falls back to nothing rather than a guess.
export function tripMetrics(r: Pick<RideDetail, 'actualKm' | 'actualMin'>, stopCount: number): string | null {
  const parts: string[] = []
  const min = Math.round(num(r.actualMin))
  const km = num(r.actualKm)
  if (min > 0) parts.push(`${min} min`)
  if (km > 0) parts.push(`${km} km`)
  if (stopCount > 0) parts.push(`${stopCount} ${stopCount === 1 ? 'stop' : 'stops'}`)
  return parts.length ? parts.join(' · ') : null
}
