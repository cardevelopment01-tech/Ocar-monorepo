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
    expect(fare?.[1]).toEqual([RIDE_ID, 12.5])
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
})
