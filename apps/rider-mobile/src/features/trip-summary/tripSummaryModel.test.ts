import { describe, expect, it } from 'vitest'
import { buildInvoiceRows, buildTimeline, formatMoney, formatTripWhen, paymentState, tripTitle } from './tripSummaryModel'

const base = {
  baseFare: '120.00', distanceFare: '1020.00', timeFare: '290.00', stopFare: '0.00', hourSurcharge: '0.00',
  overageFare: '0.00', surgeFare: '0.00', surgeMultiplier: '1.00', actualKm: '28.40', actualMin: '58.00',
  totalFinal: '1430.00', totalEstimated: '1400.00',
}

describe('formatMoney', () => {
  it('drops .00 and groups in lakh style', () => {
    expect(formatMoney('1480.00')).toBe('₹1,480')
    expect(formatMoney(123456)).toBe('₹1,23,456')
  })
  it('keeps paise', () => {
    expect(formatMoney('146.82')).toBe('₹146.82')
  })
})

describe('buildInvoiceRows', () => {
  it('hides zero rows, labels quantities, and sums to the total', () => {
    const { rows, total } = buildInvoiceRows(base)
    expect(rows.map((r) => r.key)).toEqual(['base', 'distance', 'time'])
    expect(rows[1]).toMatchObject({ label: 'Distance', detail: '28.4 km' })
    expect(total).toBe(1430)
    expect(rows.reduce((s, r) => s + r.amount, 0)).toBe(total)
  })
  it('shows surge only when charged', () => {
    const { rows } = buildInvoiceRows({ ...base, surgeFare: '100.00', surgeMultiplier: '1.20', totalFinal: '1530.00' })
    expect(rows.find((r) => r.key === 'surge')).toMatchObject({ label: 'Surge', detail: '1.2x' })
  })
  it('adds an Adjustments row when components do not reach the total', () => {
    const { rows } = buildInvoiceRows({ ...base, totalFinal: '1400.00' })
    expect(rows.at(-1)).toMatchObject({ key: 'adjust', label: 'Adjustments', amount: -30 })
  })
  it('ignores sub-rupee rounding gaps', () => {
    expect(buildInvoiceRows({ ...base, totalFinal: '1430.50' }).rows.some((r) => r.key === 'adjust')).toBe(false)
  })
  it('falls back to the estimate and flags it', () => {
    const r = buildInvoiceRows({ ...base, totalFinal: null })
    expect(r.isEstimate).toBe(true)
    expect(r.total).toBe(1400)
  })
})

describe('paymentState', () => {
  const ride = { totalFinal: '1480.00', totalEstimated: '1400.00', paymentChannel: 'cash', cashCollectedAt: null }
  it('cash not collected is due, with the formatted amount', () => {
    expect(paymentState(ride)).toEqual({ kind: 'cash_due', text: 'Pay ₹1,480 cash to your driver' })
  })
  it('cash collected is paid', () => {
    expect(paymentState({ ...ride, cashCollectedAt: '2026-10-01T16:10:00Z' }).kind).toBe('paid')
  })
  it('null channel is treated as cash', () => {
    expect(paymentState({ ...ride, paymentChannel: null }).kind).toBe('cash_due')
  })
  it('wallet is paid', () => {
    expect(paymentState({ ...ride, paymentChannel: 'wallet' })).toEqual({ kind: 'paid', text: 'Paid via wallet' })
  })
})

describe('tripTitle', () => {
  it('prefers the assigned category and appends the ride type', () => {
    expect(tripTitle({ rideType: 'round_trip', assignedCategoryName: 'Sedan', bookedCategoryName: 'Hatchback' })).toBe('Sedan · Round trip')
  })
  it('names the hourly mode Rental and a city ride City ride', () => {
    expect(tripTitle({ rideType: 'rental', assignedCategoryName: 'Sedan', bookedCategoryName: null })).toBe('Sedan · Rental')
    expect(tripTitle({ rideType: 'one_way', tripMode: 'city', assignedCategoryName: 'Sedan', bookedCategoryName: null })).toBe('Sedan · City ride')
    expect(tripTitle({ rideType: 'one_way', tripMode: 'standard', assignedCategoryName: 'Sedan', bookedCategoryName: null })).toBe('Sedan')
  })
  it('falls back to the booked category, then to Ride', () => {
    expect(tripTitle({ rideType: 'one_way', assignedCategoryName: null, bookedCategoryName: 'Hatchback' })).toBe('Hatchback')
    expect(tripTitle({ rideType: 'one_way', assignedCategoryName: null, bookedCategoryName: null })).toBe('Ride')
  })
})

describe('formatTripWhen', () => {
  it('formats a valid timestamp and rejects bad input', () => {
    expect(formatTripWhen('2026-10-01T12:00:00Z')).toMatch(/Oct 2026 · /)
    expect(formatTripWhen(null)).toBeNull()
    expect(formatTripWhen('not a date')).toBeNull()
  })
})

describe('buildInvoiceRows: hourly round trip', () => {
  // 6h booked, 40 km at Rs 13: 520 distance + 6 x 100 booked hours, then 16 min of overtime at 100/h.
  const hourly = {
    ...base, baseFare: '0.00', distanceFare: '520.00', timeFare: '0.00', actualKm: '40.00', actualMin: '380.00',
    tripHours: 6, waitingFare: '600.00', overtimeMin: 16, overtimeFare: 26.67, totalFinal: '1146.67', totalEstimated: '1120.00',
  }

  it('shows booked time and extra time as their own lines, so nothing lands in Adjustments', () => {
    const { rows, total } = buildInvoiceRows(hourly)
    expect(rows.map((r) => r.key)).toEqual(['distance', 'booked', 'overtime'])
    expect(rows[1]).toMatchObject({ label: 'Booked time', detail: '6 hours', amount: 600 })
    expect(rows[2]).toMatchObject({ label: 'Extra time', detail: '16 min', amount: 26.67 })
    expect(Math.round(rows.reduce((s, r) => s + r.amount, 0) * 100) / 100).toBe(total)
  })
  it('overtime comes after surge (it is not surged)', () => {
    const { rows } = buildInvoiceRows({ ...hourly, surgeFare: '560.00', surgeMultiplier: '1.50', totalFinal: '1706.67' })
    expect(rows.map((r) => r.key)).toEqual(['distance', 'booked', 'surge', 'overtime'])
  })
  it('no extra-time row when the trip stayed inside the booked window', () => {
    const { rows } = buildInvoiceRows({ ...hourly, overtimeMin: 0, overtimeFare: 0, totalFinal: '1120.00' })
    expect(rows.some((r) => r.key === 'overtime')).toBe(false)
  })
  it('rides without the new fields are unchanged', () => {
    expect(buildInvoiceRows(base).rows.map((r) => r.key)).toEqual(['base', 'distance', 'time'])
  })
})


describe('buildTimeline', () => {
  const base = { tripHours: 6, startedAt: null, bookedUntil: '2026-10-01T18:30:00.000Z', overtimeMin: 21, overtimeGraceMin: 5, overtimeRate: 100, completedAt: '2026-10-01T19:01:00.000Z' }
  it('returns four steps when the trip ran over', () => {
    const t = buildTimeline(base)!
    expect(t.map((s) => s.key)).toEqual(['start', 'booked', 'extra', 'done'])
    expect(t[1]!.note).toBe('5 free minutes')
    expect(t[3]!.note).toBe('21 min extra')
  })
  it('is null without overtime or a booked window', () => {
    expect(buildTimeline({ ...base, overtimeMin: 0 })).toBeNull()
    expect(buildTimeline({ ...base, bookedUntil: null })).toBeNull()
  })
})

describe('buildInvoiceRows for a rental', () => {
  const rental = {
    ...base, rideType: 'rental', baseFare: '800.00', distanceFare: '0.00', timeFare: '0.00', overageFare: '150.00',
    overageKm: '12', overageMin: '20', rentalExtraPerKm: '10', rentalExtraPerMin: '1.5', rentalKmLimit: '40', rentalDurationMinutes: 240,
    totalFinal: '950.00',
  }
  it('reads as package price, extra distance and extra time, not "Base fare" plus one lump', () => {
    const { rows, total } = buildInvoiceRows(rental)
    expect(rows.map((r) => r.label)).toEqual(['Package price', 'Extra distance', 'Extra time'])
    expect(rows[0]).toMatchObject({ amount: 800, detail: '4 h · 40 km included' })
    expect(rows[1]).toMatchObject({ amount: 120, detail: '12 km × ₹10' })
    expect(rows[2]).toMatchObject({ amount: 30, detail: '20 min × ₹1.50' })
    expect(rows.reduce((s, r) => s + r.amount, 0)).toBe(total)
  })
  it('is just the package price when nothing was exceeded', () => {
    const { rows } = buildInvoiceRows({ ...rental, overageFare: '0.00', overageKm: '0', overageMin: '0', totalFinal: '800.00' })
    expect(rows.map((r) => r.label)).toEqual(['Package price'])
  })
  it('leaves other ride types alone', () => {
    expect(buildInvoiceRows(base).rows[0]!.label).toBe('Base fare')
  })
})

describe('buildInvoiceRows rental safety', () => {
  const rental = { ...base, rideType: 'rental', baseFare: '0.00', distanceFare: '0.00', timeFare: '0.00', overageFare: '150.00', totalFinal: '150.00' }
  it('keeps the generic overage row rather than falling into "Adjustments" when there is no package line', () => {
    const { rows } = buildInvoiceRows(rental)
    expect(rows.map((r) => r.label)).not.toContain('Adjustments')
    expect(rows.reduce((s, r) => s + r.amount, 0)).toBe(150)
  })
})

describe('with a rider offer (driver-funded discount)', () => {
  const gross = { ...base, totalFinal: '454.00', baseFare: '454.00', distanceFare: '0.00', timeFare: '0.00' }
  it('lists the components that add up to the gross fare, takes the offer off, and the total is what the rider paid', () => {
    const { rows, total, discount } = buildInvoiceRows({ ...gross, discountAmount: '90.80' })
    expect(rows.map((r) => r.key)).toEqual(['base', 'offer'])
    expect(rows.at(-1)).toEqual({ key: 'offer', label: 'Offer', amount: 90.8, negative: true })
    expect(total).toBe(363.2)
    expect(discount).toBe(90.8)
  })
  it('no discount, or an older server that sends none, changes nothing', () => {
    expect(buildInvoiceRows(gross).total).toBe(454)
    expect(buildInvoiceRows({ ...gross, discountAmount: '0.00' }).rows.some((r) => r.key === 'offer')).toBe(false)
  })
  it('a discount can never take the total below zero', () => {
    expect(buildInvoiceRows({ ...gross, discountAmount: '9999' }).total).toBe(0)
  })
  it('cash due is the amount the server says to pay, falling back to the fare', () => {
    const ride = { totalFinal: '454.00', totalEstimated: '454.00', paymentChannel: 'cash', cashCollectedAt: null }
    expect(paymentState({ ...ride, cashDue: '363.20' })).toEqual({ kind: 'cash_due', text: 'Pay ₹363.20 cash to your driver' })
    expect(paymentState(ride).kind === 'cash_due' && paymentState(ride).text).toBe('Pay ₹454 cash to your driver')
  })
})
