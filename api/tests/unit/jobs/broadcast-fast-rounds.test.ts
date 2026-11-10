import { describe, it, expect, vi, beforeEach } from 'vitest'

// Dispatch phase 0 (docs/superpowers/plans/2026-11-10-dispatch-phase0-fast-rounds-and-logging.md): a round that finds nobody widens at once
// (switch dispatch_fast_rounds_enabled), and every round that does work is recorded (switch dispatch_decision_log_enabled).

vi.mock('@/modules/geo/geo.service', () => ({ getRoute: vi.fn().mockRejectedValue(new Error('no route in this test')) }))
vi.mock('@/websocket/socket.server', () => ({
  socketEvents: { sendRideRequest: vi.fn(), sendRideStatusUpdate: vi.fn() },
  hasLiveDriverSocket: vi.fn(),
}))
vi.mock('@/modules/payments/payments.service', () => ({ getMinWalletBalance: vi.fn().mockResolvedValue(0) }))
vi.mock('@/modules/notifications/notifications.service', () => ({
  sendRideRequestPushOnce: vi.fn().mockResolvedValue(undefined),
  notifyRideEvent: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/db/client', () => ({ pool: { query: vi.fn() } }))
vi.mock('@/modules/offers/settlement', () => ({ releaseForRide: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/db/redis', () => ({ client: { set: vi.fn().mockResolvedValue('OK') } }))
vi.mock('@/jobs/queues', () => ({
  queues: { dispatch: { add: vi.fn() } },
  QUEUE_NAMES: { DISPATCH: 'dispatch' },
}))
vi.mock('@/jobs/processors/dispatch-metrics', () => ({
  fastRoundsEnabled: vi.fn(),
  decisionLogEnabled: vi.fn(),
  recordRound: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/modules/rides/rides.repository', () => ({
  getRideById: vi.fn(),
  getRideStops: vi.fn().mockResolvedValue([]),
  getCategoryDisplayName: vi.fn().mockResolvedValue('Sedan'),
  getEligibleDriverCategoryIds: vi.fn().mockResolvedValue([1n, 2n]),
  getCategorySlug: vi.fn().mockResolvedValue('sedan'),
  findReturnCabDrivers: vi.fn().mockResolvedValue([]),
  findNearbyDrivers: vi.fn(),
  getLiveOfferDriverIds: vi.fn().mockResolvedValue([]),
  getDeclinedDriverIds: vi.fn().mockResolvedValue([]),
  getOfferedDrivers: vi.fn().mockResolvedValue([]),
  getBusyDriverIds: vi.fn().mockResolvedValue([]),
  createRideAssignment: vi.fn().mockResolvedValue(undefined),
  updateRideStatusCAS: vi.fn().mockResolvedValue({ id: 1n }),
  logStatusHistory: vi.fn(),
  expireLapsedOffers: vi.fn().mockResolvedValue(undefined),
  getRideCoreById: vi.fn().mockResolvedValue(null),
}))

import * as repo from '@/modules/rides/rides.repository'
import { socketEvents, hasLiveDriverSocket } from '@/websocket/socket.server'
import { fastRoundsEnabled, decisionLogEnabled, recordRound } from '@/jobs/processors/dispatch-metrics'
import { processBroadcast, type BroadcastJobData } from '@/jobs/processors/broadcast.processor'

// A short rental (2.5 km in round 1, 3.5 km in round 2, 4.5 km in round 3).
const data = (round = 1, over: Partial<BroadcastJobData> = {}): BroadcastJobData => ({
  rideId: '700', categoryId: '1', originLat: 20.2535, originLng: 85.7583, rideType: 'rental', isReturnCab: false, broadcastRound: round, ...over,
})
const drv = (id: number, metres: number) =>
  ({ driver_id: BigInt(id), session_id: BigInt(id), mode: 'standard', lat: 20.27, lng: 85.77, distance_metres: metres, is_available: true })
const ride = { status: 'requested', origin_address: 'A', destination_address: 'B', dispatch_variant: 1 } as never
const searches = () => vi.mocked(repo.findNearbyDrivers).mock.calls.map((c) => c[0] as { radiusMetres: number; categoryIds: bigint[] })
const lastRecord = () => vi.mocked(recordRound).mock.calls.at(-1)![0]

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(repo.getRideById).mockResolvedValue(ride)
  vi.mocked(repo.getLiveOfferDriverIds).mockResolvedValue([])
  vi.mocked(repo.getDeclinedDriverIds).mockResolvedValue([])
  vi.mocked(repo.getOfferedDrivers).mockResolvedValue([])
  vi.mocked(repo.getBusyDriverIds).mockResolvedValue([])
  vi.mocked(repo.getEligibleDriverCategoryIds).mockResolvedValue([1n, 2n])
  vi.mocked(hasLiveDriverSocket).mockResolvedValue(true)
  vi.mocked(fastRoundsEnabled).mockResolvedValue(true)
  vi.mocked(decisionLogEnabled).mockResolvedValue(true)
})

describe('fast rounds', () => {
  it('round 1 finds nobody at 2.5 km: widens in the same round and offers the first non-empty step', async () => {
    vi.mocked(repo.findNearbyDrivers)
      .mockResolvedValueOnce([])                                    // 2.5 km, exact category
      .mockResolvedValueOnce([])                                    // 2.5 km, fallback categories
      .mockResolvedValueOnce([drv(242, 3000)] as never)             // 3.5 km, exact category
    await processBroadcast(data(1))
    expect(searches().map((s) => s.radiusMetres)).toEqual([2500, 2500, 3500])
    expect(searches()[1]!.categoryIds).toEqual([1n, 2n])            // the second search is the fallback categories
    expect(searches()[2]!.categoryIds).toEqual([1n])                // the third is the exact category, wider
    expect(socketEvents.sendRideRequest).toHaveBeenCalledTimes(1)
    expect(vi.mocked(repo.createRideAssignment).mock.calls[0]![0]).toMatchObject({ broadcastRound: 1, log: { radiusM: 3500, fastStep: 2, rank: 1, straightM: 3000, reach: 'live' } })
    expect(lastRecord()).toMatchObject({ round: 1, radiusM: 2500, widestRadiusM: 3500, fastStep: 2, found: 1, offered: 1, outcome: 'offered' })
  })

  it('never searches past round 3\'s radius, and an empty ride-start round is recorded as empty, not closed', async () => {
    vi.mocked(repo.findNearbyDrivers).mockResolvedValue([])
    await processBroadcast(data(1))
    expect(Math.max(...searches().map((s) => s.radiusMetres))).toBe(4500)
    expect(socketEvents.sendRideRequest).not.toHaveBeenCalled()
    expect(repo.updateRideStatusCAS).not.toHaveBeenCalled()         // the ride still closes only in round 3
    expect(lastRecord()).toMatchObject({ outcome: 'empty', found: 0, widestRadiusM: 4500 })
    expect(lastRecord().diagFor).toBeDefined()                      // "why nobody" is asked for
  })

  it('round 3 does not widen and closes the ride as before', async () => {
    vi.mocked(repo.findNearbyDrivers).mockResolvedValue([])
    await processBroadcast(data(3))
    expect(searches()).toHaveLength(1)
    expect(repo.updateRideStatusCAS).toHaveBeenCalledWith(700n, 'requested', 'no_drivers')
    expect(lastRecord()).toMatchObject({ round: 3, outcome: 'closed' })
  })

  it('round 2 widens by radius only', async () => {
    vi.mocked(repo.findNearbyDrivers).mockResolvedValueOnce([]).mockResolvedValueOnce([drv(9, 4200)] as never)
    await processBroadcast(data(2))
    expect(searches().map((s) => s.radiusMetres)).toEqual([3500, 4500])
    expect(lastRecord()).toMatchObject({ fastStep: 1, widestRadiusM: 4500, outcome: 'offered' })
  })

  it.each([
    ['the switch is off', () => vi.mocked(fastRoundsEnabled).mockResolvedValue(false), data(1)],
    ['the job carries its own radius', () => {}, data(1, { radiusMetres: 2000 })],
    ['it is a return-cab match', () => {}, data(1, { isReturnCab: true })],
  ])('does not widen when %s', async (_name, arrange, job) => {
    arrange()
    vi.mocked(repo.findNearbyDrivers).mockResolvedValue([])
    await processBroadcast(job)
    expect(searches()).toHaveLength(1)
  })

  it('does not widen for a ride on the old dispatch rules (variant 0)', async () => {
    vi.mocked(repo.getRideById).mockResolvedValue({ status: 'requested', dispatch_variant: 0 } as never)
    vi.mocked(repo.findNearbyDrivers).mockResolvedValue([])
    await processBroadcast(data(1))
    expect(searches()).toHaveLength(1)
    expect(fastRoundsEnabled).not.toHaveBeenCalled()
    expect(vi.mocked(recordRound).mock.calls.at(-1)![1]).toBe(false) // the log needs phase 1 too
  })

  it('skips the drivers that already hold a live offer, also when widening', async () => {
    vi.mocked(repo.getLiveOfferDriverIds).mockResolvedValue([5n])
    vi.mocked(repo.findNearbyDrivers).mockResolvedValue([])
    await processBroadcast(data(2))
    for (const call of vi.mocked(repo.findNearbyDrivers).mock.calls) expect((call[0] as { excludeDriverIds?: bigint[] }).excludeDriverIds).toEqual([5n])
    expect(lastRecord()).toMatchObject({ liveSkipped: 1 })
  })
})

describe('decision log', () => {
  it('a normal full wave is recorded without asking "why few"', async () => {
    const five = [1, 2, 3, 4, 5].map((i) => drv(i, 1000 + i)) as never
    vi.mocked(repo.findNearbyDrivers).mockResolvedValue(five)
    await processBroadcast(data(1))
    expect(lastRecord()).toMatchObject({ found: 5, offered: 5, fastStep: 0, outcome: 'offered' })
    expect(lastRecord().diagFor).toBeUndefined()
    expect(searches()).toHaveLength(1)
    const logs = vi.mocked(repo.createRideAssignment).mock.calls.map((c) => (c[0] as { log: { rank: number } }).log.rank)
    expect(logs).toEqual([1, 2, 3, 4, 5])
  })

  it('a backgrounded driver and one with no live socket are recorded as such', async () => {
    vi.mocked(repo.findNearbyDrivers).mockResolvedValue([{ ...drv(1, 800), is_available: false }, drv(2, 900)] as never)
    vi.mocked(hasLiveDriverSocket).mockImplementation(async (id: string) => id !== '2')
    await processBroadcast(data(1))
    const reach = vi.mocked(repo.createRideAssignment).mock.calls.map((c) => (c[0] as { log: { reach: string } }).log.reach)
    expect(reach).toEqual(['background', 'no_socket'])
  })

  it('with the log switch off nothing extra is written on the offers', async () => {
    vi.mocked(decisionLogEnabled).mockResolvedValue(false)
    vi.mocked(repo.findNearbyDrivers).mockResolvedValue([drv(1, 800)] as never)
    await processBroadcast(data(1))
    expect(vi.mocked(repo.createRideAssignment).mock.calls[0]![0]).not.toHaveProperty('log')
    expect(vi.mocked(recordRound).mock.calls.at(-1)![1]).toBe(false)
  })
})
