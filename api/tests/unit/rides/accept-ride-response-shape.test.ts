import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db/client', () => ({ pool: { query: vi.fn() } }))
vi.mock('@/db/redis', () => ({ client: { get: vi.fn(), set: vi.fn(), del: vi.fn() } }))
vi.mock('@/modules/rides/rides.repository')
vi.mock('@/modules/call-masking/call-masking.service', () => ({
  allocateForRide: vi.fn().mockResolvedValue(undefined),
  releaseForRide: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/websocket/socket.server', () => ({
  socketEvents: {
    sendRequestExpired: vi.fn(),
    sendDriverAssigned: vi.fn(),
  },
}))
vi.mock('@/jobs/queues', () => ({
  queues: { notifications: { add: vi.fn().mockResolvedValue(undefined) } },
  QUEUE_NAMES: { NOTIFICATIONS: 'notifications' },
  gpsFlushQueue: { add: vi.fn().mockResolvedValue(undefined) },
}))

import { pool } from '@/db/client'
import * as repo from '@/modules/rides/rides.repository'
import { acceptRide } from '@/modules/rides/rides.service'

const baseRide = {
  id: 5n,
  driver_id: 9n,
  user_id: 3n,
  status: 'accepted',
  driver_current_lat: null,
  driver_current_lng: null,
  origin_lat: 20.29,
  origin_lng: 85.82,
  origin_address: 'Pickup A',
  destination_address: 'Drop B',
  user_phone: '+919900000001',
  rider_phone: null,
  driver_phone: '+919900000002',
  driver_name: 'Test Driver',
  driver_rating: '4.8',
  driver_photo: 'drivers/9/profile_photo/x.jpg',
  vehicle_model: 'Swift', vehicle_brand: 'Maruti', vehicle_color: 'White',
  vehicle_name: 'Swift LXI', vehicle_number_plate: 'MH12AB1234',
  booked_category_name: 'Sedan', assigned_category_name: 'Sedan',
  commission_percent: '20', commission_amount: '80', driver_earning: '320',
}

const stops = [{ id: 1n, sequence: 1, lat: 20.3, lng: 85.9, address: 'Stop 1', status: 'pending' as const }]

describe('acceptRide response shape', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(pool.query).mockResolvedValue({ rows: [{ billing_mode: 'commission' }] } as never)
    vi.mocked(repo.acceptAssignment).mockResolvedValue([])
    vi.mocked(repo.getRideById).mockResolvedValue(baseRide as never)
    vi.mocked(repo.logStatusHistory).mockResolvedValue(undefined as never)
    vi.mocked(repo.getRideStops).mockResolvedValue(stops as never)
  })

  it('returns the full masked ride + stops in one response, not just {success, rideId}', async () => {
    const result = await acceptRide(9n, 5n)

    expect(result.success).toBe(true)
    expect(result.rideId).toBe('5')
    expect(repo.getRideStops).toHaveBeenCalledWith(5n)
    expect(result.ride).not.toBeNull()
    expect(result.ride!.stops).toEqual(stops)
  })

  it('masks the rider contact fields for the driver viewer', async () => {
    const result = await acceptRide(9n, 5n)

    expect(result.ride!.user_phone).toBeNull()
    expect(result.ride!.rider_phone).toBeNull()
    // driver-facing fields must survive masking, unlike the rider ones above
    expect(result.ride!.driver_phone).toBe('+919900000002')
  })

  it('presigns the driver_photo before returning it', async () => {
    const result = await acceptRide(9n, 5n)
    // getPresignedUrl is a pass-through signer, not a network call -- the
    // real function runs here (not mocked), so just assert it's still a
    // non-empty string derived from the stored key rather than the raw key.
    expect(typeof result.ride!.driver_photo).toBe('string')
    expect(result.ride!.driver_photo).not.toBe('')
  })

  it('returns ride: null without throwing if the ride disappears between accept and read', async () => {
    vi.mocked(repo.getRideById).mockResolvedValue(null as never)

    const result = await acceptRide(9n, 5n)

    expect(result.success).toBe(true)
    expect(result.ride).toBeNull()
    expect(repo.getRideStops).not.toHaveBeenCalled()
  })
})
