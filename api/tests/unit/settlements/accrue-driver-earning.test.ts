import { describe, it, expect, vi, beforeEach } from 'vitest'

const client = { query: vi.fn(), release: vi.fn() }
const poolQuery = vi.fn()
vi.mock('@/db/client', () => ({
  pool: { query: (...args: unknown[]) => poolQuery(...args), connect: vi.fn(() => Promise.resolve(client)) },
}))

import { accrueDriverEarning } from '@/modules/payments/submodules/settlements/settlements.service'

function scriptAccrue(opts: { driverEarning: string; grossFare: string; panVerified: boolean }) {
  poolQuery.mockReset()
  poolQuery
    .mockResolvedValueOnce({ rows: [{ driver_earning: opts.driverEarning, amount: opts.grossFare }], rowCount: 1 }) // SELECT payments
    .mockResolvedValueOnce({ rows: [{ value: '24' }], rowCount: 1 })   // payout_hold_hours
    .mockResolvedValueOnce({ rows: [{ pan_verified: opts.panVerified }], rowCount: opts.panVerified ? 1 : 0 }) // driver_tax_profile
    .mockResolvedValueOnce({ rows: [{ value: '1' }], rowCount: 1 })    // tds_rate_with_pan_pct
    .mockResolvedValueOnce({ rows: [{ value: '20' }], rowCount: 1 })   // tds_rate_without_pan_pct

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
      .map(c => c[1] as unknown[])
    expect(inserts).toHaveLength(2)
    expect(inserts[0]?.includes('ride_fare_net')).toBe(true)
    expect(inserts[1]?.includes('tds_deduction')).toBe(true)
    // 1% of gross fare 400 = 4.00, stored as a negative amount
    expect(inserts[1]).toContain(-4)
  })

  it('PAN not verified: uses the 20% rate', async () => {
    scriptAccrue({ driverEarning: '340.00', grossFare: '400.00', panVerified: false })
    await accrueDriverEarning(BigInt(1), BigInt(42))

    const tdsInsert = client.query.mock.calls
      .find(c => (c[0] as string).includes('INSERT INTO driver_earnings') && (c[1] as unknown[]).includes('tds_deduction'))
    expect(tdsInsert?.[1]).toContain(-80) // 20% of 400
  })

  it('idempotency_key is deterministic per ride so a re-run cannot double-accrue', async () => {
    scriptAccrue({ driverEarning: '340.00', grossFare: '400.00', panVerified: true })
    await accrueDriverEarning(BigInt(7), BigInt(42))

    const rideFareInsert = client.query.mock.calls
      .find(c => (c[0] as string).includes('INSERT INTO driver_earnings') && (c[1] as unknown[]).includes('ride_fare_net'))
    expect(rideFareInsert?.[1]).toContain('ride_fare_net:ride:7')
  })
})
