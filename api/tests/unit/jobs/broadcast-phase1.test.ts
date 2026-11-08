import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Dispatch phase 1 (docs/superpowers/plans/2026-11-08-dispatch-spread-to-more-drivers.md): rides stamped dispatch_variant 1 never re-send a still
// open offer, cap open offers per ride, push at once to a driver with no live connection (otherwise ack-check after 2 s), and use a 30 s window
// for a backgrounded driver. dispatch_variant 0 must behave exactly as before.

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
vi.mock('@/modules/rides/rides.repository', () => ({
  getRideById: vi.fn(),
  getRideStops: vi.fn().mockResolvedValue([]),
  getCategoryDisplayName: vi.fn().mockResolvedValue('Sedan'),
  getEligibleDriverCategoryIds: vi.fn().mockResolvedValue([2n]),
  getCategorySlug: vi.fn().mockResolvedValue('sedan'),
  findReturnCabDrivers: vi.fn().mockResolvedValue([]),
  findNearbyDrivers: vi.fn(),
  getLiveOfferDriverIds: vi.fn().mockResolvedValue([]),
  getDeclinedDriverIds: vi.fn().mockResolvedValue([]),
  createRideAssignment: vi.fn().mockResolvedValue(undefined),
  updateRideStatusCAS: vi.fn().mockResolvedValue({ id: 1n }),
  logStatusHistory: vi.fn(),
  expireLapsedOffers: vi.fn().mockResolvedValue(undefined),
  getRideCoreById: vi.fn().mockResolvedValue(null),
}))

import * as repo from '@/modules/rides/rides.repository'
import { socketEvents, hasLiveDriverSocket } from '@/websocket/socket.server'
import { sendRideRequestPushOnce } from '@/modules/notifications/notifications.service'
import { queues } from '@/jobs/queues'
import { processBroadcast, type BroadcastJobData } from '@/jobs/processors/broadcast.processor'

const data = (round = 1): BroadcastJobData => ({
  rideId: '700', categoryId: '2', originLat: 20.29, originLng: 85.82, rideType: 'one_way', isReturnCab: false, broadcastRound: round,
})
const drv = (id: number, over: Record<string, unknown> = {}) =>
  ({ driver_id: BigInt(id), session_id: BigInt(id), mode: 'standard', lat: 20.3, lng: 85.8, distance_metres: 500 + id, is_available: true, ...over })
const ride = (variant?: number) =>
  ({ status: 'requested', origin_address: 'A', destination_address: 'B', ...(variant === undefined ? {} : { dispatch_variant: variant }) }) as never

const ackDelays = () => vi.mocked(queues.dispatch.add).mock.calls.filter((c) => c[0] === 'broadcast_ride_ack_check').map((c) => (c[2] as { delay: number }).delay)
const emitted = () => vi.mocked(socketEvents.sendRideRequest).mock.calls.map((c) => c[0])
const nearbyArg = () => vi.mocked(repo.findNearbyDrivers).mock.calls[0]![0] as { maxDrivers: number; excludeDriverIds?: bigint[] }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(repo.getLiveOfferDriverIds).mockResolvedValue([])
  vi.mocked(repo.getDeclinedDriverIds).mockResolvedValue([])
  vi.mocked(repo.findNearbyDrivers).mockResolvedValue([drv(1), drv(2)] as never)
  vi.mocked(hasLiveDriverSocket).mockResolvedValue(true)
})

describe('dispatch_variant 0 (every ride booked before the switch) behaves exactly as before', () => {
  it.each([[undefined], [0]])('variant %s: no live-offer lookup, no exclusion, 5 drivers, 4 s ack wait, no presence check', async (variant) => {
    vi.mocked(repo.getRideById).mockResolvedValue(ride(variant))
    await processBroadcast(data())
    expect(repo.getLiveOfferDriverIds).not.toHaveBeenCalled()
    expect(nearbyArg().maxDrivers).toBe(5)
    expect(nearbyArg().excludeDriverIds).toBeUndefined()
    expect(ackDelays()).toEqual([4000, 4000])
    expect(hasLiveDriverSocket).not.toHaveBeenCalled()
    expect(sendRideRequestPushOnce).not.toHaveBeenCalled()
  })

  it('a backgrounded driver keeps the 45 s window', async () => {
    vi.mocked(repo.getRideById).mockResolvedValue(ride(0))
    vi.mocked(repo.findNearbyDrivers).mockResolvedValue([drv(1, { is_available: false })] as never)
    await processBroadcast(data())
    expect((vi.mocked(socketEvents.sendRideRequest).mock.calls[0]![1] as { timeoutSeconds: number }).timeoutSeconds).toBe(45)
  })
})

describe('dispatch_variant 1: a still-open offer is never re-sent', () => {
  beforeEach(() => { vi.mocked(repo.getRideById).mockResolvedValue(ride(1)) })

  it('leaves drivers who hold an open offer out of the pick', async () => {
    vi.mocked(repo.getLiveOfferDriverIds).mockResolvedValue([3n, 4n])
    await processBroadcast(data(2))
    expect(nearbyArg().excludeDriverIds).toEqual([3n, 4n])
  })

  it('also drops an open-offer driver that comes back from the query (never re-sent, never re-created)', async () => {
    vi.mocked(repo.getLiveOfferDriverIds).mockResolvedValue([1n])
    await processBroadcast(data(2))
    expect(emitted()).toEqual(['2'])
    expect(repo.createRideAssignment).toHaveBeenCalledTimes(1)
  })

  it('caps open offers per ride at twice a round: 8 open leaves room for 2 new drivers', async () => {
    vi.mocked(repo.getLiveOfferDriverIds).mockResolvedValue([10n, 11n, 12n, 13n, 14n, 15n, 16n, 17n])
    await processBroadcast(data(2))
    expect(nearbyArg().maxDrivers).toBe(2)
  })

  it('with 10 open offers it adds none and does not even query for drivers', async () => {
    vi.mocked(repo.getLiveOfferDriverIds).mockResolvedValue([10n, 11n, 12n, 13n, 14n, 15n, 16n, 17n, 18n, 19n])
    await processBroadcast(data(2))
    expect(repo.findNearbyDrivers).not.toHaveBeenCalled()
    expect(repo.createRideAssignment).not.toHaveBeenCalled()
    expect(socketEvents.sendRideRequest).not.toHaveBeenCalled()
  })

  it('still closes the ride as no_drivers after round 3 when nothing new can be offered (unchanged ending)', async () => {
    vi.mocked(repo.findNearbyDrivers).mockResolvedValue([])
    await processBroadcast(data(3))
    expect(repo.updateRideStatusCAS).toHaveBeenCalledWith(700n, 'requested', 'no_drivers')
  })

  it('the offer carries which round it is (offerRound), for the driver app to tell a re-send from a new offer', async () => {
    await processBroadcast(data(2))
    expect((vi.mocked(socketEvents.sendRideRequest).mock.calls[0]![1] as { offerRound: number }).offerRound).toBe(2)
    const ackJob = vi.mocked(queues.dispatch.add).mock.calls.find((c) => c[0] === 'broadcast_ride_ack_check')![1] as { offerRound: number }
    expect(ackJob.offerRound).toBe(2)
  })
})

describe('dispatch_variant 1: delivery', () => {
  beforeEach(() => { vi.mocked(repo.getRideById).mockResolvedValue(ride(1)) })

  it('the socket-ack wait before the fallback push is 2 s, not 4 s', async () => {
    await processBroadcast(data())
    expect(ackDelays()).toEqual([2000, 2000])
  })

  it('pushes at once to a driver with no live connection, and not to one who is connected', async () => {
    vi.mocked(hasLiveDriverSocket).mockImplementation(async (id: string) => id === '1')
    await processBroadcast(data())
    expect(vi.mocked(sendRideRequestPushOnce).mock.calls.map((c) => c[1])).toEqual(['2'])
  })

  it('a driver who looks foregrounded but has no live connection gets the 30 s window too; a connected one keeps 20 s', async () => {
    vi.mocked(hasLiveDriverSocket).mockImplementation(async (id: string) => id === '1')
    await processBroadcast(data())
    const windows = Object.fromEntries(vi.mocked(socketEvents.sendRideRequest).mock.calls.map((c) => [c[0], (c[1] as { timeoutSeconds: number }).timeoutSeconds]))
    expect(windows).toEqual({ '1': 20, '2': 30 })
  })

  it('a backgrounded driver gets a 30 s window (the push cannot outlive its 30 s time-to-live) and one push, not two', async () => {
    vi.mocked(repo.findNearbyDrivers).mockResolvedValue([drv(1, { is_available: false })] as never)
    vi.mocked(hasLiveDriverSocket).mockResolvedValue(false)
    await processBroadcast(data())
    expect((vi.mocked(socketEvents.sendRideRequest).mock.calls[0]![1] as { timeoutSeconds: number }).timeoutSeconds).toBe(30)
    expect(hasLiveDriverSocket).not.toHaveBeenCalled()
    expect(sendRideRequestPushOnce).toHaveBeenCalledTimes(1)
  })
})

describe('dispatch_variant 1: last round with offers still open', () => {
  beforeEach(() => { vi.mocked(repo.getRideById).mockResolvedValue(ride(1)) })

  it('does not close the ride as no_drivers while an earlier offer is live; it looks again in 5 s', async () => {
    vi.mocked(repo.getLiveOfferDriverIds).mockResolvedValue([1n])
    vi.mocked(repo.findNearbyDrivers).mockResolvedValue([])
    await processBroadcast(data(3))
    expect(repo.updateRideStatusCAS).not.toHaveBeenCalled()
    const again = vi.mocked(queues.dispatch.add).mock.calls.find((c) => c[0] === 'broadcast_ride')!
    expect((again[1] as { broadcastRound: number }).broadcastRound).toBe(3)
    expect((again[2] as { delay: number }).delay).toBe(5000)
  })
})

describe('dispatch_variant 2: nearest drivers get a head start in round 1', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(repo.getRideById).mockResolvedValue(ride(2))
    vi.mocked(repo.findNearbyDrivers).mockResolvedValue([drv(1), drv(2), drv(3), drv(4)] as never)
  })
  afterEach(() => { vi.useRealTimers() })

  it('offers the nearest 2 at once and the rest only after the head start', async () => {
    const done = processBroadcast(data(1))
    await vi.advanceTimersByTimeAsync(100)
    expect(emitted()).toEqual(['1', '2'])
    await vi.advanceTimersByTimeAsync(2500)
    await done
    expect(emitted()).toEqual(['1', '2', '3', '4'])
  })

  it('skips the rest if the ride was taken during the head start', async () => {
    const done = processBroadcast(data(1))
    await vi.advanceTimersByTimeAsync(100)
    vi.mocked(repo.getRideById).mockResolvedValue({ status: 'accepted' } as never)
    await vi.advanceTimersByTimeAsync(2500)
    await done
    expect(emitted()).toEqual(['1', '2'])
  })

  it('later rounds, and 2 or fewer drivers, are sent at once', async () => {
    await processBroadcast(data(2))
    expect(emitted()).toEqual(['1', '2', '3', '4'])
    vi.mocked(socketEvents.sendRideRequest).mockClear()
    vi.mocked(repo.findNearbyDrivers).mockResolvedValue([drv(1), drv(2)] as never)
    await processBroadcast(data(1))
    expect(emitted()).toEqual(['1', '2'])
  })
})

describe('dispatch_variant 1: a driver who declined is not handed the ride straight back', () => {
  beforeEach(() => { vi.mocked(repo.getRideById).mockResolvedValue(ride(1)) })

  it('rounds 1-2 leave out drivers who declined', async () => {
    vi.mocked(repo.getDeclinedDriverIds).mockResolvedValue([7n])
    await processBroadcast(data(2))
    expect(nearbyArg().excludeDriverIds).toEqual([7n])
  })

  it('the last round may return to them (and does not even look them up)', async () => {
    await processBroadcast(data(3))
    expect(repo.getDeclinedDriverIds).not.toHaveBeenCalled()
    expect(nearbyArg().excludeDriverIds).toBeUndefined()
  })
})

describe('dispatch_variant 1: a thin pool is not wasted on drivers who declined', () => {
  it('if skipping the declined leaves nobody, they are offered the ride rather than the round being burned', async () => {
    vi.mocked(repo.getRideById).mockResolvedValue(ride(1))
    vi.mocked(repo.getDeclinedDriverIds).mockResolvedValue([1n])
    vi.mocked(repo.findNearbyDrivers).mockResolvedValueOnce([]).mockResolvedValueOnce([drv(1)] as never)
    await processBroadcast(data(2))
    expect(emitted()).toEqual(['1'])
  })
})
