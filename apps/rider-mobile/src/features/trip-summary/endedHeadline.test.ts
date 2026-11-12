import { describe, expect, it } from 'vitest'
import { endedHeadline } from './endedHeadline'

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
