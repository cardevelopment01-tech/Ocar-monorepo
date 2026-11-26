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
    expect(rows.map((r) => r.key)).toEqual(['ride-fare'])
    expect(rows[0]).toMatchObject({ label: 'Ride fare', detail: '28.4 km · 58 min', amount: 1430 })
    expect(total).toBe(1430)
    expect(rows.reduce((s, r) => s + r.amount, 0)).toBe(total)
  })
  it('shows surge only when charged', () => {
    const { rows } = buildInvoiceRows({ ...base, surgeFare: '100.00', surgeMultiplier: '1.20', totalFinal: '1530.00' })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ label: 'Ride fare', amount: 1530 })
    expect(rows[0]!.detail).toContain('1.2× surge')
  })
  it('shows waiting at the pickup as its own line, with the minutes and the free minutes, so it is not an adjustment', () => {
    const { rows, total } = buildInvoiceRows({ ...base, totalFinal: '1454.00', pickupWaitMin: '11.00', pickupFreeWaitMin: 3, pickupWaitCharge: '24.00' })
    expect(rows.some((r) => r.key === 'pickupWait')).toBe(false)
    expect(rows[0]).toMatchObject({ label: 'Ride fare', amount: 1454 })
    expect(rows[0]!.detail).toContain('incl. ₹24 waiting')
    expect(rows.some((r) => r.key === 'adjust')).toBe(false)
    expect(rows.reduce((sum, r) => sum + r.amount, 0)).toBe(total)
  })
  it('shows an airport toll as its own line with the zone it was charged for, so it is not an adjustment', () => {
    const { rows, total } = buildInvoiceRows({ ...base, totalFinal: '1470.00', tollCharge: '40.00', tollDetail: [{ zone: 'Biju Patnaik Airport', amount: 40 }] })
    expect(rows.find((r) => r.key === 'toll')).toMatchObject({ label: 'Airport toll', detail: 'Biju Patnaik Airport', amount: 40 })
    expect(rows.some((r) => r.key === 'adjust')).toBe(false)
    expect(rows.reduce((sum, r) => sum + r.amount, 0)).toBe(total)
  })
  it('shows no toll line when there was no toll', () => {
    expect(buildInvoiceRows({ ...base, tollCharge: '0.00' }).rows.some((r) => r.key === 'toll')).toBe(false)
  })
  it('shows no waiting line when the wait was inside the free minutes', () => {
    const { rows } = buildInvoiceRows({ ...base, pickupWaitMin: '2.50', pickupFreeWaitMin: 3, pickupWaitCharge: '0.00' })
    expect(rows[0]!.detail).not.toContain('waiting')
  })
  it('adds an Adjustments row when components do not reach the total', () => {
    // The lines below the Ride fare add up to more than the total: only then is there an Adjustments row.
    const { rows } = buildInvoiceRows({ ...base, totalFinal: '1400.00', tollCharge: '1500.00' })
    expect(rows.at(-1)).toMatchObject({ key: 'adjust', label: 'Adjustments', amount: -100 })
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

describe('buildInvoiceRows: driver allowance', () => {
  it('a round trip lists the driver allowance below the Ride fare, and the rows add up to the total', () => {
    const { rows, total } = buildInvoiceRows({ ...base, hourSurcharge: '500.00', totalFinal: '1930.00' })
    expect(rows.map((r) => r.label)).toEqual(['Ride fare', 'Driver allowance'])
    expect(rows[0]!.amount).toBe(1430)
    expect(rows[1]!.amount).toBe(500)
    expect(rows.reduce((s, r) => s + r.amount, 0)).toBe(total)
  })
  it('toll, extra distance, extra time and allowance all sit below the one Ride fare', () => {
    const { rows } = buildInvoiceRows({ ...base, hourSurcharge: '500.00', tollCharge: '40.00', overtimeMin: 10, overtimeFare: 20, totalFinal: '1990.00' })
    expect(rows.map((r) => r.label)).toEqual(['Ride fare', 'Airport toll', 'Extra time', 'Driver allowance'])
  })
})

describe('buildInvoiceRows: night allowance', () => {
  it('lists the night allowance below the Ride fare with its nights and rate, and the rows add up to the total', () => {
    const { rows, total } = buildInvoiceRows({ ...base, nightAllowance: '600.00', nightCount: 2, totalFinal: '2030.00' })
    expect(rows.map((r) => r.label)).toEqual(['Ride fare', 'Night allowance'])
    expect(rows[1]).toMatchObject({ amount: 600, detail: '2 nights × ₹300' })
    expect(rows[0]!.amount).toBe(1430)
    expect(rows.reduce((s, r) => s + r.amount, 0)).toBe(total)
  })
  it('says "1 night" for one, and shows nothing when there is none', () => {
    expect(buildInvoiceRows({ ...base, nightAllowance: '300.00', nightCount: 1, totalFinal: '1730.00' }).rows[1]!.detail).toBe('1 night × ₹300')
    expect(buildInvoiceRows({ ...base, nightAllowance: '0.00', nightCount: 0 }).rows.some((r) => r.key === 'night')).toBe(false)
    expect(buildInvoiceRows(base).rows.some((r) => r.key === 'night')).toBe(false)
  })
  it('sits last, after toll, extra time and driver allowance, in the order the client asked for', () => {
    const { rows } = buildInvoiceRows({ ...base, tollCharge: '40.00', overtimeMin: 10, overtimeFare: 20, hourSurcharge: '500.00', nightAllowance: '300.00', nightCount: 1, totalFinal: '2290.00' })
    expect(rows.map((r) => r.label)).toEqual(['Ride fare', 'Airport toll', 'Extra time', 'Driver allowance', 'Night allowance'])
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
    expect(rows.map((r) => r.key)).toEqual(['ride-fare', 'overtime'])
    expect(rows[0]).toMatchObject({ label: 'Ride fare', amount: 1120 })
    expect(rows[0]!.detail).toContain('6 hours booked')
    expect(rows[1]).toMatchObject({ label: 'Extra time', detail: '16 min', amount: 26.67 })
    expect(Math.round(rows.reduce((s, r) => s + r.amount, 0) * 100) / 100).toBe(total)
  })
  it('overtime comes after surge (it is not surged)', () => {
    const { rows } = buildInvoiceRows({ ...hourly, surgeFare: '560.00', surgeMultiplier: '1.50', totalFinal: '1706.67' })
    expect(rows.map((r) => r.key)).toEqual(['ride-fare', 'overtime'])
    expect(rows[0]!.detail).toContain('1.5× surge')
  })
  it('no extra-time row when the trip stayed inside the booked window', () => {
    const { rows } = buildInvoiceRows({ ...hourly, overtimeMin: 0, overtimeFare: 0, totalFinal: '1120.00' })
    expect(rows.some((r) => r.key === 'overtime')).toBe(false)
  })
  it('rides without the new fields are unchanged', () => {
    expect(buildInvoiceRows(base).rows.map((r) => r.key)).toEqual(['ride-fare'])
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
    expect(rows.map((r) => r.label)).toEqual(['Ride fare', 'Extra distance', 'Extra time'])
    expect(rows[0]).toMatchObject({ amount: 800, detail: '4 h · 40 km included' })
    expect(rows[1]).toMatchObject({ amount: 120, detail: '12 km × ₹10' })
    expect(rows[2]).toMatchObject({ amount: 30, detail: '20 min × ₹1.50' })
    expect(rows.reduce((s, r) => s + r.amount, 0)).toBe(total)
  })
  it('is just the package price when nothing was exceeded', () => {
    const { rows } = buildInvoiceRows({ ...rental, overageFare: '0.00', overageKm: '0', overageMin: '0', totalFinal: '800.00' })
    expect(rows.map((r) => r.label)).toEqual(['Ride fare'])
  })
  it('leaves other ride types alone', () => {
    expect(buildInvoiceRows(base).rows[0]!.label).toBe('Ride fare')
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
    expect(rows.map((r) => r.key)).toEqual(['ride-fare', 'offer'])
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
