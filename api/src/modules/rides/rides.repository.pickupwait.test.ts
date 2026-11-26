import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockQuery = vi.fn()
vi.mock('@/db/client', () => ({ pool: { query: (...args: unknown[]) => mockQuery(...args) } }))

import { getPickupWaitMinutes, getPickupWaitStartedAt } from './rides.repository'

const ARRIVED = new Date('2026-11-26T12:40:00.000Z')
const BOOKED = new Date('2026-11-26T12:55:00.000Z')

describe.each([
  ['getPickupWaitMinutes', getPickupWaitMinutes],
  ['getPickupWaitStartedAt', getPickupWaitStartedAt],
])('%s: the clock never starts before an advance booking\'s pickup time', (_name, fn) => {
  beforeEach(() => { mockQuery.mockReset(); mockQuery.mockResolvedValue({ rows: [{ minutes: '4', started_at: BOOKED }] }) })

  it('takes the latest of the arrival tap, the first position at the pickup and the booked time', async () => {
    await fn(5n, ARRIVED, 20.3, 85.8, 150, BOOKED)
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]]
    expect(sql).toMatch(/GREATEST\(\$2::timestamptz, COALESCE\(\$6::timestamptz, \$2::timestamptz\), MIN\(recorded_at\)\)/)
    expect(params).toEqual([5n, ARRIVED, 20.3, 85.8, 150, BOOKED])
  })

  it('an ordinary ride passes no booked time, and the extra term is neutral (the arrival tap again)', async () => {
    await fn(5n, ARRIVED, 20.3, 85.8, 150)
    const [, params] = mockQuery.mock.calls[0] as [string, unknown[]]
    expect(params[5]).toBeNull()
  })

  it('still keeps the position check: no position within the pickup radius means no clock at all', async () => {
    await fn(5n, ARRIVED, 20.3, 85.8, 150, BOOKED)
    const [sql] = mockQuery.mock.calls[0] as [string, unknown[]]
    expect(sql).toMatch(/CASE WHEN count\(\*\) = 0 THEN NULL/)
    expect(sql).toMatch(/ST_DWithin\(location, ST_SetSRID\(ST_MakePoint\(\$4::float8, \$3::float8\), 4326\)::geography, \$5\)/)
  })
})
