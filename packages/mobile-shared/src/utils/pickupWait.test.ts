import { describe, expect, it } from 'vitest'
import cases from './pickupWait.cases.json'
import { pickupWait, pickupWaitCopy } from './pickupWait'

const START = '2026-10-01T06:00:00.000Z'
const at = (secAfterStart: number) => new Date(START).getTime() + secAfterStart * 1000
const arrived = { status: 'driver_arrived', startedAt: START, freeMin: 3 }

describe('pickupWait: which state the clock is in', () => {
  it('has no clock unless the driver is at the pickup and the ride was booked with waiting terms', () => {
    expect(pickupWait({ ...arrived, status: 'accepted', now: at(10) })).toEqual({ kind: 'none' })
    expect(pickupWait({ ...arrived, status: 'in_progress', now: at(10) })).toEqual({ kind: 'none' })
    expect(pickupWait({ ...arrived, freeMin: null, now: at(10) })).toEqual({ kind: 'none' })
  })

  it('is pending while the driver has tapped arrived but the clock has not started', () => {
    expect(pickupWait({ ...arrived, startedAt: null, now: at(10) })).toEqual({ kind: 'pending' })
    expect(pickupWait({ ...arrived, startedAt: undefined, now: at(10) })).toEqual({ kind: 'pending' })
    expect(pickupWait({ ...arrived, startedAt: 'not a date', now: at(10) })).toEqual({ kind: 'pending' })
  })

  it('counts the free minutes down', () => {
    expect(pickupWait({ ...arrived, now: at(0) })).toEqual({ kind: 'free', msLeft: 180_000 })
    expect(pickupWait({ ...arrived, now: at(139) })).toEqual({ kind: 'free', msLeft: 41_000 })
  })

  it('holds the free state through the exact end, like the server, and counts up after it', () => {
    expect(pickupWait({ ...arrived, now: at(180) })).toEqual({ kind: 'free', msLeft: 0 })
    expect(pickupWait({ ...arrived, now: at(181) })).toEqual({ kind: 'charging', overMs: 1000 })
    expect(pickupWait({ ...arrived, now: at(260) })).toEqual({ kind: 'charging', overMs: 80_000 })
  })

  it('never goes negative if the phone clock is a little behind the start', () => {
    expect(pickupWait({ ...arrived, now: at(-5) })).toMatchObject({ kind: 'free' })
  })

  it('a ride with 0 free minutes charges from the first second', () => {
    expect(pickupWait({ ...arrived, freeMin: 0, now: at(1) })).toEqual({ kind: 'charging', overMs: 1000 })
  })
})

// The same boundary table runs in apps/user, so the rider's web and mobile clocks cross each boundary at the same instant.
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

describe('pickupWaitCopy: the words', () => {
  const free = { kind: 'free', msLeft: 161_000 } as const
  const charging = { kind: 'charging', overMs: 80_000 } as const

  it('rider: a neutral countdown that says what comes after, then amber extra time with the fixed rate', () => {
    expect(pickupWaitCopy(free, 'rider', { perMin: 3 })).toMatchObject({
      tone: 'neutral', label: 'Free waiting', value: '2:41', note: 'Then ₹3 a minute.',
    })
    expect(pickupWaitCopy(charging, 'rider', { perMin: 3 })).toMatchObject({
      tone: 'caution', label: 'Extra waiting', value: '+1:20', note: '₹3 a minute applies. Added to your final fare.',
    })
  })

  it('driver: the same time, framed as income, and told to ask for the code', () => {
    expect(pickupWaitCopy(free, 'driver', { perMin: 3 })).toMatchObject({
      tone: 'neutral', label: 'Free waiting left', value: '2:41', note: 'Ask the rider for the start code.',
    })
    expect(pickupWaitCopy(charging, 'driver', { perMin: 3 })).toMatchObject({
      tone: 'earn', label: 'Extra waiting', value: '+1:20', note: '₹3 a minute is added to the fare.',
    })
  })

  it('never shows a running rupee amount, only the fixed rate', () => {
    for (const audience of ['rider', 'driver'] as const) {
      const c = pickupWaitCopy(charging, audience, { perMin: 3 })!
      expect(`${c.label} ${c.value} ${c.note}`).not.toMatch(/so far|₹\d+(?! a minute)/)
    }
  })

  it('pending: only the driver is told to move closer; the rider sees nothing', () => {
    expect(pickupWaitCopy({ kind: 'pending' }, 'rider', { perMin: 3 })).toBeNull()
    expect(pickupWaitCopy({ kind: 'pending' }, 'driver', { perMin: 3 })).toMatchObject({ icon: 'map-pin', label: 'Waiting timer not started' })
  })

  it('states a fractional rate to the paisa and leaves the rate out when waiting is free after the window', () => {
    expect(pickupWaitCopy(charging, 'rider', { perMin: 2.5 })!.note).toContain('₹2.50 a minute')
    expect(pickupWaitCopy(charging, 'rider', { perMin: 0 })!.note).toBeUndefined()
    expect(pickupWaitCopy(free, 'rider', { perMin: null })!.note).toBeUndefined()
  })

  it('has nothing for no clock', () => {
    expect(pickupWaitCopy({ kind: 'none' }, 'rider', { perMin: 3 })).toBeNull()
  })
})
