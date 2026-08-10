import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/modules/rides/rides.repository', () => ({
  findStaleInProgressRides:        vi.fn(),
  flagRideForReview:               vi.fn(),
  findStaleRequestedRides:         vi.fn().mockResolvedValue([]),
  findStaleAcceptedOrArrivedRides: vi.fn().mockResolvedValue([]),
  findStaleOnlineDrivers:          vi.fn().mockResolvedValue([]),
}))
vi.mock('@/modules/rides/rides.service', () => ({
  expireStaleRequestedRide:       vi.fn(),
  expireStaleAcceptedOrArrivedRide: vi.fn(),
  pauseAvailability:              vi.fn(),
  goOffline:                      vi.fn(),
}))
vi.mock('@/modules/notifications/notifications.service', () => ({
  notifyOwner: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/websocket/socket.server', () => ({
  socketEvents: { sendStuckRideFlagged: vi.fn() },
}))
vi.mock('bullmq', () => ({
  Worker: vi.fn().mockImplementation((_name, processor) => ({ on: vi.fn(), __processor: processor })),
  Queue: vi.fn().mockImplementation(() => ({ on: vi.fn() })),
}))

import * as repo from '@/modules/rides/rides.repository'
import { pauseAvailability, goOffline } from '@/modules/rides/rides.service'
import { notifyOwner } from '@/modules/notifications/notifications.service'

describe('cleanup worker — in-progress ride sweep', () => {
  beforeEach(() => vi.clearAllMocks())

  it('a ride flagged 45 minutes ago is NOT auto-cancelled', async () => {
    vi.mocked(repo.findStaleInProgressRides).mockResolvedValue([
      { id: '1', driver_id: '9', review_flagged_at: new Date(Date.now() - 45 * 60_000).toISOString() },
    ] as never)

    const { cleanupWorker } = await import('@/jobs/workers/cleanup.worker')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (cleanupWorker as any).__processor()

    expect(pauseAvailability).not.toHaveBeenCalled()
    // Already flagged — flagRideForReview must not be called a second time
    expect(repo.flagRideForReview).not.toHaveBeenCalled()
  })

  it('an unflagged stale ride gets flagged exactly once', async () => {
    vi.mocked(repo.findStaleInProgressRides).mockResolvedValue([
      { id: '2', driver_id: '9', review_flagged_at: null },
    ] as never)

    const { cleanupWorker } = await import('@/jobs/workers/cleanup.worker')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (cleanupWorker as any).__processor()

    expect(repo.flagRideForReview).toHaveBeenCalledWith(BigInt(2), 'gps_stale')
    expect(pauseAvailability).not.toHaveBeenCalled()
  })
})

describe('cleanup worker — idle heartbeat sweep', () => {
  beforeEach(() => vi.clearAllMocks())

  it('pauses a driver stale past the short tier without ending their session', async () => {
    vi.mocked(repo.findStaleInProgressRides).mockResolvedValue([])
    vi.mocked(repo.findStaleOnlineDrivers)
      .mockResolvedValueOnce([{ driver_id: '7' }] as never)  // short-tier call
      .mockResolvedValueOnce([] as never)                     // long-tier call

    const { cleanupWorker } = await import('@/jobs/workers/cleanup.worker')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (cleanupWorker as any).__processor()

    expect(pauseAvailability).toHaveBeenCalledWith(BigInt(7))
    expect(goOffline).not.toHaveBeenCalled()
    expect(notifyOwner).not.toHaveBeenCalled()
  })

  it('ends the session and notifies the driver once past the long tier', async () => {
    vi.mocked(repo.findStaleInProgressRides).mockResolvedValue([])
    vi.mocked(repo.findStaleOnlineDrivers)
      .mockResolvedValueOnce([{ driver_id: '7' }] as never)
      .mockResolvedValueOnce([{ driver_id: '7' }] as never)

    const { cleanupWorker } = await import('@/jobs/workers/cleanup.worker')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (cleanupWorker as any).__processor()

    expect(goOffline).toHaveBeenCalledWith(BigInt(7), 'stale_heartbeat')
    expect(notifyOwner).toHaveBeenCalledWith(expect.objectContaining({
      ownerType: 'driver',
      ownerId:   BigInt(7),
      type:      'session_ended_stale',
    }))
  })
})
