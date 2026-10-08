import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetRideById = vi.fn()
const mockGetRideStops = vi.fn()
const mockFindNearbyDrivers = vi.fn()
const mockFindReturnCabDrivers = vi.fn()
const mockGetEligibleDriverCategoryIds = vi.fn()
const mockGetCategoryDisplayName = vi.fn()
const mockGetCategorySlug = vi.fn()
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
  getCategorySlug: (...a: unknown[]) => mockGetCategorySlug(...a),
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
    mockGetCategorySlug.mockResolvedValue('sedan')
  })

  it('drops return-cab drivers beyond the 10 km outstation cap', async () => {
    mockFindReturnCabDrivers.mockResolvedValue([
      { driver_id: 7, session_id: 70, lat: 1, lng: 1, distance_metres: 12_000 },
      { driver_id: 8, session_id: 80, lat: 1, lng: 1, distance_metres: 3_000 },
    ])
    await processBroadcast({
      rideId: '1', categoryId: '2', originLat: 20.29, originLng: 85.82,
      rideType: 'one_way', isReturnCab: true, destinationLat: 20.4, destinationLng: 85.9, broadcastRound: 1,
    })
    const ids = mockCreateRideAssignment.mock.calls.map(c => c[0].driverId)
    expect(ids).toEqual([8n])
  })

  it.each([
    ['one_way',    'sedan',         undefined, 3, 12_000],
    ['round_trip', 'sedan',         undefined, 3, 12_000],
    ['rental',     'sedan',         2,         1, 2_500],
    ['rental',     'sedan',         2,         3, 4_500],
    ['rental',     'auto_rickshaw', 2,         3, 4_000],
    ['rental',     'sedan',         4,         3, 6_000],
  ])('%s/%s/%sh round %s caps radius at %s m', async (rideType, slug, tripHours, round, expected) => {
    mockGetCategorySlug.mockResolvedValue(slug)
    await processBroadcast({
      rideId: '1', categoryId: '2', originLat: 20.29, originLng: 85.82,
      rideType, isReturnCab: false, broadcastRound: round, ...(tripHours ? { tripHours } : {}),
    })
    expect(mockFindNearbyDrivers).toHaveBeenCalledWith(expect.objectContaining({ radiusMetres: expected }))
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

describe('processBroadcast return-cab pickup-distance cap', () => {
  const base = {
    rideId: '1', categoryId: '2', originLat: 20.29, originLng: 85.82,
    isReturnCab: true, destinationLat: 20.4, destinationLng: 85.9, broadcastRound: 1,
  }
  const rc = (id: number, distance_metres: unknown, over: Record<string, unknown> = {}) =>
    ({ driver_id: id, session_id: id * 10, lat: 20.1 + id / 1000, lng: 85.1 + id / 1000, distance_metres, ...over })
  const assignedIds = () => mockCreateRideAssignment.mock.calls.map(c => c[0].driverId)

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetRideById.mockResolvedValue({ id: 1n, status: 'requested', origin_address: 'A', destination_address: 'B', total_estimated: '100' })
    mockGetRideStops.mockResolvedValue([])
    mockFindNearbyDrivers.mockResolvedValue([])
    mockFindReturnCabDrivers.mockResolvedValue([])
    mockGetCategoryDisplayName.mockResolvedValue('Sedan')
    mockGetCategorySlug.mockResolvedValue('sedan')
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('never assigns a return-cab driver whose distance is %s', async (_label, bad) => {
    mockFindReturnCabDrivers.mockResolvedValue([rc(7, bad), rc(8, 3_000)])
    await processBroadcast({ ...base, rideType: 'one_way' })
    expect(assignedIds()).toEqual([8n])
  })

  it('does not treat an unknown distance as 0 m: rental cap cannot be bypassed either', async () => {
    mockFindReturnCabDrivers.mockResolvedValue([rc(7, null)])
    await processBroadcast({ ...base, rideType: 'rental', tripHours: 2 })
    expect(mockCreateRideAssignment).not.toHaveBeenCalled()
  })

  it('keeps a driver exactly at the cap and drops one metre beyond it (outstation, 10 km)', async () => {
    mockFindReturnCabDrivers.mockResolvedValue([rc(1, 10_000), rc(2, 10_001), rc(3, 0)])
    await processBroadcast({ ...base, rideType: 'one_way' })
    expect(assignedIds().sort()).toEqual([1n, 3n])
  })

  it.each([
    // rideType, slug, tripHours, cap
    ['rental', 'sedan',         2,         2_500],
    ['rental', 'sedan',         undefined, 2_500],
    ['rental', 'auto_rickshaw', 2,         2_000],
    ['rental', 'sedan',         4,         4_000],
    ['round_trip', 'sedan',     undefined, 10_000],
  ])('applies the %s/%s/%sh cap of %s m to return-cab drivers', async (rideType, slug, tripHours, cap) => {
    mockGetCategorySlug.mockResolvedValue(slug)
    mockFindReturnCabDrivers.mockResolvedValue([rc(1, cap), rc(2, cap + 1)])
    await processBroadcast({ ...base, rideType, ...(tripHours ? { tripHours } : {}) })
    expect(assignedIds()).toEqual([1n])
  })

  it('assigns each accepted driver with their own coordinates, never the pickup point', async () => {
    mockFindReturnCabDrivers.mockResolvedValue([rc(5, 1_200, { lat: 20.111, lng: 85.222 })])
    await processBroadcast({ ...base, rideType: 'one_way' })
    expect(mockCreateRideAssignment).toHaveBeenCalledWith(
      expect.objectContaining({ driverId: 5n, sessionId: 50n, driverLat: 20.111, driverLng: 85.222 }),
    )
  })

  it('lets the standard search fill the remaining slots when return-cab drivers are filtered out', async () => {
    mockFindReturnCabDrivers.mockResolvedValue([rc(7, null), rc(8, 50_000)])
    mockFindNearbyDrivers.mockResolvedValue([
      { driver_id: 30n, session_id: 300n, lat: 20.29, lng: 85.82, distance_metres: 400 },
    ])
    await processBroadcast({ ...base, rideType: 'one_way' })
    // no return-cab driver survived, so the standard search may fill all 5 slots
    expect(mockFindNearbyDrivers).toHaveBeenCalledWith(expect.objectContaining({ maxDrivers: 5, radiusMetres: 10_000 }))
    expect(assignedIds()).toEqual([30n])
  })

  it('reduces the standard search size by the number of return-cab drivers kept', async () => {
    mockFindReturnCabDrivers.mockResolvedValue([rc(1, 900), rc(2, 1_100), rc(9, null)])
    await processBroadcast({ ...base, rideType: 'one_way' })
    expect(mockFindNearbyDrivers).toHaveBeenCalledWith(expect.objectContaining({ maxDrivers: 3 }))
  })

  it('fails the ride only after round 3 when every return-cab driver is filtered out', async () => {
    mockFindReturnCabDrivers.mockResolvedValue([rc(7, null)])
    await processBroadcast({ ...base, rideType: 'one_way', broadcastRound: 2 })
    expect(mockUpdateRideStatus).not.toHaveBeenCalled()
    await processBroadcast({ ...base, rideType: 'one_way', broadcastRound: 3 })
    expect(mockUpdateRideStatus).toHaveBeenCalledWith(1n, 'no_drivers')
    expect(mockCreateRideAssignment).not.toHaveBeenCalled()
  })

  it('does not consult return-cab drivers at all when the ride is not a return cab', async () => {
    await processBroadcast({ ...base, rideType: 'one_way', isReturnCab: false })
    expect(mockFindReturnCabDrivers).not.toHaveBeenCalled()
  })
})
