import { describe, it, expect, vi, beforeEach } from 'vitest'

const repo = vi.hoisted(() => ({
  getRideBasic: vi.fn(),
  getActiveSosForRide: vi.fn(),
  touchSosAlert: vi.fn(),
  insertSosAlert: vi.fn(),
  markRideSosTriggered: vi.fn(),
}))
vi.mock('./safety.repository', () => repo)
vi.mock('@/db/client', () => ({ pool: { query: vi.fn().mockResolvedValue({ rows: [{ phone: '+919876543210' }] }) } }))
vi.mock('@/jobs/queues', () => ({ notificationsQueue: { add: vi.fn().mockResolvedValue(undefined) } }))
vi.mock('@/websocket/socket.server', () => ({ getIO: () => ({ to: () => ({ emit: vi.fn() }) }) }))
vi.mock('@/db/redis', () => ({ client: { incr: vi.fn().mockResolvedValue(1), expire: vi.fn().mockResolvedValue(1) } }))
vi.mock('@/lib/logger', () => ({ logger: { child: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }) } }))

import { triggerSos } from './sos.service'

const ride = (status: string) => ({ id: '10', status, user_id: '7', driver_id: '4' })

beforeEach(() => {
  Object.values(repo).forEach((f) => f.mockReset())
  repo.getActiveSosForRide.mockResolvedValue(null)
  repo.insertSosAlert.mockResolvedValue({ id: '1', severity: 'medium', created_at: new Date().toISOString() })
  repo.markRideSosTriggered.mockResolvedValue(undefined)
})

describe('triggerSos ride status rule', () => {
  // A driver heading to pickup, or a rider waiting for one, can need help before the trip starts.
  it.each(['accepted', 'driver_arrived', 'in_progress', 'returning'])('creates an alert while the ride is %s', async (status) => {
    repo.getRideBasic.mockResolvedValue(ride(status))
    const alert = await triggerSos({ rideId: 10n, triggeredByDriverId: 4n })
    expect(alert.id).toBe('1')
    expect(repo.insertSosAlert).toHaveBeenCalledTimes(1)
  })

  it.each(['searching', 'completed', 'cancelled'])('rejects with RIDE_NOT_ACTIVE while the ride is %s', async (status) => {
    repo.getRideBasic.mockResolvedValue(ride(status))
    await expect(triggerSos({ rideId: 10n, triggeredByDriverId: 4n })).rejects.toMatchObject({ httpStatus: 400, appCode: 'RIDE_NOT_ACTIVE' })
    expect(repo.insertSosAlert).not.toHaveBeenCalled()
  })

  it('rejects a caller who is not on the ride', async () => {
    repo.getRideBasic.mockResolvedValue(ride('accepted'))
    await expect(triggerSos({ rideId: 10n, triggeredByDriverId: 99n })).rejects.toMatchObject({ httpStatus: 403, appCode: 'NOT_RIDE_PARTICIPANT' })
  })

  it('collapses a repeat press into the existing alert instead of creating a second', async () => {
    repo.getRideBasic.mockResolvedValue(ride('accepted'))
    repo.getActiveSosForRide.mockResolvedValue({ id: '5' })
    const alert = await triggerSos({ rideId: 10n, triggeredByUserId: 7n })
    expect(alert).toEqual({ id: '5' })
    expect(repo.touchSosAlert).toHaveBeenCalledTimes(1)
    expect(repo.insertSosAlert).not.toHaveBeenCalled()
  })
})
