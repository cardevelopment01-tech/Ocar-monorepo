import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Value: protects=an ONLINE driver with NO ride is published (moving, anonymised) to the cell they are in, and nobody else is:
// not a driver on a ride, not a paused or unknown session; fails_when=a driver's real id or a busy/paused driver reaches the
// rider-facing feed, or one phone pinging over two paths is published twice; why_new=live nearby-cars push; seam=mocked
// repository + bus; no_claim=socket or Redis delivery (nearby-bus.test.ts).
vi.mock('@/db/client', () => ({ pool: { query: vi.fn() } }))
vi.mock('@/db/redis', () => ({ client: { get: vi.fn(), set: vi.fn(), del: vi.fn() } }))
vi.mock('@/websocket/socket.server', () => ({
  socketEvents: { sendAdminDriverUpdate: vi.fn(), sendDriverLocation: vi.fn(), sendTrailSegment: vi.fn(), sendRideStatusUpdate: vi.fn() },
  getIO: vi.fn(() => ({ to: vi.fn(() => ({ emit: vi.fn() })) })),
}))
vi.mock('@/websocket/nearby-bus', () => ({ publishNearbyCar: vi.fn(() => true) }))
vi.mock('@/jobs/queues', () => ({
  queues: { notifications: { add: vi.fn() }, dispatch: { add: vi.fn() }, scheduler: { add: vi.fn() } },
  QUEUE_NAMES: { NOTIFICATIONS: 'notifications', DISPATCH: 'dispatch', SCHEDULER: 'scheduler' },
}))
vi.mock('@/lib/gps-buffer', () => ({ enqueueBreadcrumb: vi.fn() }))
vi.mock('@/modules/rides/rides.repository', () => ({ upsertDriverLocation: vi.fn() }))
vi.mock('@/modules/geo/geo.service', () => ({
  snapTrailToRoads: vi.fn(async (pts: unknown[]) => pts), getRoute: vi.fn(), findNearestCity: vi.fn(), classifyTrip: vi.fn(),
}))
vi.mock('@/modules/payments/payments.service', () => ({ createPaymentRecord: vi.fn(), deductCommission: vi.fn(), creditCashback: vi.fn() }))
vi.mock('@/lib/system-config', () => ({ getConfigValue: vi.fn().mockResolvedValue('1') }))

import { pool } from '@/db/client'
import { client as redis } from '@/db/redis'
import * as repo from '@/modules/rides/rides.repository'
import { publishNearbyCar } from '@/websocket/nearby-bus'
import { updateLocation } from '@/modules/rides/rides.service'

const ping = (over: Record<string, unknown> = {}) => ({
  sessionId: BigInt(5), lat: 20.3, lng: 85.8, recordedAt: new Date().toISOString(), ...over,
})
const online = { owned: true, ended: false, categoryId: 2, sessionStatus: 'online' }

describe('updateLocation: live nearby cars', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.mocked(repo.upsertDriverLocation).mockResolvedValue(online)
    vi.mocked(redis.get).mockResolvedValue('') // no active ride cached
    vi.mocked(pool.query).mockResolvedValue({ rows: [] } as never)
    vi.mocked(publishNearbyCar).mockReturnValue(true)
  })
  afterEach(() => vi.useRealTimers())

  it('publishes an online driver with no ride: an opaque id, a rounded position, the heading and the vehicle category', async () => {
    await updateLocation(1001n, ping({ lat: 20.29612345678, lng: 85.82456789, heading: 91.6 }))
    expect(publishNearbyCar).toHaveBeenCalledTimes(1)
    const sent = vi.mocked(publishNearbyCar).mock.calls[0]![0]
    expect(sent).toEqual({ id: expect.stringMatching(/^[0-9a-f]{12}$/), lat: 20.296123, lng: 85.824568, heading: 92, categoryId: 2 })
    expect(JSON.stringify(sent)).not.toContain('1001') // never the real driver id
  })

  it('leaves the heading out when the phone did not report one', async () => {
    await updateLocation(1002n, ping())
    expect(vi.mocked(publishNearbyCar).mock.calls[0]![0]).not.toHaveProperty('heading')
  })

  it('does not publish a driver who is on a ride (they are not an available car)', async () => {
    vi.mocked(redis.get).mockResolvedValue('777')
    await updateLocation(1003n, ping())
    expect(publishNearbyCar).not.toHaveBeenCalled()
  })

  it.each([
    ['a paused session', { ...online, sessionStatus: 'paused' }],
    ['a session on a trip', { ...online, sessionStatus: 'on_trip' }],
    ['an unknown session state', { owned: true, ended: false, categoryId: 2, sessionStatus: null }],
    ['an unknown category', { ...online, categoryId: null }],
  ])('does not publish %s', async (_n, upserted) => {
    vi.mocked(repo.upsertDriverLocation).mockResolvedValue(upserted as never)
    await updateLocation(1004n, ping())
    expect(publishNearbyCar).not.toHaveBeenCalled()
  })

  it('publishes a driver at most once per 1.5 s (one phone pinging over the socket and the HTTP fallback)', async () => {
    const t0 = Date.now()
    await updateLocation(1005n, ping())
    vi.setSystemTime(t0 + 800)
    await updateLocation(1005n, ping({ lat: 20.3001 }))
    expect(publishNearbyCar).toHaveBeenCalledTimes(1)
    vi.setSystemTime(t0 + 1600)
    await updateLocation(1005n, ping({ lat: 20.3002 }))
    expect(publishNearbyCar).toHaveBeenCalledTimes(2)
  })

  it('does not use up a driver\'s throttle slot when the publish was skipped (Redis not ready): the next ping goes out at once', async () => {
    vi.mocked(publishNearbyCar).mockReturnValueOnce(false)
    await updateLocation(1008n, ping())
    await updateLocation(1008n, ping({ lat: 20.3001 }))
    expect(publishNearbyCar).toHaveBeenCalledTimes(2)
  })

  it('throttles each driver separately', async () => {
    await updateLocation(1006n, ping())
    await updateLocation(1007n, ping())
    expect(publishNearbyCar).toHaveBeenCalledTimes(2)
    const ids = vi.mocked(publishNearbyCar).mock.calls.map((c) => c[0].id)
    expect(new Set(ids).size).toBe(2) // different drivers, different opaque ids
  })
})
