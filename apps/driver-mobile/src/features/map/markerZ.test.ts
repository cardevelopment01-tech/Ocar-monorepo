import { describe, it, expect } from 'vitest'
import { MARKER_Z } from './markerZ'

// Value: protects=the driver's car marker appears on the Home map next to the address pill; fails_when=the pill's z-index is not above the
// car's (the map library then overwrites the car's slot and the car is never drawn); why_new=the missing car was invisible to every other
// test (it is a native list bug); seam=none; no_claim=that the car is on screen (that needs a real phone).
describe('marker draw order', () => {
  it('puts the address pill above the car', () => {
    expect(MARKER_Z.pill).toBeGreaterThan(MARKER_Z.car)
  })
})
