import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/modules/rides/rides.repository', () => ({
  getRideCoreById: vi.fn(), getRideStops: vi.fn(), appendRideStop: vi.fn(), getRideStopCharge: vi.fn(),
  markStopStatus: vi.fn(), resequenceStops: vi.fn(),
}))
vi.mock('@/db/client', () => ({ pool: { query: vi.fn() }, withTransaction: vi.fn() }))
vi.mock('@/websocket/socket.server', () => ({
  socketEvents: { sendStopUpdated: vi.fn(), sendStopAdded: vi.fn() },
  getIO: vi.fn(() => ({ to: vi.fn(() => ({ emit: vi.fn() })) })),
}))
vi.mock('@/modules/notifications/notifications.service', () => ({
  notifyOwner: vi.fn(), notifyRideEvent: vi.fn(), notifyRidePaymentFailed: vi.fn(), notifyAllAdmins: vi.fn(),
}))
vi.mock('@/modules/notifications/templates.service', () => ({ renderTemplate: vi.fn().mockResolvedValue({ subject: 's', body: 'b' }) }))
vi.mock('@/modules/offers/settlement', async (orig) => ({ ...(await orig<object>()), finaliseDiscount: vi.fn() }))
vi.mock('@/modules/geo/geo.service', async (orig) => ({ ...(await orig<object>()), getRoute: vi.fn() }))

import * as repo from '@/modules/rides/rides.repository'
import { pool } from '@/db/client'
import { getRoute } from '@/modules/geo/geo.service'
import { skipRideStop, addRideStop } from '@/modules/rides/rides.service'

const USER = BigInt(7)
const RIDE = BigInt(101)
const ride = (type = 'one_way') => ({
  id: RIDE, user_id: USER, driver_id: null, status: 'in_progress', ride_type: type, category_id: BigInt(1), drop_arrived_at: null,
  origin_lat: 20.27, origin_lng: 85.84, dest_lat: 20.30, dest_lng: 85.86,
}) as never
const s1 = { id: BigInt(1), sequence: 1, lat: 20.28, lng: 85.85, status: 'pending' }
// 12/km, no per-minute, min fare 50, no surge: every 10 km is exactly 120.
const snapRow = { estimated_km: '20', estimated_min: '40', is_return_cab: false, surge_multiplier: '1', rate_per_km: '12', rate_per_min: '0', min_fare: '50', base_fare: '0', return_rate_per_km: null }
const updateCall = () => vi.mocked(pool.query).mock.calls.find(c => String(c[0]).includes('estimated_km = $2'))

describe('one-way stop re-pricing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // every routed leg is 10 km / 20 min
    vi.mocked(getRoute).mockResolvedValue({ distanceKm: 10, durationMin: 20, source: 'google' } as never)
    vi.mocked(pool.query).mockImplementation((async (sql: string) =>
      String(sql).includes('FROM fare_snapshots fs') ? { rows: [snapRow], rowCount: 1 } : { rows: [], rowCount: 1 }) as never)
    vi.mocked(repo.getRideStopCharge).mockResolvedValue(0)
    vi.mocked(repo.getRideStops).mockResolvedValue([s1] as never)
  })

  it('lowers the fare by the km a skipped stop no longer needs', async () => {
    vi.mocked(repo.getRideCoreById).mockResolvedValue(ride())
    vi.mocked(repo.markStopStatus).mockResolvedValue({ sequence: 1, status: 'skipped', reached_at: null, stop_charge_applied: '0' } as never)
    await skipRideStop(USER, RIDE, 1)
    // O→S1→D (20 km) becomes O→D (10 km): 10 km less = 120 off
    expect(updateCall()![1]).toEqual([RIDE, 10, 20, -120, 0, 0, 0, -120])
  })

  it('raises the fare by the km an added stop needs', async () => {
    vi.mocked(repo.getRideCoreById).mockResolvedValue(ride())
    vi.mocked(repo.appendRideStop).mockResolvedValue({ id: BigInt(2), sequence: 2, lat: 20.29, lng: 85.85, status: 'pending' } as never)
    await addRideStop(USER, RIDE, { lat: 20.29, lng: 85.85, address: 'x' })
    // O→S1→D (20 km) becomes O→S1→S2→D (30 km): 10 km more = 120 on
    expect(updateCall()![1]).toEqual([RIDE, 30, 60, 120, 0, 0, 0, 120])
  })

  it('leaves the fare alone when only a straight-line guess is available', async () => {
    vi.mocked(getRoute).mockResolvedValue({ distanceKm: 10, durationMin: 20, source: 'fallback' } as never)
    vi.mocked(repo.getRideCoreById).mockResolvedValue(ride())
    vi.mocked(repo.markStopStatus).mockResolvedValue({ sequence: 1, status: 'skipped', reached_at: null, stop_charge_applied: '0' } as never)
    await skipRideStop(USER, RIDE, 1)
    expect(updateCall()).toBeUndefined()
  })

  it('does not touch a round trip (billed on what was driven)', async () => {
    vi.mocked(repo.getRideCoreById).mockResolvedValue(ride('round_trip'))
    vi.mocked(repo.markStopStatus).mockResolvedValue({ sequence: 1, status: 'skipped', reached_at: null, stop_charge_applied: '0' } as never)
    await skipRideStop(USER, RIDE, 1)
    expect(getRoute).not.toHaveBeenCalled()
  })
})
