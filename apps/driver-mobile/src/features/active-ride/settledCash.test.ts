import { describe, expect, it } from 'vitest'
import { settledCash } from './settledCash'

const cashRide = { paymentChannel: 'cash', cashCollectedAt: null, cashCollectedAmount: null }

describe('settledCash', () => {
  it('asks for cash on a completed cash ride that has not been collected', () => {
    expect(settledCash(cashRide, null)).toBeNull()
    expect(settledCash({ ...cashRide, paymentChannel: null }, null)).toBeNull()
  })

  it('shows the summary for a ride whose cash was collected earlier (stale notification, relaunch)', () => {
    expect(settledCash({ ...cashRide, cashCollectedAt: '2026-10-06T14:12:00Z', cashCollectedAmount: '454.00' }, null)).toEqual({ collected: 454 })
    expect(settledCash({ ...cashRide, cashCollectedAt: '2026-10-06T14:12:00Z', cashCollectedAmount: '0' }, null)).toEqual({ collected: 0 })
  })

  it("keeps this session's own result", () => {
    expect(settledCash(cashRide, { collected: 300 })).toEqual({ collected: 300 })
  })

  it('has no cash step for online and wallet rides', () => {
    expect(settledCash({ ...cashRide, paymentChannel: 'online' }, null)).toEqual({ collected: null })
    expect(settledCash({ ...cashRide, paymentChannel: 'wallet' }, null)).toEqual({ collected: null })
  })
})
