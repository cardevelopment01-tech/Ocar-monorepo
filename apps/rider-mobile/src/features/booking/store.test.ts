import { describe, it, expect, beforeEach } from 'vitest'
import { useBookingDraftStore } from './store'

const place = (n: number) => ({ address: `Stop ${n}`, lat: 20 + n / 100, lng: 85 + n / 100 })
const state = () => useBookingDraftStore.getState()

describe('booking draft store', () => {
  beforeEach(() => state().reset())

  it('starts as an undeclared one-way draft', () => {
    expect(state().rideType).toBe('one_way')
    expect(state().rideTypeDeclared).toBe(false)
    expect(state().stops).toEqual([])
  })

  it('declares the ride type when one is chosen', () => {
    state().setRideType('round_trip')
    expect(state().rideType).toBe('round_trip')
    expect(state().rideTypeDeclared).toBe(true)
  })

  it('keeps the ride type undeclared when set automatically', () => {
    state().setRideType('one_way', false)
    expect(state().rideTypeDeclared).toBe(false)
  })

  it('allows at most 3 stops', () => {
    for (let i = 1; i <= 5; i++) state().addStop(place(i))
    expect(state().stops).toHaveLength(3)
    expect(state().stops.map((s) => s.address)).toEqual(['Stop 1', 'Stop 2', 'Stop 3'])
  })

  it('removes a stop by index', () => {
    state().addStop(place(1)); state().addStop(place(2)); state().addStop(place(3))
    state().removeStop(1)
    expect(state().stops.map((s) => s.address)).toEqual(['Stop 1', 'Stop 3'])
  })

  it('moves a stop down by swapping with the next one', () => {
    state().addStop(place(1)); state().addStop(place(2)); state().addStop(place(3))
    state().swapStop(0)
    expect(state().stops.map((s) => s.address)).toEqual(['Stop 2', 'Stop 1', 'Stop 3'])
  })

  it('ignores a swap on the last stop', () => {
    state().addStop(place(1)); state().addStop(place(2))
    state().swapStop(1)
    expect(state().stops.map((s) => s.address)).toEqual(['Stop 1', 'Stop 2'])
  })

  it('books for someone else and can switch back to myself', () => {
    state().setRider('Asha', '+919876543210')
    expect(state().riderName).toBe('Asha')
    state().clearRider()
    expect(state().riderName).toBe('')
    expect(state().riderPhone).toBe('')
  })

  it('schedules a pickup and resets to now', () => {
    state().setScheduledFor('2026-10-07T09:00:00.000Z')
    expect(state().scheduledFor).toBe('2026-10-07T09:00:00.000Z')
    state().setScheduledFor(null)
    expect(state().scheduledFor).toBeNull()
  })

  it('reset clears the whole draft', () => {
    state().setPickup(place(1)); state().setDrop(place(2)); state().addStop(place(3)); state().setTripHours(8)
    state().reset()
    expect(state().pickup).toBeNull()
    expect(state().drop).toBeNull()
    expect(state().stops).toEqual([])
    expect(state().tripHours).toBeNull()
  })
})
