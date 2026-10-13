import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db/client', () => ({ pool: { query: vi.fn() }, withTransaction: vi.fn() }))
vi.mock('@/db/redis', () => ({ client: { get: vi.fn(), set: vi.fn(), del: vi.fn() } }))
vi.mock('@/websocket/socket.server', () => ({
  socketEvents: { sendStopUpdated: vi.fn() },
  getIO: vi.fn(),
}))
vi.mock('@/jobs/queues', () => ({ queues: {}, QUEUE_NAMES: {}, gpsFlushQueue: { add: vi.fn() } }))
vi.mock('@/modules/rides/rides.repository', () => ({
  getRideCoreById: vi.fn(), markStopStatus: vi.fn(), getRideStops: vi.fn(), markStopUnreachable: vi.fn(),
}))
vi.mock('@/modules/notifications/notifications.service', () => ({
  notifyOwner: vi.fn().mockResolvedValue(undefined),
  notifyAllAdmins: vi.fn(),
  notifyRideEvent: vi.fn(), notifyRidePaymentFailed: vi.fn(),
}))

import * as repo from '@/modules/rides/rides.repository'
import { socketEvents } from '@/websocket/socket.server'
import { notifyOwner } from '@/modules/notifications/notifications.service'
import { skipRideStop, reportStopUnreachable } from '@/modules/rides/rides.service'

const ride = (over: Record<string, unknown> = {}) =>
  ({ id: 5n, user_id: 42, driver_id: 9, status: 'in_progress', drop_arrived_at: null, ...over })
const skippedStop = { sequence: 1, status: 'skipped', reached_at: null }
const askedStop = { sequence: 1, status: 'pending', reached_at: null, address: 'Gate 2', unreachable_requested_at: '2026-10-10T10:00:00Z' }

describe('skipRideStop (rider owns skipping)', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('skips a pending stop and tells the ride room', async () => {
    vi.mocked(repo.getRideCoreById).mockResolvedValue(ride() as never)
    vi.mocked(repo.markStopStatus).mockResolvedValue(skippedStop as never)
    await expect(skipRideStop(42n, 5n, 1)).resolves.toMatchObject({ success: true })
    expect(repo.markStopStatus).toHaveBeenCalledWith(5n, 1, 'skipped')
    expect(socketEvents.sendStopUpdated).toHaveBeenCalledWith('5', expect.objectContaining({ sequence: 1, status: 'skipped' }))
  })

  it('refuses someone else\'s ride', async () => {
    vi.mocked(repo.getRideCoreById).mockResolvedValue(ride() as never)
    await expect(skipRideStop(7n, 5n, 1)).rejects.toMatchObject({ httpStatus: 403 })
    expect(repo.markStopStatus).not.toHaveBeenCalled()
  })

  it('refuses once the driver has reached the drop', async () => {
    vi.mocked(repo.getRideCoreById).mockResolvedValue(ride({ drop_arrived_at: new Date() }) as never)
    await expect(skipRideStop(42n, 5n, 1)).rejects.toMatchObject({ code: 'DROP_ALREADY_REACHED' })
  })

  it('refuses a ride that is not on the way, but allows the return leg', async () => {
    vi.mocked(repo.getRideCoreById).mockResolvedValue(ride({ status: 'completed' }) as never)
    await expect(skipRideStop(42n, 5n, 1)).rejects.toMatchObject({ httpStatus: 409 })
    vi.mocked(repo.getRideCoreById).mockResolvedValue(ride({ status: 'returning' }) as never)
    vi.mocked(repo.markStopStatus).mockResolvedValue(skippedStop as never)
    await expect(skipRideStop(42n, 5n, 1)).resolves.toMatchObject({ success: true })
  })

  it('409s when the stop is already resolved', async () => {
    vi.mocked(repo.getRideCoreById).mockResolvedValue(ride() as never)
    vi.mocked(repo.markStopStatus).mockResolvedValue(null as never)
    await expect(skipRideStop(42n, 5n, 1)).rejects.toMatchObject({ httpStatus: 409 })
  })
})

describe('reportStopUnreachable (driver asks, rider decides)', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('flags the stop, tells the room, and pushes the rider once', async () => {
    vi.mocked(repo.getRideCoreById).mockResolvedValue(ride() as never)
    vi.mocked(repo.getRideStops).mockResolvedValue([{ sequence: 1, unreachable_requested_at: null }] as never)
    vi.mocked(repo.markStopUnreachable).mockResolvedValue(askedStop as never)
    await expect(reportStopUnreachable(9n, 5n, 1)).resolves.toMatchObject({ success: true })
    expect(repo.markStopStatus).not.toHaveBeenCalled() // the driver never resolves the stop itself
    expect(socketEvents.sendStopUpdated).toHaveBeenCalledWith('5', expect.objectContaining({ status: 'pending', unreachableRequestedAt: askedStop.unreachable_requested_at }))
    expect(notifyOwner).toHaveBeenCalledWith(expect.objectContaining({ ownerType: 'user', ownerId: 42n, type: 'stop_unreachable' }))
  })

  it('does not re-notify on a repeat tap', async () => {
    vi.mocked(repo.getRideCoreById).mockResolvedValue(ride() as never)
    vi.mocked(repo.getRideStops).mockResolvedValue([{ sequence: 1, unreachable_requested_at: '2026-10-10T10:00:00Z' }] as never)
    vi.mocked(repo.markStopUnreachable).mockResolvedValue(askedStop as never)
    await reportStopUnreachable(9n, 5n, 1)
    expect(notifyOwner).not.toHaveBeenCalled()
  })

  it('refuses another driver and an already-resolved stop', async () => {
    vi.mocked(repo.getRideCoreById).mockResolvedValue(ride() as never)
    await expect(reportStopUnreachable(7n, 5n, 1)).rejects.toMatchObject({ httpStatus: 403 })
    vi.mocked(repo.getRideStops).mockResolvedValue([] as never)
    vi.mocked(repo.markStopUnreachable).mockResolvedValue(null as never)
    await expect(reportStopUnreachable(9n, 5n, 1)).rejects.toMatchObject({ httpStatus: 409 })
  })
})
