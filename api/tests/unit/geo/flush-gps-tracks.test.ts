import { describe, it, expect, vi, beforeEach } from 'vitest'

const poolQuery = vi.fn()
vi.mock('@/db/client', () => ({ pool: { query: (...a: unknown[]) => poolQuery(...a) } }))
vi.mock('@/db/redis', () => ({ getJSON: vi.fn(), setWithTTL: vi.fn(), client: {} }))
const insertGpsTracks = vi.fn().mockResolvedValue(undefined)
vi.mock('@/modules/geo/geo.repository', () => ({ insertGpsTracks: (...a: unknown[]) => insertGpsTracks(...a) }))
vi.mock('@/modules/geo/providers/google.provider', () => ({}))

import { flushGpsTracks } from '@/modules/geo/geo.service'

const row = (over: Record<string, unknown> = {}) => ({
  ride_id: 11, session_id: 22, latitude: 20.3, longitude: 85.8, recorded_at: new Date().toISOString(), ...over,
})

describe('flushGpsTracks - ownership and plausibility', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    poolQuery.mockImplementation(async (sql: string) =>
      sql.includes('FROM rides') ? { rows: [{ id: '11' }] } : { rows: [{ id: '22' }] })
  })

  it('writes rows for the drivers own live ride and session, stamping the driver id from the token', async () => {
    const res = await flushGpsTracks(BigInt(9), [row(), row()])
    expect(res).toEqual({ written: 2, rejected: 0 })
    expect(insertGpsTracks.mock.calls[0]![0][0]).toMatchObject({ driver_id: '9' })
  })

  it('rejects rows for a ride that is not the drivers (cannot plant breadcrumbs on someone elses ride)', async () => {
    const res = await flushGpsTracks(BigInt(9), [row({ ride_id: 999 })])
    expect(res).toEqual({ written: 0, rejected: 1 })
    expect(insertGpsTracks).not.toHaveBeenCalled()
  })

  it('rejects rows for a session that is not the drivers', async () => {
    const res = await flushGpsTracks(BigInt(9), [row({ session_id: 888 })])
    expect(res.written).toBe(0)
  })

  it.each([
    ['bad latitude', { latitude: 99 }],
    ['NaN longitude', { longitude: NaN }],
    ['timestamp far in the past', { recorded_at: '2001-01-01T00:00:00Z' }],
    ['timestamp not a date', { recorded_at: 'yesterday' }],
    ['inaccurate fix', { accuracy_metres: 500 }],
    ['non-numeric ride id', { ride_id: '1; DROP TABLE rides' }],
  ])('drops a row with %s before touching the database', async (_n, patch) => {
    const res = await flushGpsTracks(BigInt(9), [row(patch)])
    expect(res.written).toBe(0)
    expect(poolQuery).not.toHaveBeenCalled()
  })

  it('accepts a late flush: a batch that is a few hours old (offline queue) is kept', async () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString()
    const res = await flushGpsTracks(BigInt(9), [row({ recorded_at: threeHoursAgo })])
    expect(res).toEqual({ written: 1, rejected: 0 })
  })

  it('still rejects anything older than a day, and timestamps from the future', async () => {
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
    const nextHour = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    expect((await flushGpsTracks(BigInt(9), [row({ recorded_at: twoDaysAgo })])).written).toBe(0)
    expect((await flushGpsTracks(BigInt(9), [row({ recorded_at: nextHour })])).written).toBe(0)
  })

  it('the ride lookup also accepts a ride completed in the last few hours (the final flush lands after completion)', async () => {
    await flushGpsTracks(BigInt(9), [row()])
    const rideSql = poolQuery.mock.calls.map(c => c[0] as string).find(s => s.includes('FROM rides'))!
    expect(rideSql).toMatch(/status = 'completed'\s+AND completed_at > now\(\) - interval '3 hours'/)
  })

  it('keeps the good rows when only some are bad', async () => {
    const res = await flushGpsTracks(BigInt(9), [row(), row({ latitude: 500 })])
    expect(res).toEqual({ written: 1, rejected: 1 })
  })
})
