import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db/client', () => ({ pool: { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }) }, withTransaction: vi.fn() }))
vi.mock('@/db/redis', () => ({ client: { get: vi.fn(), set: vi.fn(), del: vi.fn() } }))
vi.mock('@/websocket/socket.server', () => ({
  socketEvents: { sendRideStatusUpdate: vi.fn(), sendUserUpdate: vi.fn() },
  getIO: vi.fn(),
}))
vi.mock('@/jobs/queues', () => ({ queues: {}, QUEUE_NAMES: {}, gpsFlushQueue: { add: vi.fn() } }))
vi.mock('@/modules/rides/rides.repository', () => ({ getRideCoreById: vi.fn(), getRideStops: vi.fn().mockResolvedValue([]) }))

import * as repo from '@/modules/rides/rides.repository'
import { client as redis } from '@/db/redis'
import { pool } from '@/db/client'
import { socketEvents } from '@/websocket/socket.server'
import { markArrivedAtDrop, getEndOtp } from '@/modules/rides/rides.service'
import { hashOtp, deriveRideEndOtp } from '@/lib/otp'

const ride = (over: Record<string, unknown>) => ({ id: 5n, user_id: 42, driver_id: 9, status: 'in_progress', ride_type: 'one_way', ...over })

describe('markArrivedAtDrop', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('reveals the derived end PIN to the rider only, never on the shared ride room', async () => {
    vi.mocked(repo.getRideCoreById).mockResolvedValue(ride({}) as never)
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ end_otp_hash: hashOtp(deriveRideEndOtp(5n)) }] } as never)
    await markArrivedAtDrop(9n, 5n)
    expect(socketEvents.sendUserUpdate).toHaveBeenCalledWith('42', expect.objectContaining({ endOtp: deriveRideEndOtp(5n), dropArrived: true }))
    const shared = vi.mocked(socketEvents.sendRideStatusUpdate).mock.calls[0]![1] as Record<string, unknown>
    expect(shared).not.toHaveProperty('endOtp')
  })

  it('keeps a legacy random PIN while Redis still has it', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ end_otp_hash: hashOtp('1234') }] } as never)
    vi.mocked(redis.get).mockResolvedValue('1234' as never)
    expect(await getEndOtp(5n)).toBe('1234')
  })

  it('resets a legacy ride whose Redis key is gone to the derived PIN', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ end_otp_hash: hashOtp('1234') }] } as never)
    vi.mocked(redis.get).mockResolvedValue(null as never)
    expect(await getEndOtp(5n)).toBe(deriveRideEndOtp(5n))
    expect(pool.query).toHaveBeenLastCalledWith(expect.stringContaining('UPDATE rides SET end_otp_hash'), [5n, hashOtp(deriveRideEndOtp(5n))])
  })

  it('a round trip reaches its drop only on the return leg', async () => {
    vi.mocked(repo.getRideCoreById).mockResolvedValue(ride({ ride_type: 'round_trip', status: 'in_progress' }) as never)
    await expect(markArrivedAtDrop(9n, 5n)).rejects.toMatchObject({ httpStatus: 409 })
    vi.mocked(repo.getRideCoreById).mockResolvedValue(ride({ ride_type: 'round_trip', status: 'returning' }) as never)
    await expect(markArrivedAtDrop(9n, 5n)).resolves.toEqual({ success: true })
  })

  it('refuses while a stop is still pending', async () => {
    vi.mocked(repo.getRideCoreById).mockResolvedValue(ride({}) as never)
    vi.mocked(repo.getRideStops).mockResolvedValueOnce([{ status: 'pending' }] as never)
    await expect(markArrivedAtDrop(9n, 5n)).rejects.toMatchObject({ code: 'RIDE_HAS_PENDING_STOPS' })
  })

  it('refuses another driver', async () => {
    vi.mocked(repo.getRideCoreById).mockResolvedValue(ride({}) as never)
    await expect(markArrivedAtDrop(7n, 5n)).rejects.toMatchObject({ httpStatus: 403 })
  })
})
