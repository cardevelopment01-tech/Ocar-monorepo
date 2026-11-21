import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/modules/rides/rides.repository', () => ({ getRideCoreForDriverAction: vi.fn(), getLatestSessionId: vi.fn() }))
vi.mock('@/db/client', () => ({ pool: { query: vi.fn() }, withTransaction: vi.fn() }))
vi.mock('@/modules/geo/geo.repository', async (orig) => ({ ...(await orig<object>()), insertGpsTracks: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/websocket/socket.server', () => ({ socketEvents: {}, getIO: vi.fn() }))
vi.mock('@/modules/notifications/notifications.service', () => ({
  notifyOwner: vi.fn(), notifyRideEvent: vi.fn(), notifyRidePaymentFailed: vi.fn(), notifyAllAdmins: vi.fn(),
}))

import * as repo from '@/modules/rides/rides.repository'
import { insertGpsTracks } from '@/modules/geo/geo.repository'
import { recordTrailBatch } from '@/modules/rides/rides.service'

const DRIVER = BigInt(9)
const RIDE = BigInt(101)
const STARTED = new Date(Date.now() - 30 * 60_000)
const at = (minAfterStart: number) => new Date(STARTED.getTime() + minAfterStart * 60_000).toISOString()
const fix = (min: number, extra: object = {}) => ({ lat: 20.3, lng: 85.8, recordedAt: at(min), ...extra })

describe('recordTrailBatch (a driver phone uploading the trail it saved offline)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(repo.getRideCoreForDriverAction).mockResolvedValue({ id: RIDE, driver_id: DRIVER, started_at: STARTED.toISOString() } as never)
    vi.mocked(repo.getLatestSessionId).mockResolvedValue(BigInt(5))
  })

  it('stores valid points for the ride, skipping any the live ping already saved', async () => {
    const r = await recordTrailBatch(DRIVER, RIDE, [fix(1), fix(2, { heading: 90, speed: 12, accuracy: 8 })])
    expect(r).toEqual({ accepted: 2 })
    const [rows, , opts] = vi.mocked(insertGpsTracks).mock.calls[0]!
    expect(opts).toEqual({ skipExisting: true })
    expect(rows[0]).toMatchObject({ ride_id: '101', driver_id: '9', session_id: '5', latitude: 20.3, longitude: 85.8 })
    expect(rows[1]).toMatchObject({ heading: 90, speed_kmph: 12, accuracy_metres: 8 })
  })

  it('drops points before the ride started, in the future, or malformed', async () => {
    const r = await recordTrailBatch(DRIVER, RIDE, [
      fix(-10), fix(500), fix(3, { lat: 95 }), { lat: 'x', lng: 1, recordedAt: at(3) }, { lat: 20, lng: 85 }, fix(4),
    ])
    expect(r).toEqual({ accepted: 1 })
  })

  it('refuses an empty or oversized batch and another driver\'s ride', async () => {
    await expect(recordTrailBatch(DRIVER, RIDE, [])).rejects.toMatchObject({ httpStatus: 422 })
    await expect(recordTrailBatch(DRIVER, RIDE, new Array(301).fill(fix(1)))).rejects.toMatchObject({ httpStatus: 422 })
    vi.mocked(repo.getRideCoreForDriverAction).mockResolvedValue(null)
    await expect(recordTrailBatch(DRIVER, RIDE, [fix(1)])).rejects.toMatchObject({ httpStatus: 404 })
    expect(insertGpsTracks).not.toHaveBeenCalled()
  })

  it('stores nothing for a ride that has not started', async () => {
    vi.mocked(repo.getRideCoreForDriverAction).mockResolvedValue({ id: RIDE, driver_id: DRIVER, started_at: null } as never)
    expect(await recordTrailBatch(DRIVER, RIDE, [fix(1)])).toEqual({ accepted: 0 })
    expect(insertGpsTracks).not.toHaveBeenCalled()
  })
})
