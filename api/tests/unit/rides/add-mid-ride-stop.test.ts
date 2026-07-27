import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/modules/rides/rides.repository', () => ({
  getRideById:     vi.fn(),
  appendRideStop:  vi.fn(),
}))

vi.mock('@/modules/pricing/pricing.repository', () => ({
  getStopCharge: vi.fn().mockResolvedValue(30),
}))

vi.mock('@/websocket/socket.server', () => ({
  socketEvents: { sendStopAdded: vi.fn() },
  getIO: vi.fn(() => ({ to: vi.fn(() => ({ emit: vi.fn() })) })),
}))

import * as repo from '@/modules/rides/rides.repository'
import { socketEvents } from '@/websocket/socket.server'
import { addRideStop } from '@/modules/rides/rides.service'

const USER_ID = BigInt(7)
const RIDE_ID = BigInt(101)
const STOP = { lat: 20.30, lng: 85.83, address: 'Patia' }

describe('addRideStop', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(repo.appendRideStop).mockResolvedValue({
      id: BigInt(9), ride_id: RIDE_ID, sequence: 2, lat: 20.30, lng: 85.83,
      address: 'Patia', status: 'pending', arrived_at: null, reached_at: null,
      stop_charge_applied: '0', wait_charge: '0',
    } as never)
  })

  it('rejects when the ride does not belong to the caller', async () => {
    vi.mocked(repo.getRideById).mockResolvedValue({
      id: RIDE_ID, user_id: BigInt(999), status: 'in_progress', ride_type: 'one_way', category_id: BigInt(1),
    } as never)

    await expect(addRideStop(USER_ID, RIDE_ID, STOP)).rejects.toThrow(/Forbidden/)
    expect(repo.appendRideStop).not.toHaveBeenCalled()
  })

  it('rejects once the ride has completed', async () => {
    vi.mocked(repo.getRideById).mockResolvedValue({
      id: RIDE_ID, user_id: USER_ID, status: 'completed', ride_type: 'one_way', category_id: BigInt(1),
    } as never)

    await expect(addRideStop(USER_ID, RIDE_ID, STOP)).rejects.toThrow(/on the way/)
    expect(repo.appendRideStop).not.toHaveBeenCalled()
  })

  it('adds a stop with no charge for a one_way ride in progress', async () => {
    vi.mocked(repo.getRideById).mockResolvedValue({
      id: RIDE_ID, user_id: USER_ID, status: 'in_progress', ride_type: 'one_way', category_id: BigInt(1),
    } as never)

    await addRideStop(USER_ID, RIDE_ID, STOP)

    expect(repo.appendRideStop).toHaveBeenCalledWith(RIDE_ID, { ...STOP, chargeApplied: 0 })
    expect(socketEvents.sendStopAdded).toHaveBeenCalledWith(RIDE_ID.toString(), expect.any(Object))
  })

  it('applies the flat stop charge for a round_trip ride', async () => {
    vi.mocked(repo.getRideById).mockResolvedValue({
      id: RIDE_ID, user_id: USER_ID, status: 'accepted', ride_type: 'round_trip', category_id: BigInt(3),
    } as never)

    await addRideStop(USER_ID, RIDE_ID, STOP)

    expect(repo.appendRideStop).toHaveBeenCalledWith(RIDE_ID, { ...STOP, chargeApplied: 30 })
  })

  it('retries once on a unique-violation race and succeeds on the second attempt', async () => {
    vi.mocked(repo.getRideById).mockResolvedValue({
      id: RIDE_ID, user_id: USER_ID, status: 'in_progress', ride_type: 'one_way', category_id: BigInt(1),
    } as never)
    const conflictErr = Object.assign(new Error('duplicate key'), { code: '23505' })
    vi.mocked(repo.appendRideStop)
      .mockRejectedValueOnce(conflictErr)
      .mockResolvedValueOnce({
        id: BigInt(10), ride_id: RIDE_ID, sequence: 3, lat: 20.30, lng: 85.83,
        address: 'Patia', status: 'pending', arrived_at: null, reached_at: null,
        stop_charge_applied: '0', wait_charge: '0',
      } as never)

    const result = await addRideStop(USER_ID, RIDE_ID, STOP)

    expect(repo.appendRideStop).toHaveBeenCalledTimes(2)
    expect(result.sequence).toBe(3)
  })

  it('gives up and rethrows after exhausting retries on repeated unique-violations', async () => {
    vi.mocked(repo.getRideById).mockResolvedValue({
      id: RIDE_ID, user_id: USER_ID, status: 'in_progress', ride_type: 'one_way', category_id: BigInt(1),
    } as never)
    const conflictErr = Object.assign(new Error('duplicate key'), { code: '23505' })
    vi.mocked(repo.appendRideStop).mockRejectedValue(conflictErr)

    await expect(addRideStop(USER_ID, RIDE_ID, STOP)).rejects.toThrow(/duplicate key/)
    expect(repo.appendRideStop).toHaveBeenCalledTimes(3)
  })
})
