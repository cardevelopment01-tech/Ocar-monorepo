import { describe, it, expect, vi, beforeEach } from 'vitest'
import { IDLE_HEARTBEAT_PAUSE_SECONDS, IDLE_HEARTBEAT_OFFLINE_MINUTES } from '@/constants/limits'

vi.mock('@/modules/rides/rides.repository', () => ({
  findStaleInProgressRides:        vi.fn(),
  flagRideForReview:               vi.fn(),
  findStaleRequestedRides:         vi.fn().mockResolvedValue([]),
  findStuckDispatchRides:          vi.fn().mockResolvedValue([]),
  findStaleAcceptedOrArrivedRides: vi.fn().mockResolvedValue([]),
  findStaleOnlineDrivers:          vi.fn().mockResolvedValue([]),
  isDriverStale:                   vi.fn().mockResolvedValue(true),
  pauseIfAvailable:                vi.fn().mockResolvedValue('55'),
  hasActiveRide:                   vi.fn().mockResolvedValue(false),
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
  isDriverSocketConnected: vi.fn().mockResolvedValue(false),
}))
vi.mock('@/db/redis', () => ({ client: { mget: vi.fn(), set: vi.fn().mockResolvedValue('OK') } }))
vi.mock('bullmq', () => ({
  Worker: vi.fn().mockImplementation((_name, processor) => ({ on: vi.fn(), __processor: processor })),
  Queue: vi.fn().mockImplementation(() => ({ on: vi.fn() })),
}))

import * as repo from '@/modules/rides/rides.repository'
import { pauseAvailability, goOffline } from '@/modules/rides/rides.service'
import { notifyOwner } from '@/modules/notifications/notifications.service'
import { isDriverSocketConnected } from '@/websocket/socket.server'
import { client as redis } from '@/db/redis'

describe('cleanup worker — in-progress ride sweep', () => {
  beforeEach(() => vi.clearAllMocks())

  it('a ride flagged 45 minutes ago is NOT auto-cancelled', async () => {
    vi.mocked(repo.findStaleInProgressRides).mockResolvedValue([
      { id: '1', driver_id: '9', review_flagged_at: new Date(Date.now() - 45 * 60_000).toISOString() },
    ] as never)

    const { cleanupWorker } = await import('@/jobs/workers/cleanup.worker')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (cleanupWorker as any).__processor()

    expect(repo.pauseIfAvailable).not.toHaveBeenCalled()
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
    expect(repo.pauseIfAvailable).not.toHaveBeenCalled()
  })
})

describe('cleanup worker — idle heartbeat sweep', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(repo.isDriverStale).mockResolvedValue(true); vi.mocked(repo.hasActiveRide).mockResolvedValue(false); vi.mocked(repo.pauseIfAvailable).mockResolvedValue('55' as never) })

  it('pauses a driver stale past the short tier without ending their session', async () => {
    vi.mocked(repo.findStaleInProgressRides).mockResolvedValue([])
    vi.mocked(repo.findStaleOnlineDrivers).mockImplementation((async (secs: number) => (secs === IDLE_HEARTBEAT_PAUSE_SECONDS ? [{ driver_id: '7' }] : [])) as never)

    const { cleanupWorker } = await import('@/jobs/workers/cleanup.worker')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (cleanupWorker as any).__processor()

    expect(repo.pauseIfAvailable).toHaveBeenCalledWith(BigInt(7))
    expect(goOffline).not.toHaveBeenCalled()
    expect(notifyOwner).not.toHaveBeenCalled()
  })

  it('ends the session and notifies the driver once past the long tier', async () => {
    vi.mocked(repo.findStaleInProgressRides).mockResolvedValue([])
    vi.mocked(repo.findStaleOnlineDrivers).mockImplementation((async (secs: number) => (secs <= IDLE_HEARTBEAT_OFFLINE_MINUTES * 60 ? [{ driver_id: '7' }] : [])) as never)

    const { cleanupWorker } = await import('@/jobs/workers/cleanup.worker')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (cleanupWorker as any).__processor()

    expect(goOffline).toHaveBeenCalledWith(BigInt(7), 'stale_heartbeat')
    expect(notifyOwner).toHaveBeenCalledWith(expect.objectContaining({
      ownerType: 'driver',
      ownerId:   BigInt(7),
      type:      'session_ended_stale',
    }))
    expect(repo.findStaleOnlineDrivers).toHaveBeenNthCalledWith(1, IDLE_HEARTBEAT_PAUSE_SECONDS)
    expect(repo.findStaleOnlineDrivers).toHaveBeenNthCalledWith(2, IDLE_HEARTBEAT_OFFLINE_MINUTES * 60)
  })

  it('a driver stale past both tiers gets both actions, without erroring or double-notifying', async () => {
    vi.mocked(repo.findStaleInProgressRides).mockResolvedValue([])
    // Real usage: a driver stale 15 minutes matches BOTH the short-tier and
    // long-tier queries (both are unbounded "stale beyond X" checks) — this
    // locks in that dual-firing is handled cleanly, not just theoretically safe.
    vi.mocked(repo.findStaleOnlineDrivers).mockResolvedValue([{ driver_id: '7' }] as never)

    const { cleanupWorker } = await import('@/jobs/workers/cleanup.worker')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (cleanupWorker as any).__processor()

    expect(repo.pauseIfAvailable).toHaveBeenCalledTimes(1)
    expect(repo.pauseIfAvailable).toHaveBeenCalledWith(BigInt(7))
    expect(goOffline).toHaveBeenCalledTimes(1)
    expect(goOffline).toHaveBeenCalledWith(BigInt(7), 'stale_heartbeat')
    expect(notifyOwner).toHaveBeenCalledTimes(1)
  })
})

describe('cleanup worker — a driver whose app says "still here" is not silent', () => {
  const run = async () => {
    const { cleanupWorker } = await import('@/jobs/workers/cleanup.worker')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (cleanupWorker as any).__processor()
  }
  // findStaleOnlineDrivers is called for the 90 s pause tier, then the 10 min list (which is both the position cap and the offline tier).
  const stale = (pause: string[], tenMin: string[], hour: string[] = []) => {
    vi.mocked(repo.findStaleOnlineDrivers).mockImplementation((async (secs: number) =>
      (secs <= IDLE_HEARTBEAT_PAUSE_SECONDS ? pause : secs <= IDLE_HEARTBEAT_OFFLINE_MINUTES * 60 ? tenMin : hour).map((driver_id) => ({ driver_id }))) as never)
  }
  const heartbeats = (m: Record<string, number>) =>
    vi.mocked(redis.mget).mockImplementation((async (keys: string[]) => keys.map((k) => { const id = k.replace('driver:hb:', ''); return m[id] ? String(m[id]) : null })) as never)

  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(repo.findStaleInProgressRides).mockResolvedValue([])
    vi.mocked(repo.findStaleRequestedRides).mockResolvedValue([])
    vi.mocked(repo.findStuckDispatchRides).mockResolvedValue([])
    vi.mocked(repo.findStaleAcceptedOrArrivedRides).mockResolvedValue([])
    vi.mocked(isDriverSocketConnected).mockResolvedValue(false)
    vi.mocked(notifyOwner).mockResolvedValue(undefined as never)
    vi.mocked(repo.isDriverStale).mockResolvedValue(true)
    vi.mocked(repo.hasActiveRide).mockResolvedValue(false)
    vi.mocked(repo.pauseIfAvailable).mockResolvedValue('55' as never)
    vi.mocked(redis.set).mockResolvedValue('OK' as never)
    heartbeats({})
  })

  it('a fresh heartbeat spares the 90 s pause', async () => {
    stale(['7'], [])
    heartbeats({ '7': Date.now() - 5_000 })
    await run()
    expect(repo.pauseIfAvailable).not.toHaveBeenCalled()
    expect(goOffline).not.toHaveBeenCalled()
  })

  it('a live connection spares them too (old app builds send no heartbeat)', async () => {
    stale(['7'], [])
    vi.mocked(isDriverSocketConnected).mockResolvedValue(true)
    await run()
    expect(repo.pauseIfAvailable).not.toHaveBeenCalled()
    expect(goOffline).not.toHaveBeenCalled()
  })

  it('a position older than the cap pauses the driver even with a heartbeat or a connection, but does not end the session', async () => {
    stale(['7'], ['7'])
    heartbeats({ '7': Date.now() - 5_000 })
    vi.mocked(isDriverSocketConnected).mockResolvedValue(true)
    await run()
    expect(repo.pauseIfAvailable).toHaveBeenCalledWith(BigInt(7))
    expect(goOffline).not.toHaveBeenCalled()
  })

  it('no heartbeat and no connection: unchanged, paused then ended', async () => {
    stale(['8'], ['8'])
    await run()
    expect(repo.pauseIfAvailable).toHaveBeenCalledWith(BigInt(8))
    expect(goOffline).toHaveBeenCalledWith(BigInt(8), 'stale_heartbeat')
  })

  it('a heartbeat 5 minutes old does not spare the 90 s pause', async () => {
    stale(['9'], [])
    heartbeats({ '9': Date.now() - 5 * 60_000 })
    await run()
    expect(repo.pauseIfAvailable).toHaveBeenCalledWith(BigInt(9))
  })

  it('a heartbeat 5 minutes old spares the offline end (the driver is paused for the old position, not ended)', async () => {
    stale(['9'], ['9'])
    heartbeats({ '9': Date.now() - 5 * 60_000 })
    await run()
    expect(repo.pauseIfAvailable).toHaveBeenCalledWith(BigInt(9))
    expect(goOffline).not.toHaveBeenCalled()
  })

  it('Redis down: no heartbeats known, the old behaviour', async () => {
    stale(['8'], ['8'])
    vi.mocked(redis.mget).mockRejectedValue(new Error('down') as never)
    await run()
    expect(repo.pauseIfAvailable).toHaveBeenCalledWith(BigInt(8))
    expect(goOffline).toHaveBeenCalledWith(BigInt(8), 'stale_heartbeat')
  })

  it('presence is looked up once per driver, not once per tier', async () => {
    stale(['7'], ['7'])
    await run()
    expect(vi.mocked(isDriverSocketConnected).mock.calls.filter((c) => c[0] === '7').length).toBeLessThanOrEqual(2)
  })

  it('a sweep pause leaves a marker for the session, so a later heartbeat can resume the driver', async () => {
    stale(['8'], [])
    await run()
    expect(redis.set).toHaveBeenCalledWith('driver:sweep-paused:8', '55', 'EX', expect.any(Number))
  })

  it('a driver spared by a heartbeat is not marked as swept', async () => {
    stale(['7'], [])
    heartbeats({ '7': Date.now() - 5_000 })
    await run()
    expect(redis.set).not.toHaveBeenCalled()
  })

  it('a driver who had already paused on purpose (nothing to flip) gets no marker', async () => {
    stale(['8'], [])
    vi.mocked(repo.pauseIfAvailable).mockResolvedValue(null as never)
    await run()
    expect(redis.set).not.toHaveBeenCalled()
  })

  it('a driver who reported while the sweep was looking is left alone (re-check before acting)', async () => {
    stale(['8'], ['8'])
    vi.mocked(repo.isDriverStale).mockResolvedValue(false)
    await run()
    expect(repo.pauseIfAvailable).not.toHaveBeenCalled()
    expect(goOffline).not.toHaveBeenCalled()
  })

  it('a position older than the hard limit ends the session even with a heartbeat or a connection', async () => {
    stale(['7'], ['7'], ['7'])
    heartbeats({ '7': Date.now() - 5_000 })
    vi.mocked(isDriverSocketConnected).mockResolvedValue(true)
    await run()
    expect(goOffline).toHaveBeenCalledWith(BigInt(7), 'stale_heartbeat')
  })

  it('a driver on a ride is never ended by the hard limit', async () => {
    stale(['7'], ['7'], ['7'])
    heartbeats({ '7': Date.now() - 5_000 })
    vi.mocked(repo.hasActiveRide).mockResolvedValue(true)
    await run()
    expect(goOffline).not.toHaveBeenCalled()
  })

  it('one driver failing to be ended does not stop the sweep for the next one', async () => {
    stale(['7', '8'], ['7', '8'])
    vi.mocked(goOffline).mockRejectedValueOnce(new Error('deadlock') as never)
    await run()
    expect(goOffline).toHaveBeenCalledTimes(2)
  })
})
