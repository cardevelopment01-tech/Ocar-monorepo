import { describe, it, expect, vi, beforeEach } from 'vitest'

const { client, pool } = vi.hoisted(() => {
  const client = { query: vi.fn(), release: vi.fn() }
  return { client, pool: { connect: vi.fn(() => Promise.resolve(client)), query: vi.fn() } }
})
vi.mock('@/db/client', () => ({ pool }))
vi.mock('@/db/redis', () => ({ client: { incr: vi.fn(async () => 1), expire: vi.fn(), del: vi.fn() } }))

vi.mock('@/modules/rides/rides.repository', () => ({
  getRideCoreById:  vi.fn(),
  getStopWaitTotal: vi.fn(async () => 12.5),
  getPickupWaitCharge: vi.fn(async () => 0),
  getTollForRide: vi.fn(async () => ({ total: 0, detail: [] as Array<{ zone: string; amount: number }>, trailOnly: false })),
  recordToll: vi.fn(async () => undefined),
  flagRideForReview: vi.fn(async () => undefined),
  markStopStatus:   vi.fn(async () => ({ sequence: 1, status: 'reached', reached_at: null })),
}))
vi.mock('@/websocket/socket.server', () => ({
  socketEvents: { sendRideStatusUpdate: vi.fn(), sendStopUpdated: vi.fn() },
  getIO: vi.fn(() => ({ to: vi.fn(() => ({ emit: vi.fn() })) })),
}))
vi.mock('@/modules/call-masking/call-masking.service', () => ({ releaseForRide: vi.fn(async () => undefined) }))

import * as repo from '@/modules/rides/rides.repository'
import { forceResolveRide, markStopStatus } from '@/modules/rides/rides.service'

const RIDE_ID = BigInt(101)
const DRIVER_ID = BigInt(7)
const ride = (status: string, ride_type = 'one_way') =>
  ({ id: RIDE_ID, user_id: BigInt(42), driver_id: DRIVER_ID, status, ride_type }) as never

describe('stuck-ride stop handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    client.query.mockImplementation((sql: string) =>
      Promise.resolve({ rows: [], rowCount: sql.includes('UPDATE rides SET status') ? 1 : 0 }))
    pool.query.mockResolvedValue({ rows: [], rowCount: 0 })
  })

  it('force-complete from "returning" skips pending stops and finalises the fare with stop wait', async () => {
    vi.mocked(repo.getRideCoreById).mockResolvedValue(ride('returning'))
    await forceResolveRide(RIDE_ID, 'completed', 'admin', undefined, BigInt(1))

    const skip = client.query.mock.calls.find((c: unknown[]) => (c[0] as string).includes('UPDATE ride_stops'))
    expect(skip?.[0]).toContain("status = 'skipped'")

    const fare = pool.query.mock.calls.find((c: unknown[]) => (c[0] as string).includes('UPDATE fare_snapshots'))
    expect(fare?.[1]).toEqual([RIDE_ID, 12.5, 0])
  })

  it('force-complete also bills the wait at the pickup that was recorded when the trip started', async () => {
    vi.mocked(repo.getRideCoreById).mockResolvedValue(ride('in_progress'))
    vi.mocked(repo.getPickupWaitCharge).mockResolvedValueOnce(18)
    await forceResolveRide(RIDE_ID, 'completed', 'admin', undefined, BigInt(1))

    const fare = pool.query.mock.calls.find((c: unknown[]) => (c[0] as string).includes('UPDATE fare_snapshots'))
    expect(fare?.[0]).toContain('$3::numeric')
    expect(fare?.[1]).toEqual([RIDE_ID, 12.5, 18])
  })

  it('force-complete bills the pickup wait for a round trip too (stop wait only accrues on one-way)', async () => {
    vi.mocked(repo.getRideCoreById).mockResolvedValue(ride('in_progress', 'round_trip'))
    vi.mocked(repo.getPickupWaitCharge).mockResolvedValueOnce(9)
    await forceResolveRide(RIDE_ID, 'completed', 'admin', undefined, BigInt(1))

    const fare = pool.query.mock.calls.find((c: unknown[]) => (c[0] as string).includes('UPDATE fare_snapshots'))
    expect(fare?.[1]).toEqual([RIDE_ID, 0, 9])
  })

  it('force-cancel leaves stops and fare untouched', async () => {
    vi.mocked(repo.getRideCoreById).mockResolvedValue(ride('in_progress'))
    await forceResolveRide(RIDE_ID, 'cancelled', 'admin')

    expect(client.query.mock.calls.some((c: unknown[]) => (c[0] as string).includes('UPDATE ride_stops'))).toBe(false)
    expect(pool.query.mock.calls.some((c: unknown[]) => (c[0] as string).includes('UPDATE fare_snapshots'))).toBe(false)
  })

  it('lets the driver resolve a stop during the return leg', async () => {
    vi.mocked(repo.getRideCoreById).mockResolvedValue(ride('returning', 'round_trip'))
    await expect(markStopStatus(DRIVER_ID, RIDE_ID, 1, 'reached')).resolves.toMatchObject({ success: true })
  })

  it('force-complete adds an airport toll the trip entered, together with the pickup wait, and records it', async () => {
    vi.mocked(repo.getRideCoreById).mockResolvedValue(ride('in_progress'))
    vi.mocked(repo.getPickupWaitCharge).mockResolvedValueOnce(18)
    vi.mocked(repo.getTollForRide).mockResolvedValueOnce({ total: 40, detail: [{ zone: 'Biju Patnaik Airport', amount: 40 }], trailOnly: false })
    await forceResolveRide(RIDE_ID, 'completed', 'admin', undefined, BigInt(1))

    expect(repo.recordToll).toHaveBeenCalledWith(RIDE_ID, 40, [{ zone: 'Biju Patnaik Airport', amount: 40 }])
    const fare = pool.query.mock.calls.find((c: unknown[]) => (c[0] as string).includes('UPDATE fare_snapshots'))
    expect(fare?.[1]).toEqual([RIDE_ID, 12.5, 58]) // stop wait, then pickup wait 18 + toll 40
  })

  it('a toll earned by the GPS trail alone is charged and flagged for ops; a failing flag never drops it', async () => {
    vi.mocked(repo.getRideCoreById).mockResolvedValue(ride('in_progress'))
    vi.mocked(repo.getTollForRide).mockResolvedValueOnce({ total: 40, detail: [{ zone: 'Biju Patnaik Airport', amount: 40 }], trailOnly: true })
    vi.mocked(repo.flagRideForReview).mockRejectedValueOnce(new Error('db blip'))
    await forceResolveRide(RIDE_ID, 'completed', 'admin', undefined, BigInt(1))
    expect(repo.flagRideForReview).toHaveBeenCalledWith(RIDE_ID, expect.stringContaining('Biju Patnaik Airport'))
    const fare = pool.query.mock.calls.find((c: unknown[]) => (c[0] as string).includes('UPDATE fare_snapshots'))
    expect(fare?.[1]).toEqual([RIDE_ID, 12.5, 40])
  })

  it('a toll lookup that fails charges nothing and never fails the completion', async () => {
    vi.mocked(repo.getRideCoreById).mockResolvedValue(ride('in_progress'))
    vi.mocked(repo.getTollForRide).mockRejectedValueOnce(new Error('db blip'))
    await expect(forceResolveRide(RIDE_ID, 'completed', 'admin', undefined, BigInt(1))).resolves.toBeDefined()
    const fare = pool.query.mock.calls.find((c: unknown[]) => (c[0] as string).includes('UPDATE fare_snapshots'))
    expect(fare?.[1]).toEqual([RIDE_ID, 12.5, 0])
    expect(repo.recordToll).not.toHaveBeenCalled()
  })

  it('a ride with no toll records nothing', async () => {
    vi.mocked(repo.getRideCoreById).mockResolvedValue(ride('in_progress'))
    await forceResolveRide(RIDE_ID, 'completed', 'admin', undefined, BigInt(1))
    expect(repo.recordToll).not.toHaveBeenCalled()
  })
})
