// What a finished or ongoing trip looks like to a person: where it went, when it ran, how far, how long,
// and (for rentals) the package price with the extra km and extra time as their own lines. Pure so the rider
// and the driver app show the same numbers, and so it is unit-testable.

const num = (v: string | number | null | undefined): number => {
  if (v == null) return 0
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) ? n : 0
}
const round2 = (n: number) => Math.round(n * 100) / 100

/** Whole rupees drop the decimals, paise keep two, Indian grouping: "₹1,480" / "₹1,480.50". */
export function formatRupees(value: string | number | null | undefined): string {
  const n = num(value)
  const whole = Math.abs(n - Math.round(n)) < 0.005
  return `₹${n.toLocaleString('en-IN', whole ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** "2:35 pm". Null for a missing or unparseable time. */
export function formatTime12h(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase()
}

/** "45 min", "1 h 05 min", "2 h". Whole minutes. */
export function formatDuration(totalMin: number): string {
  const m = Math.round(totalMin)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const r = m % 60
  return r === 0 ? `${h} h` : `${h} h ${String(r).padStart(2, '0')} min`
}

const trimKm = (km: number) => `${round2(km)} km`

export type TripFactsSource = {
  startedAt?: string | null
  completedAt?: string | null
  actualKm?: string | number | null
  actualMin?: string | number | null
}

export type TripFact = { key: 'started' | 'ended' | 'distance' | 'time'; label: string; value: string }

/**
 * Start time, end time, distance run and time taken, only the ones the ride actually has. Time taken
 * prefers the measured actual minutes; one-way rides never get actuals, so it falls back to the gap
 * between the ride's own start and finish.
 */
export function buildTripFacts(r: TripFactsSource): TripFact[] {
  const facts: TripFact[] = []
  const started = formatTime12h(r.startedAt)
  const ended = formatTime12h(r.completedAt)
  if (started) facts.push({ key: 'started', label: 'Started', value: started })
  if (ended) facts.push({ key: 'ended', label: 'Ended', value: ended })

  const km = num(r.actualKm)
  if (km > 0) facts.push({ key: 'distance', label: 'Distance', value: trimKm(km) })

  let min = Math.round(num(r.actualMin))
  if (min <= 0 && r.startedAt && r.completedAt) {
    min = Math.round((new Date(r.completedAt).getTime() - new Date(r.startedAt).getTime()) / 60000)
  }
  if (Number.isFinite(min) && min > 0) facts.push({ key: 'time', label: 'Time taken', value: formatDuration(min) })
  return facts
}

export type DropSource = {
  rideType: string
  destinationAddress?: string | null
  tripHours?: number | null
}

/**
 * The drop line for a trip. A rental books a real drop-off location, so it shows that address like any other
 * trip; the package is a quiet caption, never a stand-in for the address.
 */
export function dropDisplay(r: DropSource): { label: string; value: string; note?: string } {
  const label = r.rideType === 'round_trip' ? 'Drop and return' : 'Drop'
  const value = r.destinationAddress?.trim() || (r.rideType === 'rental' ? 'Drop location not set' : 'Destination')
  if (r.rideType === 'rental') {
    return { label, value, note: r.tripHours ? `City ride · ${r.tripHours} hour package` : 'City ride · hourly package' }
  }
  return { label, value }
}

export type RentalFareSource = {
  rideType: string
  baseFare?: string | number | null
  overageFare?: string | number | null
  overageKm?: string | number | null
  overageMin?: string | number | null
  rentalExtraPerKm?: string | number | null
  rentalExtraPerMin?: string | number | null
  rentalKmLimit?: string | number | null
  rentalDurationMinutes?: number | null
}

export type FareLine = { key: string; label: string; detail?: string; amount: number }

/** "4 hours · 40 km included", from the package the ride was booked on. Null when it is not a rental. */
export function rentalPackageDetail(r: Pick<RentalFareSource, 'rideType' | 'rentalKmLimit' | 'rentalDurationMinutes'>): string | null {
  if (r.rideType !== 'rental') return null
  const parts: string[] = []
  const min = num(r.rentalDurationMinutes)
  if (min > 0) parts.push(formatDuration(min))
  const km = num(r.rentalKmLimit)
  if (km > 0) parts.push(`${trimKm(km)} included`)
  return parts.length ? parts.join(' · ') : null
}

/**
 * A rental's fare as the lines a rider reads: the package price, then extra km and extra time as their own
 * lines (quantity x rate) instead of one lump. Null for any other ride type. When the quantities and rates do
 * not add up to the recorded overage fare (old rentals with no stored rates, say), a single generic
 * "Extra distance or time" line is returned instead of a wrong split.
 */
export function rentalFareLines(r: RentalFareSource): FareLine[] | null {
  if (r.rideType !== 'rental') return null
  const lines: FareLine[] = []
  const pkg = num(r.baseFare)
  const detail = rentalPackageDetail(r)
  if (pkg > 0) lines.push({ key: 'package', label: 'Package price', ...(detail ? { detail } : {}), amount: pkg })

  const overage = num(r.overageFare)
  if (overage <= 0) return lines
  const perKm = num(r.rentalExtraPerKm)
  const perMin = num(r.rentalExtraPerMin)
  const km = num(r.overageKm)
  const min = Math.round(num(r.overageMin))
  const kmAmount = round2(km * perKm)
  const minAmount = round2(min * perMin)
  // Only split when the two parts really add up to what was billed. Old rentals have no stored rates, and a
  // mismatch of a rupee or more means the split would put the wrong amount on the wrong line: one honest line instead.
  if (km * perKm + min * perMin <= 0 || Math.abs(kmAmount + minAmount - overage) >= 1) {
    lines.push({ key: 'extra', label: 'Extra distance or time', amount: overage })
    return lines
  }
  // Rounding crumbs (under a rupee) go to the larger line so the lines still sum to the overage fare.
  const crumb = round2(overage - kmAmount - minAmount)
  const kmFinal = kmAmount >= minAmount ? round2(kmAmount + crumb) : kmAmount
  const minFinal = kmAmount >= minAmount ? minAmount : round2(minAmount + crumb)
  if (kmFinal > 0) lines.push({ key: 'extra-km', label: 'Extra distance', detail: `${trimKm(km)} × ${formatRupees(perKm)}`, amount: kmFinal })
  if (minFinal > 0) lines.push({ key: 'extra-time', label: 'Extra time', detail: `${min} min × ${formatRupees(perMin)}`, amount: minFinal })
  return lines
}
