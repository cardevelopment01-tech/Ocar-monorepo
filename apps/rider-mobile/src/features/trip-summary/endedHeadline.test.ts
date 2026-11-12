import { describe, expect, it } from 'vitest'
import { cancellationFeeOf, endedHeadline } from './endedHeadline'

describe('endedHeadline', () => {
  it('names a driver cancel', () => {
    expect(endedHeadline({ status: 'cancelled', cancellationActor: 'driver' })).toBe('Your driver cancelled')
  })
  it.each(['user', 'admin', 'system', null] as const)('keeps "Ride cancelled" for %s', (actor) => {
    expect(endedHeadline({ status: 'cancelled', cancellationActor: actor })).toBe('Ride cancelled')
  })
  it('is "Ride cancelled" on an older server that sends no actor', () => {
    expect(endedHeadline({ status: 'cancelled' })).toBe('Ride cancelled')
  })
  it('says no drivers found for no_drivers, whoever the actor is', () => {
    expect(endedHeadline({ status: 'no_drivers', cancellationActor: 'system' })).toBe('No drivers found')
  })
})

describe('cancellationFeeOf', () => {
  it('is the fee that was charged', () => {
    expect(cancellationFeeOf({ cancellationFee: 50, cancellationFeeWaived: false })).toBe(50)
  })
  it('is 0 when an admin waived it', () => {
    expect(cancellationFeeOf({ cancellationFee: 50, cancellationFeeWaived: true })).toBe(0)
  })
  it('is 0 when there was no fee, or an older server sends none', () => {
    expect(cancellationFeeOf({ cancellationFee: 0 })).toBe(0)
    expect(cancellationFeeOf({})).toBe(0)
    expect(cancellationFeeOf({ cancellationFee: null })).toBe(0)
  })
  it('reads a numeric string too', () => {
    expect(cancellationFeeOf({ cancellationFee: '25.00' as unknown as number })).toBe(25)
  })
})
