import { describe, it, expect, vi, beforeEach } from 'vitest'

const client = { query: vi.fn(), release: vi.fn() }
const poolQuery = vi.fn()
vi.mock('@/db/client', () => ({
  pool: { query: (...args: unknown[]) => poolQuery(...args), connect: vi.fn(() => Promise.resolve(client)) },
}))
// accrueDriverEarning's payout_hold_hours lookup now reads through
// getConfigValue -> the system_config cache (@/lib/cache/reference-cache ->
// @/db/redis) — without this mock it hits a real, reachable local Redis and
// can skip a poolQuery call on a cache hit, desyncing the scriptAccrue()
// mockResolvedValueOnce sequence below (same fix as
// tests/unit/pricing/pricing.repository.test.ts).
vi.mock('@/db/redis', () => ({
  getJSON: vi.fn().mockResolvedValue(null),
  setWithTTL: vi.fn().mockResolvedValue(undefined),
  client: { del: vi.fn().mockResolvedValue(1) },
}))

import { accrueDriverEarning } from '@/modules/payments/submodules/settlements/settlements.service'

function scriptAccrue(opts: { driverEarning: string; grossFare: string; panVerified: boolean }) {
  poolQuery.mockReset()
  poolQuery
    .mockResolvedValueOnce({ rows: [{ driver_earning: opts.driverEarning, amount: opts.grossFare }], rowCount: 1 }) // SELECT payments
    .mockResolvedValueOnce({ rows: [{ value: '24' }], rowCount: 1 })   // payout_hold_hours
    .mockResolvedValueOnce({ rows: [{ pan_verified: opts.panVerified }], rowCount: opts.panVerified ? 1 : 0 }) // driver_tax_profile
    .mockResolvedValueOnce({
      rows: [
        { key: 'tds_rate_with_pan_pct', value: '1' },
        { key: 'tds_rate_without_pan_pct', value: '20' },
      ],
      rowCount: 2,
    }) // batched TDS rates query

  client.query.mockReset()
  client.query.mockResolvedValue({ rows: [], rowCount: 1 })
}

describe('accrueDriverEarning', () => {
  beforeEach(() => vi.clearAllMocks())

  it('PAN verified: inserts ride_fare_net line and a 1% tds_deduction line', async () => {
    scriptAccrue({ driverEarning: '340.00', grossFare: '400.00', panVerified: true })
    await accrueDriverEarning(BigInt(1), BigInt(42))

    const inserts = client.query.mock.calls
      .filter(c => (c[0] as string).includes('INSERT INTO driver_earnings'))
    expect(inserts).toHaveLength(2)
    expect(inserts[0]?.[0] as string).toContain("'ride_fare_net'")
    expect(inserts[1]?.[0] as string).toContain("'tds_deduction'")
    // 1% of gross fare 400 = 4.00, stored as a negative amount
    expect(inserts[1]?.[1]).toContain(-4)
  })

  it('PAN not verified: uses the 20% rate', async () => {
    scriptAccrue({ driverEarning: '340.00', grossFare: '400.00', panVerified: false })
    await accrueDriverEarning(BigInt(1), BigInt(42))

    const tdsInsert = client.query.mock.calls
      .find(c => (c[0] as string).includes('INSERT INTO driver_earnings') && (c[0] as string).includes("'tds_deduction'"))
    expect(tdsInsert?.[1]).toContain(-80) // 20% of 400
  })

  it('idempotency_key is deterministic per ride so a re-run cannot double-accrue', async () => {
    scriptAccrue({ driverEarning: '340.00', grossFare: '400.00', panVerified: true })
    await accrueDriverEarning(BigInt(7), BigInt(42))

    const rideFareInsert = client.query.mock.calls
      .find(c => (c[0] as string).includes('INSERT INTO driver_earnings') && (c[0] as string).includes("'ride_fare_net'"))
    expect(rideFareInsert?.[1]).toContain('ride_fare_net:ride:7')
  })

  it('fetches both TDS rate keys in a single batched query, not two round trips', async () => {
    scriptAccrue({ driverEarning: '340.00', grossFare: '400.00', panVerified: true })
    await accrueDriverEarning(BigInt(1), BigInt(42))

    const batchedCall = poolQuery.mock.calls.find(c => (c[0] as string).includes('key = ANY'))
    expect(batchedCall).toBeDefined()
    expect(batchedCall?.[1]).toEqual([['tds_rate_with_pan_pct', 'tds_rate_without_pan_pct']])
  })
})
