import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/modules/rides/rides.repository', () => ({
  findStaleInProgressRides:        vi.fn(),
  flagRideForReview:               vi.fn(),
  findStaleRequestedRides:         vi.fn().mockResolvedValue([]),
  findStaleAcceptedOrArrivedRides: vi.fn().mockResolvedValue([]),
}))
vi.mock('@/modules/rides/rides.service', () => ({
  forceResolveRide:               vi.fn(),
  expireStaleRequestedRide:       vi.fn(),
  expireStaleAcceptedOrArrivedRide: vi.fn(),
}))
vi.mock('@/websocket/socket.server', () => ({
  socketEvents: { sendStuckRideFlagged: vi.fn() },
}))
vi.mock('bullmq', () => ({
  Worker: vi.fn().mockImplementation((_name, processor) => ({ on: vi.fn(), __processor: processor })),
  Queue: vi.fn().mockImplementation(() => ({ on: vi.fn() })),
}))

import * as repo from '@/modules/rides/rides.repository'
import { forceResolveRide } from '@/modules/rides/rides.service'

describe('cleanup worker — in-progress ride sweep', () => {
  beforeEach(() => vi.clearAllMocks())

  it('a ride flagged 45 minutes ago is NOT auto-cancelled', async () => {
    vi.mocked(repo.findStaleInProgressRides).mockResolvedValue([
      { id: '1', driver_id: '9', review_flagged_at: new Date(Date.now() - 45 * 60_000).toISOString() },
    ] as never)

    const { cleanupWorker } = await import('@/jobs/workers/cleanup.worker')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (cleanupWorker as any).__processor()

    expect(forceResolveRide).not.toHaveBeenCalled()
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
    expect(forceResolveRide).not.toHaveBeenCalled()
  })
})
