import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/modules/rides/rides.repository', () => ({
  getRideCoreById: vi.fn(),
  getRideStops:    vi.fn(),
  appendRideStop:  vi.fn(),
  getRideStopCharge: vi.fn(),
}))

vi.mock('@/db/client', () => ({ pool: { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }) }, withTransaction: vi.fn() }))

vi.mock('@/websocket/socket.server', () => ({
  socketEvents: { sendStopAdded: vi.fn() },
  getIO: vi.fn(() => ({ to: vi.fn(() => ({ emit: vi.fn() })) })),
}))

vi.mock('@/modules/notifications/templates.service', () => ({
  renderTemplate: vi.fn().mockResolvedValue({ subject: 'New stop added', body: 'A rider added a stop to your trip at Patia.' }),
}))

vi.mock('@/modules/notifications/notifications.service', () => ({
  notifyOwner: vi.fn(),
  notifyRideEvent: vi.fn(), notifyRidePaymentFailed: vi.fn(),
  notifyAllAdmins: vi.fn(),
}))

// The city stop limit is a system_config value; a test sets it through here (null = unset, so the default of 2 applies).
const cfg = vi.hoisted(() => ({ cityMaxStops: null as string | null }))
vi.mock('@/lib/system-config', () => ({
  getConfigValue: vi.fn(async (key: string, fallback: string) => (key === 'city_ride_max_stops' && cfg.cityMaxStops !== null ? cfg.cityMaxStops : fallback)),
}))

import * as repo from '@/modules/rides/rides.repository'
import { pool } from '@/db/client'
import { socketEvents } from '@/websocket/socket.server'
import { notifyOwner } from '@/modules/notifications/notifications.service'
import { addRideStop, maxStopsFor } from '@/modules/rides/rides.service'
import { MAX_STOPS_PER_RIDE } from '@/constants/limits'

const USER_ID = BigInt(7)
const RIDE_ID = BigInt(101)
const STOP = { lat: 20.30, lng: 85.83, address: 'Patia' }

describe('addRideStop', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(repo.getRideStops).mockResolvedValue([])
    vi.mocked(repo.getRideStopCharge).mockResolvedValue(0)
    vi.mocked(repo.appendRideStop).mockResolvedValue({
      id: BigInt(9), ride_id: RIDE_ID, sequence: 2, lat: 20.30, lng: 85.83,
      address: 'Patia', status: 'pending', arrived_at: null, reached_at: null,
      stop_charge_applied: '0', wait_charge: '0',
    } as never)
  })

  it('rejects when the ride does not belong to the caller', async () => {
    vi.mocked(repo.getRideCoreById).mockResolvedValue({
      id: RIDE_ID, user_id: BigInt(999), status: 'in_progress', ride_type: 'one_way', category_id: BigInt(1),
      origin_lat: 20.10, origin_lng: 85.70, dest_lat: null, dest_lng: null,
    } as never)

    await expect(addRideStop(USER_ID, RIDE_ID, STOP)).rejects.toThrow(/Forbidden/)
    expect(repo.appendRideStop).not.toHaveBeenCalled()
  })

  it('rejects once the ride has completed', async () => {
    vi.mocked(repo.getRideCoreById).mockResolvedValue({
      id: RIDE_ID, user_id: USER_ID, status: 'completed', ride_type: 'one_way', category_id: BigInt(1),
      origin_lat: 20.10, origin_lng: 85.70, dest_lat: null, dest_lng: null,
    } as never)

    await expect(addRideStop(USER_ID, RIDE_ID, STOP)).rejects.toThrow(/on the way/)
    expect(repo.appendRideStop).not.toHaveBeenCalled()
  })

  it('adds a free stop on a one_way ride whose rate card has no stop charge', async () => {
    vi.mocked(repo.getRideCoreById).mockResolvedValue({
      id: RIDE_ID, user_id: USER_ID, driver_id: BigInt(55), status: 'in_progress', ride_type: 'one_way', category_id: BigInt(1),
      origin_lat: 20.10, origin_lng: 85.70, dest_lat: null, dest_lng: null,
    } as never)

    await addRideStop(USER_ID, RIDE_ID, STOP)

    expect(repo.appendRideStop).toHaveBeenCalledWith(RIDE_ID, { ...STOP, chargeApplied: 0 })
    expect(socketEvents.sendStopAdded).toHaveBeenCalledWith(RIDE_ID.toString(), expect.any(Object))
    expect(notifyOwner).toHaveBeenCalledWith(expect.objectContaining({
      ownerType: 'driver',
      ownerId: BigInt(55),
      rideId: RIDE_ID,
    }))
  })

  it('does not notify the driver when the ride has no driver assigned yet', async () => {
    vi.mocked(repo.getRideCoreById).mockResolvedValue({
      id: RIDE_ID, user_id: USER_ID, driver_id: null, status: 'in_progress', ride_type: 'one_way', category_id: BigInt(1),
      origin_lat: 20.10, origin_lng: 85.70, dest_lat: null, dest_lng: null,
    } as never)

    await addRideStop(USER_ID, RIDE_ID, STOP)

    expect(notifyOwner).not.toHaveBeenCalled()
  })

  it("applies the ride's rate-card stop charge", async () => {
    vi.mocked(repo.getRideStopCharge).mockResolvedValue(30)
    vi.mocked(repo.getRideCoreById).mockResolvedValue({
      id: RIDE_ID, user_id: USER_ID, status: 'accepted', ride_type: 'round_trip', category_id: BigInt(3),
      origin_lat: 20.10, origin_lng: 85.70, dest_lat: null, dest_lng: null,
    } as never)

    await addRideStop(USER_ID, RIDE_ID, STOP)

    expect(repo.appendRideStop).toHaveBeenCalledWith(RIDE_ID, { ...STOP, chargeApplied: 30 })
    // The charge must reach the fare snapshot settlement bills from.
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE fare_snapshots'), [RIDE_ID, 30, false])
  })

  it('adds the charge to total_estimated on a one-way ride, which settles to that total', async () => {
    vi.mocked(repo.getRideStopCharge).mockResolvedValue(30)
    vi.mocked(repo.getRideCoreById).mockResolvedValue({
      id: RIDE_ID, user_id: USER_ID, status: 'in_progress', ride_type: 'one_way', category_id: BigInt(3),
      origin_lat: 20.10, origin_lng: 85.70, dest_lat: null, dest_lng: null,
    } as never)

    await addRideStop(USER_ID, RIDE_ID, STOP)

    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('total_estimated = CASE WHEN $3'), [RIDE_ID, 30, true])
  })

  it("adds a stop on a round trip's return leg ('returning') with the rate-card stop charge", async () => {
    vi.mocked(repo.getRideStopCharge).mockResolvedValue(30)
    vi.mocked(repo.getRideCoreById).mockResolvedValue({
      id: RIDE_ID, user_id: USER_ID, driver_id: BigInt(55), status: 'returning', ride_type: 'round_trip', category_id: BigInt(3),
      origin_lat: 20.10, origin_lng: 85.70, dest_lat: 20.60, dest_lng: 85.90, drop_arrived_at: null,
    } as never)

    await addRideStop(USER_ID, RIDE_ID, STOP)

    expect(repo.appendRideStop).toHaveBeenCalledWith(RIDE_ID, { ...STOP, chargeApplied: 30 })
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE fare_snapshots'), [RIDE_ID, 30, false])
    expect(socketEvents.sendStopAdded).toHaveBeenCalled()
  })

  it('refuses a stop once the driver has reached the drop, even on the return leg', async () => {
    vi.mocked(repo.getRideCoreById).mockResolvedValue({
      id: RIDE_ID, user_id: USER_ID, driver_id: BigInt(55), status: 'returning', ride_type: 'round_trip', category_id: BigInt(3),
      origin_lat: 20.10, origin_lng: 85.70, dest_lat: 20.60, dest_lng: 85.90, drop_arrived_at: new Date(),
    } as never)

    await expect(addRideStop(USER_ID, RIDE_ID, STOP)).rejects.toMatchObject({ code: 'DROP_ALREADY_REACHED' })
    expect(repo.appendRideStop).not.toHaveBeenCalled()
  })

  it('retries once on a unique-violation race and succeeds on the second attempt', async () => {
    vi.mocked(repo.getRideCoreById).mockResolvedValue({
      id: RIDE_ID, user_id: USER_ID, status: 'in_progress', ride_type: 'one_way', category_id: BigInt(1),
      origin_lat: 20.10, origin_lng: 85.70, dest_lat: null, dest_lng: null,
    } as never)
    const conflictErr = Object.assign(new Error('duplicate key'), { code: '23505' })
    vi.mocked(repo.appendRideStop)
      .mockRejectedValueOnce(conflictErr)
      .mockResolvedValueOnce({
        id: BigInt(10), ride_id: RIDE_ID, sequence: 3, lat: 20.30, lng: 85.83,
        address: 'Patia', status: 'pending', arrived_at: null, reached_at: null,
        stop_charge_applied: '0', wait_charge: '0',
      } as never)

    const result = await addRideStop(USER_ID, RIDE_ID, STOP)

    expect(repo.appendRideStop).toHaveBeenCalledTimes(2)
    expect(result.sequence).toBe(3)
  })

  it('gives up and rethrows after exhausting retries on repeated unique-violations', async () => {
    vi.mocked(repo.getRideCoreById).mockResolvedValue({
      id: RIDE_ID, user_id: USER_ID, status: 'in_progress', ride_type: 'one_way', category_id: BigInt(1),
      origin_lat: 20.10, origin_lng: 85.70, dest_lat: null, dest_lng: null,
    } as never)
    const conflictErr = Object.assign(new Error('duplicate key'), { code: '23505' })
    vi.mocked(repo.appendRideStop).mockRejectedValue(conflictErr)

    await expect(addRideStop(USER_ID, RIDE_ID, STOP)).rejects.toThrow(/duplicate key/)
    expect(repo.appendRideStop).toHaveBeenCalledTimes(3)
  })

  it('rejects once the ride already has the maximum number of stops', async () => {
    vi.mocked(repo.getRideCoreById).mockResolvedValue({
      id: RIDE_ID, user_id: USER_ID, status: 'in_progress', ride_type: 'one_way', category_id: BigInt(1),
      origin_lat: 20.10, origin_lng: 85.70, dest_lat: null, dest_lng: null,
    } as never)
    vi.mocked(repo.getRideStops).mockResolvedValue(
      Array.from({ length: MAX_STOPS_PER_RIDE }, (_, i) => ({
        id: BigInt(i), ride_id: RIDE_ID, sequence: i + 1, lat: 20.1 + i * 0.05, lng: 85.7 + i * 0.05,
        address: `Stop ${i}`, status: 'pending', arrived_at: null, reached_at: null,
        stop_charge_applied: '0', wait_charge: '0',
      })) as never
    )

    await expect(addRideStop(USER_ID, RIDE_ID, STOP)).rejects.toThrow(new RegExp(`at most ${MAX_STOPS_PER_RIDE} stops`))
    expect(repo.appendRideStop).not.toHaveBeenCalled()
  })

  it('rejects a stop that is too close to an existing point in the trip', async () => {
    vi.mocked(repo.getRideCoreById).mockResolvedValue({
      id: RIDE_ID, user_id: USER_ID, status: 'in_progress', ride_type: 'one_way', category_id: BigInt(1),
      origin_lat: 20.10, origin_lng: 85.70, dest_lat: null, dest_lng: null,
    } as never)
    vi.mocked(repo.getRideStops).mockResolvedValue([
      { id: BigInt(1), ride_id: RIDE_ID, sequence: 1, lat: STOP.lat + 0.0001, lng: STOP.lng + 0.0001,
        address: 'Near Patia', status: 'pending', arrived_at: null, reached_at: null,
        stop_charge_applied: '0', wait_charge: '0' },
    ] as never)

    await expect(addRideStop(USER_ID, RIDE_ID, STOP)).rejects.toThrow(/too close to another point/)
    expect(repo.appendRideStop).not.toHaveBeenCalled()
  })
})

// Value: protects=a city ride refuses a 3rd stop while the ride is on the way (and leaves nothing written),
// accepts one that fits, a standard ride keeps its limit of 3, and maxStopsFor (the one place the limit is decided, also sent to the apps
// as max_stops) honours the setting and falls back to 2 for a bad value; fails_when=the city branch of addRideStop is removed, the limit
// leaks onto standard rides, or an unreadable setting opens the limit; why_new=the client capped city rides at 2 stops inside the city;
// seam=repo, config and the boundary query mocked; no_claim=real PostGIS (checked separately against a database).
describe('addRideStop on a city ride', () => {
  const cityRide = (over: Record<string, unknown> = {}) => ({
    id: RIDE_ID, user_id: USER_ID, driver_id: BigInt(55), status: 'in_progress', ride_type: 'one_way', trip_mode: 'city', category_id: BigInt(1),
    origin_lat: 20.10, origin_lng: 85.70, dest_lat: 20.40, dest_lng: 85.90, ...over,
  })
  const existing = (n: number) => Array.from({ length: n }, (_, i) => ({
    id: BigInt(i + 1), ride_id: RIDE_ID, sequence: i + 1, lat: 20.15 + i * 0.05, lng: 85.75 + i * 0.05,
    address: `S${i + 1}`, status: 'pending', arrived_at: null, reached_at: null, stop_charge_applied: '0', wait_charge: '0',
  }))

  beforeEach(() => {
    vi.clearAllMocks() // call counts only; the shared repo mocks keep their default answers
    cfg.cityMaxStops = null
    vi.mocked(pool.query).mockResolvedValue({ rows: [{ '?column?': 1 }], rowCount: 1 } as never) // the stop is inside the city
  })

  it('refuses a 3rd stop with CITY_RIDE_STOP_LIMIT and writes nothing', async () => {
    vi.mocked(repo.getRideCoreById).mockResolvedValue(cityRide() as never)
    vi.mocked(repo.getRideStops).mockResolvedValue(existing(2) as never)
    await expect(addRideStop(USER_ID, RIDE_ID, STOP)).rejects.toMatchObject({ httpStatus: 422, appCode: 'CITY_RIDE_STOP_LIMIT' })
    expect(repo.appendRideStop).not.toHaveBeenCalled()
  })


  it('accepts a stop that fits: the 2nd, inside the city', async () => {
    vi.mocked(repo.getRideCoreById).mockResolvedValue(cityRide() as never)
    vi.mocked(repo.getRideStops).mockResolvedValue(existing(1) as never)
    await addRideStop(USER_ID, RIDE_ID, STOP)
    expect(repo.appendRideStop).toHaveBeenCalledTimes(1)
  })

  it('follows the setting: with the limit at 1, a 2nd stop is refused', async () => {
    cfg.cityMaxStops = '1'
    vi.mocked(repo.getRideCoreById).mockResolvedValue(cityRide() as never)
    vi.mocked(repo.getRideStops).mockResolvedValue(existing(1) as never)
    await expect(addRideStop(USER_ID, RIDE_ID, STOP)).rejects.toMatchObject({ appCode: 'CITY_RIDE_STOP_LIMIT', message: 'A city ride can have at most 1 stop' })
  })

  it('a standard ride is not held to the city limit: a 3rd stop is accepted and no boundary query runs', async () => {
    vi.mocked(repo.getRideCoreById).mockResolvedValue(cityRide({ trip_mode: 'standard' }) as never)
    vi.mocked(repo.getRideStops).mockResolvedValue(existing(2) as never)
    vi.mocked(pool.query).mockClear()
    await addRideStop(USER_ID, RIDE_ID, STOP)
    expect(repo.appendRideStop).toHaveBeenCalledTimes(1)
    expect(vi.mocked(pool.query).mock.calls.some((c) => String(c[0]).includes('unnest'))).toBe(false)
  })
})

describe('maxStopsFor', () => {
  beforeEach(() => { cfg.cityMaxStops = null })
  it('a standard ride (or an unknown mode) gets the global limit', async () => {
    expect(await maxStopsFor('standard')).toBe(MAX_STOPS_PER_RIDE)
    expect(await maxStopsFor(null)).toBe(MAX_STOPS_PER_RIDE)
    expect(await maxStopsFor(undefined)).toBe(MAX_STOPS_PER_RIDE)
  })
  it('a city ride gets the configured limit, 2 when none is set', async () => {
    expect(await maxStopsFor('city')).toBe(2)
    cfg.cityMaxStops = '1'
    expect(await maxStopsFor('city')).toBe(1)
    cfg.cityMaxStops = '3'
    expect(await maxStopsFor('city')).toBe(3)
  })
  it('an unreadable or out-of-range setting falls back to 2, never to no limit', async () => {
    for (const bad of ['abc', '', '7', '-1', '2.5']) { cfg.cityMaxStops = bad; expect(await maxStopsFor('city')).toBe(2) }
  })
})
