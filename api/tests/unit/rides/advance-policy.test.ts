import { describe, it, expect } from 'vitest'
import { lateCancelFee, lateCancelSummary, ADVANCE_POLICY_DEFAULTS, type AdvancePolicy } from '@/lib/advance-policy'

const on: AdvancePolicy = { ...ADVANCE_POLICY_DEFAULTS, lateCancelEnabled: true }
const pickup = new Date('2026-11-24T12:00:00Z')
const minsBefore = (m: number) => new Date(pickup.getTime() - m * 60_000)
const input = (m: number, over: Partial<{ fare: number; driverAccepted: boolean }> = {}) => ({ fare: 1850, scheduledFor: pickup, now: minsBefore(m), driverAccepted: true, ...over })

describe('lateCancelFee', () => {
  it('charges nothing while the policy is off, whatever the timing', () => {
    expect(lateCancelFee({ ...on, lateCancelEnabled: false }, input(5))).toEqual({ amount: 0, applies: false, freeUntil: null })
  })

  it('is free before the window opens and says when it ends', () => {
    const r = lateCancelFee(on, input(120))
    expect(r.applies).toBe(false)
    expect(r.freeUntil?.toISOString()).toBe('2026-11-24T11:00:00.000Z')
  })

  it('percent mode: 10% of the fare, capped', () => {
    expect(lateCancelFee(on, input(30, { fare: 600 })).amount).toBe(60)          // under the cap
    expect(lateCancelFee(on, input(30, { fare: 1850 })).amount).toBe(100)        // 185 capped at 100
  })

  it('percent mode with no cap (cap 0) is the plain percentage', () => {
    expect(lateCancelFee({ ...on, feeCap: 0 }, input(30, { fare: 1850 })).amount).toBe(185)
  })

  it('flat mode charges the fixed amount, ignoring percent and cap', () => {
    expect(lateCancelFee({ ...on, feeMode: 'flat', feeFlat: 75 }, input(30)).amount).toBe(75)
  })

  it('never charges more than the fare', () => {
    expect(lateCancelFee({ ...on, feeMode: 'flat', feeFlat: 500 }, input(30, { fare: 120 })).amount).toBe(120)
  })

  it('is exactly at the window edge: fee applies from the boundary on', () => {
    expect(lateCancelFee(on, input(60)).applies).toBe(true)
    expect(lateCancelFee(on, input(61)).applies).toBe(false)
  })

  it('still applies after the pickup time has passed (driver was already on the way)', () => {
    expect(lateCancelFee(on, input(-10)).applies).toBe(true)
  })

  it('charges nothing when no driver has accepted: nobody was put out', () => {
    expect(lateCancelFee(on, input(10, { driverAccepted: false })).applies).toBe(false)
  })

  it('rounds to paise and treats a zero or negative result as no fee', () => {
    expect(lateCancelFee({ ...on, feePercent: 3.333, feeCap: 0 }, input(10, { fare: 100 })).amount).toBe(3.33)
    expect(lateCancelFee({ ...on, feeMode: 'flat', feeFlat: 0 }, input(10)).applies).toBe(false)
  })
})

describe('lateCancelSummary', () => {
  it('is null when off, and the policy numbers when on', () => {
    expect(lateCancelSummary(ADVANCE_POLICY_DEFAULTS)).toBeNull()
    expect(lateCancelSummary(on)).toEqual({ windowMin: 60, mode: 'percent', percent: 10, cap: 100, flat: 50 })
  })
})
