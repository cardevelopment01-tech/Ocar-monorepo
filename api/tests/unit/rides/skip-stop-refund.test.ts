import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/modules/rides/rides.repository', () => ({
  getRideCoreById: vi.fn(),
  getRideStops: vi.fn().mockResolvedValue([]),
  markStopStatus: vi.fn(),
}))
vi.mock('@/db/client', () => ({ pool: { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }) }, withTransaction: vi.fn() }))
vi.mock('@/websocket/socket.server', () => ({
  socketEvents: { sendStopUpdated: vi.fn() },
  getIO: vi.fn(() => ({ to: vi.fn(() => ({ emit: vi.fn() })) })),
}))
vi.mock('@/modules/notifications/notifications.service', () => ({
  notifyOwner: vi.fn(), notifyRideEvent: vi.fn(), notifyRidePaymentFailed: vi.fn(), notifyAllAdmins: vi.fn(),
}))
vi.mock('@/modules/offers/settlement', async (orig) => ({ ...(await orig<object>()), finaliseDiscount: vi.fn() }))

import * as repo from '@/modules/rides/rides.repository'
import { pool } from '@/db/client'
import { skipRideStop } from '@/modules/rides/rides.service'

const USER = BigInt(7)
const RIDE = BigInt(101)
const ride = (type: string) => ({ id: RIDE, user_id: USER, status: 'in_progress', ride_type: type, drop_arrived_at: null }) as never
const stop = (charge: string) => ({ sequence: 1, status: 'skipped', reached_at: null, stop_charge_applied: charge }) as never

describe('skipRideStop refund', () => {
  beforeEach(() => vi.clearAllMocks())

  it.each([['one_way', true], ['round_trip', false], ['rental', false]])('takes the stop charge back off a %s fare', async (type, one) => {
    vi.mocked(repo.getRideCoreById).mockResolvedValue(ride(type))
    vi.mocked(repo.markStopStatus).mockResolvedValue(stop('30.00'))
    await skipRideStop(USER, RIDE, 1)
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('stop_fare - $2'), [RIDE, 30, one])
  })

  it('leaves the fare alone when the stop was free', async () => {
    vi.mocked(repo.getRideCoreById).mockResolvedValue(ride('one_way'))
    vi.mocked(repo.markStopStatus).mockResolvedValue(stop('0.00'))
    await skipRideStop(USER, RIDE, 1)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('refunds nothing for a stop that was already resolved', async () => {
    vi.mocked(repo.getRideCoreById).mockResolvedValue(ride('one_way'))
    vi.mocked(repo.markStopStatus).mockResolvedValue(null)
    await expect(skipRideStop(USER, RIDE, 1)).rejects.toThrow(/already resolved/)
    expect(pool.query).not.toHaveBeenCalled()
  })
})
