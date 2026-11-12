import { describe, it, expect } from 'vitest'
import { returnCabAvailability } from '@/modules/rides/return-cab-availability'

describe('returnCabAvailability', () => {
  it('counts only drivers inside the pickup cap and reports the nearest', () => {
    expect(returnCabAvailability([{ distance_metres: 7_000 }, { distance_metres: 2_400.4 }, { distance_metres: 12_000 }], 10_000))
      .toEqual({ count: 2, nearest_m: 2_400 })
  })

  it('keeps a driver exactly at the cap and drops one metre beyond it', () => {
    expect(returnCabAvailability([{ distance_metres: 10_000 }, { distance_metres: 10_001 }], 10_000)).toEqual({ count: 1, nearest_m: 10_000 })
  })

  it('never counts an unknown distance as a driver at the pickup', () => {
    expect(returnCabAvailability([{ distance_metres: null }, { distance_metres: Number.NaN }, { distance_metres: undefined }], 10_000))
      .toEqual({ count: 0, nearest_m: null })
  })

  it('is empty when there are no drivers', () => {
    expect(returnCabAvailability([], 10_000)).toEqual({ count: 0, nearest_m: null })
  })
})
