import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/db/client', () => ({ pool: { query: vi.fn() } }))
vi.mock('@/db/redis', () => ({ client: { get: vi.fn(), set: vi.fn(), del: vi.fn() } }))
vi.mock('@/websocket/socket.server', () => ({
  socketEvents: {
    sendAdminDriverUpdate: vi.fn(), sendDriverLocation: vi.fn(), sendTrailSegment: vi.fn(),
    sendRideStatusUpdate: vi.fn(),
  },
  getIO: vi.fn(() => ({ to: vi.fn(() => ({ emit: vi.fn() })) })),
}))
vi.mock('@/jobs/queues', () => ({
  queues: { notifications: { add: vi.fn() }, dispatch: { add: vi.fn() }, scheduler: { add: vi.fn() } },
  QUEUE_NAMES: { NOTIFICATIONS: 'notifications', DISPATCH: 'dispatch', SCHEDULER: 'scheduler' },
}))
vi.mock('@/lib/gps-buffer', () => ({ enqueueBreadcrumb: vi.fn() }))
vi.mock('@/modules/rides/rides.repository', () => ({ upsertDriverLocation: vi.fn() }))
vi.mock('@/modules/geo/geo.service', () => ({
  snapTrailToRoads: vi.fn(async (pts: unknown[]) => pts),
  getRoute: vi.fn(), findNearestCity: vi.fn(), classifyTrip: vi.fn(),
}))
vi.mock('@/modules/payments/payments.service', () => ({
  createPaymentRecord: vi.fn(), deductCommission: vi.fn(), creditCashback: vi.fn(),
}))
vi.mock('@/lib/system-config', () => ({ getConfigValue: vi.fn().mockResolvedValue('1') }))

import { pool } from '@/db/client'
import { client as redis } from '@/db/redis'
import * as repo from '@/modules/rides/rides.repository'
import { socketEvents } from '@/websocket/socket.server'
import { snapTrailToRoads } from '@/modules/geo/geo.service'
import { enqueueBreadcrumb } from '@/lib/gps-buffer'
import { updateLocation } from '@/modules/rides/rides.service'

const DRIVER = BigInt(9)
const ping = (over: Record<string, unknown> = {}) => ({
  sessionId: BigInt(5), lat: 20.3, lng: 85.8, recordedAt: new Date().toISOString(), ...over,
})

describe('updateLocation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.mocked(repo.upsertDriverLocation).mockResolvedValue({ owned: true, ended: false })
    vi.mocked(redis.get).mockResolvedValue('777') // driver is on ride 777
  })
  afterEach(() => vi.useRealTimers())

  it('rejects a session id that is not the drivers own (403) and does nothing else', async () => {
    vi.mocked(repo.upsertDriverLocation).mockResolvedValue({ owned: false, ended: false })
    await expect(updateLocation(DRIVER, ping())).rejects.toMatchObject({ httpStatus: 403, appCode: 'SESSION_MISMATCH' })
    expect(enqueueBreadcrumb).not.toHaveBeenCalled()
    expect(socketEvents.sendDriverLocation).not.toHaveBeenCalled()
  })

  it.each([
    ['NaN latitude', { lat: NaN }],
    ['latitude out of range', { lat: 123 }],
    ['longitude out of range', { lng: -400 }],
  ])('rejects %s with 422', async (_n, patch) => {
    await expect(updateLocation(DRIVER, ping(patch))).rejects.toMatchObject({ httpStatus: 422 })
    expect(repo.upsertDriverLocation).not.toHaveBeenCalled()
  })

  it('replaces an absurd device clock with server time (it is the partition key)', async () => {
    await updateLocation(DRIVER, ping({ recordedAt: '1970-01-01T00:00:00Z' }))
    const used = vi.mocked(repo.upsertDriverLocation).mock.calls[0]![0].recordedAt
    expect(Math.abs(Date.parse(used) - Date.now())).toBeLessThan(5_000)
    const crumb = vi.mocked(enqueueBreadcrumb).mock.calls[0]![0]
    expect(Math.abs(Date.parse(crumb.recorded_at) - Date.now())).toBeLessThan(5_000)
  })

  it('an unparseable device timestamp is replaced by server time', async () => {
    await updateLocation(DRIVER, ping({ recordedAt: 'not-a-date' }))
    const used = vi.mocked(repo.upsertDriverLocation).mock.calls[0]![0].recordedAt
    expect(Math.abs(Date.parse(used) - Date.now())).toBeLessThan(5_000)
  })

  it('buffers breadcrumbs instead of queueing a job per ping', async () => {
    await updateLocation(DRIVER, ping())
    expect(enqueueBreadcrumb).toHaveBeenCalledTimes(1)
    expect(vi.mocked(enqueueBreadcrumb).mock.calls[0]![0]).toMatchObject({ ride_id: '777', driver_id: '9', session_id: '5' })
  })

  it('road-snaps in ONE batched request per interval, not once per ping', async () => {
    const t0 = Date.now()
    for (let i = 0; i < 6; i++) {            // six pings, 3 s apart: ~15 s, below the 20 s snap interval
      vi.setSystemTime(t0 + i * 3_000)
      await updateLocation(DRIVER, ping({ lat: 20.3 + i * 0.001, recordedAt: new Date(t0 + i * 3_000).toISOString() }))
    }
    expect(snapTrailToRoads).not.toHaveBeenCalled()

    vi.setSystemTime(t0 + 21_000)            // past the interval -> exactly one batched snap
    await updateLocation(DRIVER, ping({ lat: 20.31, recordedAt: new Date(t0 + 21_000).toISOString() }))
    expect(snapTrailToRoads).toHaveBeenCalledTimes(1)
    expect(vi.mocked(snapTrailToRoads).mock.calls[0]![0].length).toBeGreaterThanOrEqual(6)

    await vi.waitFor(() => expect(socketEvents.sendTrailSegment).toHaveBeenCalledTimes(1))
  })

  it('the live marker is emitted from the raw fix on every ping (never waits on the paid API)', async () => {
    await updateLocation(DRIVER, ping({ lat: 20.5 }))
    expect(socketEvents.sendDriverLocation).toHaveBeenCalledWith('777', expect.objectContaining({ lat: 20.5 }))
  })

  it('throttles the admin live-map broadcast per driver', async () => {
    const t0 = Date.now()
    for (let i = 0; i < 4; i++) {            // 4 pings within 9 s
      vi.setSystemTime(t0 + i * 3_000)
      await updateLocation(BigInt(31), ping({ recordedAt: new Date(t0 + i * 3_000).toISOString() }))
    }
    expect(vi.mocked(socketEvents.sendAdminDriverUpdate).mock.calls.length).toBeLessThanOrEqual(2)
    expect(pool.query).not.toHaveBeenCalled() // ride came from the cache
  })
})
