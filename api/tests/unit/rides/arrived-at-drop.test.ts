import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db/client', () => ({ pool: { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }) }, withTransaction: vi.fn() }))
vi.mock('@/db/redis', () => ({ client: { get: vi.fn(), set: vi.fn(), del: vi.fn() } }))
vi.mock('@/websocket/socket.server', () => ({
  socketEvents: { sendRideStatusUpdate: vi.fn(), sendUserUpdate: vi.fn() },
  getIO: vi.fn(),
}))
vi.mock('@/jobs/queues', () => ({ queues: {}, QUEUE_NAMES: {}, gpsFlushQueue: { add: vi.fn() } }))
vi.mock('@/modules/rides/rides.repository', () => ({ getRideCoreById: vi.fn() }))

import * as repo from '@/modules/rides/rides.repository'
import { client as redis } from '@/db/redis'
import { socketEvents } from '@/websocket/socket.server'
import { markArrivedAtDrop } from '@/modules/rides/rides.service'

const ride = (over: Record<string, unknown>) => ({ id: 5n, user_id: 42, driver_id: 9, status: 'in_progress', ride_type: 'one_way', ...over })

describe('markArrivedAtDrop', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('reveals the end PIN to the rider only, never on the shared ride room', async () => {
    vi.mocked(repo.getRideCoreById).mockResolvedValue(ride({}) as never)
    vi.mocked(redis.get).mockResolvedValue('4821' as never)
    await markArrivedAtDrop(9n, 5n)
    expect(socketEvents.sendUserUpdate).toHaveBeenCalledWith('42', expect.objectContaining({ endOtp: '4821', dropArrived: true }))
    const shared = vi.mocked(socketEvents.sendRideStatusUpdate).mock.calls[0]![1] as Record<string, unknown>
    expect(shared).not.toHaveProperty('endOtp')
  })

  it('a round trip reaches its drop only on the return leg', async () => {
    vi.mocked(repo.getRideCoreById).mockResolvedValue(ride({ ride_type: 'round_trip', status: 'in_progress' }) as never)
    await expect(markArrivedAtDrop(9n, 5n)).rejects.toMatchObject({ httpStatus: 409 })
    vi.mocked(repo.getRideCoreById).mockResolvedValue(ride({ ride_type: 'round_trip', status: 'returning' }) as never)
    await expect(markArrivedAtDrop(9n, 5n)).resolves.toEqual({ success: true })
  })

  it('refuses another driver', async () => {
    vi.mocked(repo.getRideCoreById).mockResolvedValue(ride({}) as never)
    await expect(markArrivedAtDrop(7n, 5n)).rejects.toMatchObject({ httpStatus: 403 })
  })
})
