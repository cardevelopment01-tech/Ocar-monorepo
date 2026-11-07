import { describe, it, expect, vi, beforeEach } from 'vitest'

const { getRoute } = vi.hoisted(() => ({ getRoute: vi.fn() }))
vi.mock('@/modules/geo/geo.service', () => ({ getRoute }))
vi.mock('@/websocket/socket.server', () => ({ socketEvents: { sendRideRequest: vi.fn() } }))
vi.mock('@/modules/payments/payments.service', () => ({ getMinWalletBalance: vi.fn().mockResolvedValue(0) }))
vi.mock('@/modules/notifications/notifications.service', () => ({ sendRideRequestPushOnce: vi.fn().mockResolvedValue(undefined), notifyRideEvent: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/db/redis', () => ({ client: { set: vi.fn().mockResolvedValue('OK') } }))
vi.mock('@/jobs/queues', () => ({
  queues: { dispatch: { add: vi.fn() } },
  QUEUE_NAMES: { DISPATCH: 'dispatch' },
}))
vi.mock('@/modules/rides/rides.repository', () => ({
  getRideById: vi.fn(),
  getRideStops: vi.fn().mockResolvedValue([]),
  getCategoryDisplayName: vi.fn().mockResolvedValue('Sedan'),
  getEligibleDriverCategoryIds: vi.fn(),
  findReturnCabDrivers: vi.fn().mockResolvedValue([]),
  findNearbyDrivers: vi.fn(),
  createRideAssignment: vi.fn().mockResolvedValue(undefined),
  updateRideStatus: vi.fn(),
  logStatusHistory: vi.fn(),
  expireLapsedOffers: vi.fn().mockResolvedValue(undefined),
  getRideCoreById: vi.fn().mockResolvedValue(null),
}))

import * as repo from '@/modules/rides/rides.repository'
import { socketEvents } from '@/websocket/socket.server'
import { sendRideRequestPushOnce } from '@/modules/notifications/notifications.service'
import { processBroadcast, type BroadcastJobData } from '@/jobs/processors/broadcast.processor'

const baseData: BroadcastJobData = {
  rideId: '354',
  categoryId: '2',
  originLat: 20.29,
  originLng: 85.82,
  rideType: 'one_way',
  isReturnCab: false,
  broadcastRound: 1,
}

describe('processBroadcast — the distance on the offer is the road distance', () => {
  const driver = { driver_id: 8n, session_id: 1n, mode: 'standard', lat: 20.3, lng: 85.8, distance_metres: 700, is_available: true }
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(repo.getRideById).mockResolvedValue({ status: 'requested', origin_address: 'A', destination_address: 'B' } as never)
    vi.mocked(repo.findNearbyDrivers).mockResolvedValue([driver] as never)
  })
  const offered = () => vi.mocked(socketEvents.sendRideRequest).mock.calls[0]![1] as { distanceToPickup: number }

  it('shows how far the driver must drive, not the straight line (700 m straight, 2.1 km by road)', async () => {
    getRoute.mockResolvedValue({ distanceKm: 2.1, source: 'google' })
    await processBroadcast(baseData)
    expect(offered().distanceToPickup).toBe(2100)
  })
  it.each([
    ['the route call fails', () => getRoute.mockRejectedValue(new Error('down'))],
    ['Google is unreachable and only a straight line comes back', () => getRoute.mockResolvedValue({ distanceKm: 0.7, source: 'fallback' })],
    ['the route call hangs', () => getRoute.mockReturnValue(new Promise(() => {}))],
  ])('keeps the straight-line figure when %s, and still sends the offer', async (_n, arrange) => {
    vi.useFakeTimers()
    arrange()
    const done = processBroadcast(baseData)
    await vi.advanceTimersByTimeAsync(2_100)
    await done
    vi.useRealTimers()
    expect(offered().distanceToPickup).toBe(700)
  })
  it('never shows less than the straight line', async () => {
    getRoute.mockResolvedValue({ distanceKm: 0.3, source: 'google' })
    await processBroadcast(baseData)
    expect(offered().distanceToPickup).toBe(700)
  })
})

describe('processBroadcast — immediate push for a backgrounded match', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(repo.getRideById).mockResolvedValue({
      status: 'requested', origin_address: 'A', destination_address: 'B',
    } as never)
  })

  it('push-notifies a backgrounded (is_available=false) match immediately, alongside the socket emit', async () => {
    vi.mocked(repo.findNearbyDrivers).mockResolvedValue([
      { driver_id: 8n, session_id: 1n, mode: 'standard', lat: 20.3, lng: 85.8, distance_metres: 500, is_available: false },
    ] as never)

    await processBroadcast(baseData)

    expect(socketEvents.sendRideRequest).toHaveBeenCalledWith('8', expect.any(Object))
    expect(sendRideRequestPushOnce).toHaveBeenCalledWith('354', '8', 'A', 'B', expect.any(Number), expect.objectContaining({ rideType: expect.any(String), distanceToPickup: expect.any(Number) }))
  })

  it('the immediate push carries the fare the driver will collect: the discounted payable, not the gross estimate', async () => {
    vi.mocked(repo.getRideById).mockResolvedValue({
      status: 'requested', origin_address: 'A', destination_address: 'B', total_estimated: '454.00', cash_due: '363.20', discount_amount: '90.80',
    } as never)
    vi.mocked(repo.findNearbyDrivers).mockResolvedValue([
      { driver_id: 8n, session_id: 1n, mode: 'standard', lat: 20.3, lng: 85.8, distance_metres: 500, is_available: false },
    ] as never)

    await processBroadcast(baseData)

    expect(sendRideRequestPushOnce).toHaveBeenCalledWith('354', '8', 'A', 'B', expect.any(Number), expect.objectContaining({ estimatedFare: 363.2 }))
    expect(socketEvents.sendRideRequest).toHaveBeenCalledWith('8', expect.objectContaining({ estimatedFare: 363.2 }))
  })

  it('without an offer the push still carries the estimate', async () => {
    vi.mocked(repo.getRideById).mockResolvedValue({
      status: 'requested', origin_address: 'A', destination_address: 'B', total_estimated: '454.00',
    } as never)
    vi.mocked(repo.findNearbyDrivers).mockResolvedValue([
      { driver_id: 8n, session_id: 1n, mode: 'standard', lat: 20.3, lng: 85.8, distance_metres: 500, is_available: false },
    ] as never)

    await processBroadcast(baseData)

    expect(sendRideRequestPushOnce).toHaveBeenCalledWith('354', '8', 'A', 'B', expect.any(Number), expect.objectContaining({ estimatedFare: 454 }))
  })

  it('does not immediately push a live (is_available=true) match', async () => {
    vi.mocked(repo.findNearbyDrivers).mockResolvedValue([
      { driver_id: 9n, session_id: 2n, mode: 'standard', lat: 20.3, lng: 85.8, distance_metres: 500, is_available: true },
    ] as never)

    await processBroadcast(baseData)

    expect(socketEvents.sendRideRequest).toHaveBeenCalledWith('9', expect.any(Object))
    expect(sendRideRequestPushOnce).not.toHaveBeenCalled()
  })
})
