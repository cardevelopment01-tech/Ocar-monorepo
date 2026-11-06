import { describe, it, expect } from 'vitest'
import {
  MAX_LINK_AGE_MS, POST_TRIP_GRACE_MS, PUBLIC_TRIP_KEYS, SHAREABLE_STATUSES, STALE_AFTER_MS,
  isShareExpired, phaseForStatus, toPublicTrip,
} from '@/modules/ride-shares/public-trip'
import type { PublicTripRow } from '@/modules/ride-shares/ride-shares.repository'

// Value: protects=the public page only ever shows the allow-listed fields, every ride status maps to the right phase, and a link
// dies when it should; fails_when=a column is added to the ride query and leaks, a status is forgotten, or the grace/age rules
// shift; why_new=new public endpoint; seam=none (pure rules); no_claim=the database query that fills the row.
const T0 = new Date('2026-11-06T10:00:00Z')
const row = (over: Partial<PublicTripRow> = {}): PublicTripRow => ({
  status: 'in_progress',
  origin_lat: 20.35, origin_lng: 85.82, origin_address: 'Patia Square',
  destination_lat: 20.24, destination_lng: 85.81, destination_address: 'Biju Patnaik Airport',
  completed_at: null, cancelled_at: null,
  rider_first_name: 'Rahul', driver_first_name: 'Suresh',
  vehicle_color: 'White', vehicle_brand: 'Maruti', vehicle_model: 'Dzire', vehicle_plate: 'OD02AB1234',
  driver_lat: 20.3, driver_lng: 85.8, driver_heading: 90, driver_updated_at: new Date(T0.getTime() - 5_000),
  ...over,
})

describe('phaseForStatus (every ride_status value)', () => {
  it.each([
    ['accepted', 'driver_on_way'], ['driver_arrived', 'driver_on_way'],
    ['in_progress', 'in_trip'], ['returning', 'in_trip'],
    ['completed', 'completed'], ['cancelled', 'cancelled'], ['no_drivers', 'cancelled'],
    ['requested', 'finding_driver'],
  ])('%s -> %s', (status, phase) => expect(phaseForStatus(status)).toBe(phase))

  it('a status added later (or hostile text) reads as inactive, never as live', () => {
    expect(phaseForStatus('constructor')).toBe('inactive')
    expect(phaseForStatus('teleporting')).toBe('inactive')
  })

  it('only a ride with a driver that has not ended can be shared', () => {
    expect([...SHAREABLE_STATUSES].sort()).toEqual(['accepted', 'driver_arrived', 'in_progress', 'returning'])
  })
})

describe('isShareExpired', () => {
  const base = { created_at: new Date(T0.getTime() - 60_000), completed_at: null, cancelled_at: null, status: 'in_progress' }

  it('a live trip is not expired', () => expect(isShareExpired(base, T0)).toBe(false))
  it('after the trip ends the page stays for 30 minutes, then the link is dead', () => {
    const ended = new Date(T0.getTime() - POST_TRIP_GRACE_MS + 1_000)
    expect(isShareExpired({ ...base, status: 'completed', completed_at: ended }, T0)).toBe(false)
    expect(isShareExpired({ ...base, status: 'completed', completed_at: new Date(T0.getTime() - POST_TRIP_GRACE_MS - 1_000) }, T0)).toBe(true)
    expect(isShareExpired({ ...base, status: 'cancelled', cancelled_at: new Date(T0.getTime() - POST_TRIP_GRACE_MS - 1_000) }, T0)).toBe(true)
  })
  it('a link never outlives 7 days from creation, even for a trip still running', () => {
    expect(isShareExpired({ ...base, created_at: new Date(T0.getTime() - MAX_LINK_AGE_MS - 1_000) }, T0)).toBe(true)
  })
  it('a ride sent back to dispatch (its driver cancelled) is NOT a dead link: the page says a new driver is being found', () => {
    expect(isShareExpired({ ...base, status: 'requested' }, T0)).toBe(false)
  })
  it('a status nobody described yet is treated as dead rather than guessed', () => {
    expect(isShareExpired({ ...base, status: 'teleporting' }, T0)).toBe(true)
  })
})

describe('toPublicTrip (the allow-list)', () => {
  it('returns exactly the allow-listed keys, even when the row carries private columns', () => {
    const dirty = { ...row(), driver_phone: '+919876543210', total_estimated: 449.5, cash_due: 363.2, start_otp_hash: 'abc123', user_phone: '+919811111111' }
    const dto = toPublicTrip(dirty as never, [], null, T0)
    expect(Object.keys(dto).sort()).toEqual([...PUBLIC_TRIP_KEYS].sort())
    expect(Object.keys(dto.vehicle).sort()).toEqual(['brand', 'color', 'model', 'plate'])
    expect(Object.keys(dto.pickup).sort()).toEqual(['label', 'lat', 'lng'])
    expect(Object.keys(dto.driver!).sort()).toEqual(['heading', 'lat', 'lng', 'stale', 'updatedAt'])
  })

  it('never contains a phone number, fare, or OTP value anywhere in the serialized response', () => {
    const dirty = { ...row(), driver_phone: '+919876543210', total_estimated: 449.5, start_otp_hash: 'abc123', user_phone: '+919811111111' }
    const json = JSON.stringify(toPublicTrip(dirty as never, [], { etaMin: 7, route: 'poly' }, T0))
    for (const secret of ['+919876543210', '449.5', 'abc123', '+919811111111', 'phone', 'otp', 'fare']) expect(json.toLowerCase()).not.toContain(secret.toLowerCase())
  })

  it('while a new driver is being found there is no car, ETA or route, and the page keeps its places', () => {
    const dto = toPublicTrip(row({ status: 'requested', driver_lat: null, driver_lng: null, driver_updated_at: null, vehicle_plate: null }), [], { etaMin: 7, route: 'poly' }, T0)
    expect(dto).toMatchObject({ phase: 'finding_driver', driver: null, etaMin: null, route: null })
    expect(dto.pickup.label).toBe('Patia Square')
  })

  it('shows the car, ETA and route only while the trip is live', () => {
    const live = toPublicTrip(row(), [], { etaMin: 7, route: 'poly' }, T0)
    expect(live).toMatchObject({ phase: 'in_trip', etaMin: 7, route: 'poly', driver: { lat: 20.3, lng: 85.8, heading: 90, stale: false } })
    const done = toPublicTrip(row({ status: 'completed', completed_at: new Date(T0.getTime() - 60_000) }), [], { etaMin: 7, route: 'poly' }, T0)
    expect(done).toMatchObject({ phase: 'completed', driver: null, etaMin: null, route: null })
    expect(done.completedAt).toBe(new Date(T0.getTime() - 60_000).toISOString())
  })

  it('marks a driver position older than 60 s stale instead of presenting it as live', () => {
    const stale = toPublicTrip(row({ driver_updated_at: new Date(T0.getTime() - STALE_AFTER_MS - 1_000) }), [], null, T0)
    expect(stale.driver!.stale).toBe(true)
  })

  it('has no driver at all when no position was ever reported, and carries the stops in order', () => {
    const dto = toPublicTrip(row({ driver_lat: null, driver_lng: null, driver_updated_at: null }), [{ sequence: 1, address: 'Stop A', status: 'pending', lat: 20.3, lng: 85.8 }], null, T0)
    expect(dto.driver).toBeNull()
    expect(dto.stops).toEqual([{ label: 'Stop A', lat: 20.3, lng: 85.8, status: 'pending' }])
  })
})
