import { describe, it, expect } from 'vitest'
import { driverFare } from '@/modules/offers/driver-fare'

// Value: protects=every driver-facing fare picks the payable first; fails_when=the order changes; why_new=four call
// sites used to hand-roll this; seam=none; no_claim=where it is used.
describe('driverFare', () => {
  it('prefers cash_due, then driver_fare, then the estimate, else 0', () => {
    expect(driverFare({ cash_due: '363.20', driver_fare: '360', total_estimated: '454' })).toBe(363.2)
    expect(driverFare({ driver_fare: '360', total_estimated: '454' })).toBe(360)
    expect(driverFare({ total_estimated: '454' })).toBe(454)
    expect(driverFare({ cash_due: null, total_estimated: null })).toBe(0)
    expect(driverFare({})).toBe(0)
  })
})
