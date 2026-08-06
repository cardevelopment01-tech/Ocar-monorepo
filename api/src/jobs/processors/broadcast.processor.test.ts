import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetRideById = vi.fn()
const mockGetRideStops = vi.fn()
const mockFindNearbyDrivers = vi.fn()
const mockFindReturnCabDrivers = vi.fn()
const mockGetEligibleDriverCategoryIds = vi.fn()
const mockGetCategoryDisplayName = vi.fn()
const mockCreateRideAssignment = vi.fn()
const mockUpdateRideStatus = vi.fn()
const mockLogStatusHistory = vi.fn()

vi.mock('@/modules/rides/rides.repository', () => ({
  getRideById: (...a: unknown[]) => mockGetRideById(...a),
  getRideStops: (...a: unknown[]) => mockGetRideStops(...a),
  findNearbyDrivers: (...a: unknown[]) => mockFindNearbyDrivers(...a),
  findReturnCabDrivers: (...a: unknown[]) => mockFindReturnCabDrivers(...a),
  getEligibleDriverCategoryIds: (...a: unknown[]) => mockGetEligibleDriverCategoryIds(...a),
  getCategoryDisplayName: (...a: unknown[]) => mockGetCategoryDisplayName(...a),
  createRideAssignment: (...a: unknown[]) => mockCreateRideAssignment(...a),
  updateRideStatus: (...a: unknown[]) => mockUpdateRideStatus(...a),
  logStatusHistory: (...a: unknown[]) => mockLogStatusHistory(...a),
}))
vi.mock('@/modules/payments/payments.service', () => ({
  getMinWalletBalance: vi.fn().mockResolvedValue(100),
}))
vi.mock('@/websocket/socket.server', () => ({
  socketEvents: { sendRideRequest: vi.fn() },
}))
vi.mock('@/db/redis', () => ({
  client: { set: vi.fn() },
}))
vi.mock('@/jobs/queues', () => ({
  queues: { dispatch: { add: vi.fn() } },
  QUEUE_NAMES: { DISPATCH: 'dispatch' },
}))

import { processBroadcast } from './broadcast.processor'
import { socketEvents } from '@/websocket/socket.server'

describe('processBroadcast category eligibility per round', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetRideById.mockResolvedValue({ id: 1n, status: 'requested', origin_address: 'A', destination_address: 'B', total_estimated: '100' })
    mockGetRideStops.mockResolvedValue([])
    mockFindNearbyDrivers.mockResolvedValue([])
    mockFindReturnCabDrivers.mockResolvedValue([])
    mockGetCategoryDisplayName.mockResolvedValue('Sedan')
  })

  it('round 1 queries only the ride\'s exact category, without calling the eligibility helper', async () => {
    await processBroadcast({
      rideId: '1', categoryId: '2', originLat: 20.29, originLng: 85.82,
      rideType: 'one_way', isReturnCab: false, broadcastRound: 1,
    })

    expect(mockGetEligibleDriverCategoryIds).not.toHaveBeenCalled()
    expect(mockFindNearbyDrivers).toHaveBeenCalledWith(
      expect.objectContaining({ categoryIds: [2n] })
    )
  })

  it('round 2 widens to the fallback category set', async () => {
    mockGetEligibleDriverCategoryIds.mockResolvedValue([2n, 1n])

    await processBroadcast({
      rideId: '1', categoryId: '2', originLat: 20.29, originLng: 85.82,
      rideType: 'one_way', isReturnCab: false, broadcastRound: 2,
    })

    expect(mockGetEligibleDriverCategoryIds).toHaveBeenCalledWith(2n)
    expect(mockFindNearbyDrivers).toHaveBeenCalledWith(
      expect.objectContaining({ categoryIds: [2n, 1n] })
    )
  })

  it('round 3 also widens to the fallback category set for a return cab', async () => {
    mockGetEligibleDriverCategoryIds.mockResolvedValue([3n, 2n])

    await processBroadcast({
      rideId: '1', categoryId: '3', originLat: 20.29, originLng: 85.82,
      destinationLat: 20.46, destinationLng: 85.88,
      rideType: 'one_way', isReturnCab: true, broadcastRound: 3,
    })

    expect(mockFindReturnCabDrivers).toHaveBeenCalledWith(
      expect.objectContaining({ categoryIds: [3n, 2n] })
    )
  })

  it('includes the booked category name in the socket payload sent to each driver', async () => {
    mockFindNearbyDrivers.mockResolvedValue([
      { driver_id: 10n, session_id: 20n, lat: 20.29, lng: 85.82, distance_metres: 500 },
    ])
    mockGetCategoryDisplayName.mockResolvedValue('Sedan')

    await processBroadcast({
      rideId: '1', categoryId: '2', originLat: 20.29, originLng: 85.82,
      rideType: 'one_way', isReturnCab: false, broadcastRound: 1,
    })

    expect(socketEvents.sendRideRequest).toHaveBeenCalledWith(
      '10',
      expect.objectContaining({ rideCategoryName: 'Sedan' })
    )
  })
})
