import { describe, expect, it } from 'vitest'
import cases from '../../../packages/mobile-shared/src/utils/pickupWait.cases.json'
import { pickupWait, pickupWaitCopy } from '../lib/pickupWait'

// The same boundary table runs in packages/mobile-shared, so every client crosses each boundary at the same instant.
// If this fails, re-copy packages/mobile-shared/src/utils/pickupWait.ts over lib/pickupWait.ts.
describe('pickupWait boundary table', () => {
  const base = new Date(cases.startedAt).getTime()
  it.each(cases.inputs)('$name', (c) => {
    expect(pickupWait({
      status: 'status' in c ? c.status : 'driver_arrived',
      startedAt: 'startedAt' in c ? c.startedAt : cases.startedAt,
      freeMin: 'freeMin' in c ? c.freeMin : cases.freeMin,
      now: base + c.sec * 1000,
    })).toEqual(c.expected)
  })
})

describe('pickupWaitCopy (rider)', () => {
  it('counts the free minutes down, then shows extra waiting with the fixed rate and no running amount', () => {
    expect(pickupWaitCopy({ kind: 'free', msLeft: 161_000 }, 'rider', { perMin: 3 })).toMatchObject({
      tone: 'neutral', label: 'Free waiting', value: '2:41', note: 'Then ₹3 a minute.',
    })
    expect(pickupWaitCopy({ kind: 'charging', overMs: 80_000 }, 'rider', { perMin: 3 })).toMatchObject({
      tone: 'caution', label: 'Extra waiting', value: '+1:20', note: '₹3 a minute applies. Added to your final fare.',
    })
  })
  it('shows nothing for the rider until the driver is really at the pickup', () => {
    expect(pickupWaitCopy({ kind: 'pending' }, 'rider', { perMin: 3 })).toBeNull()
    expect(pickupWaitCopy({ kind: 'none' }, 'rider', { perMin: 3 })).toBeNull()
  })
})
