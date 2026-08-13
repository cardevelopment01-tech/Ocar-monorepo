import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/websocket/socket.server', () => ({ socketEvents: { sendRideRequest: vi.fn() } }))
vi.mock('@/modules/payments/payments.service', () => ({ getMinWalletBalance: vi.fn().mockResolvedValue(0) }))
vi.mock('@/modules/notifications/notifications.service', () => ({ sendRideRequestPushOnce: vi.fn().mockResolvedValue(undefined) }))
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
    expect(sendRideRequestPushOnce).toHaveBeenCalledWith('354', '8', 'A', 'B', expect.any(Number))
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
