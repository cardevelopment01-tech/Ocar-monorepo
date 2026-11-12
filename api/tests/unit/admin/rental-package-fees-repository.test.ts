import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db/client', () => ({ pool: { query: vi.fn() } }))
vi.mock('@/db/redis', () => ({
  getJSON: vi.fn().mockResolvedValue(null),
  setWithTTL: vi.fn().mockResolvedValue(undefined),
  client: { del: vi.fn().mockResolvedValue(1), get: vi.fn(), set: vi.fn() },
}))

import { pool } from '@/db/client'
import { createAdminRentalPackage, updateAdminRentalPackage, listAdminRentalPackages } from '@/modules/admin/admin.repository'

const sqlOf = (i = 0) => String(vi.mocked(pool.query).mock.calls[i]![0])
const paramsOf = (i = 0) => vi.mocked(pool.query).mock.calls[i]![1] as unknown[]

describe('admin rental package repository: the fees', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(pool.query).mockResolvedValue({ rows: [{ id: 1 }], rowCount: 1 } as never)
  })

  it('creating a package stores both fees', async () => {
    await createAdminRentalPackage(
      { category_id: 1, duration_minutes: 240, km_limit: 40, package_fare: 500, extra_per_km: 8, extra_per_min: 1, stop_charge: 15, cancellation_fee: 50 },
      BigInt(1),
    )
    expect(sqlOf()).toMatch(/stop_charge,\s*cancellation_fee/)
    expect(paramsOf()).toContain(15)
    expect(paramsOf()).toContain(50)
    expect(sqlOf()).toMatch(/stop_charge::text,\s*cancellation_fee::text/)
  })

  it('updating changes only the fee sent', async () => {
    await updateAdminRentalPackage(BigInt(1), { cancellation_fee: 75 }, BigInt(2))
    expect(sqlOf()).toMatch(/cancellation_fee\s*=\s*\$1/)
    expect(sqlOf()).not.toMatch(/stop_charge\s*=/)
    expect(paramsOf()[0]).toBe(75)
  })

  it('the list returns both fees for the admin screen', async () => {
    await listAdminRentalPackages(null)
    expect(sqlOf()).toMatch(/rp\.stop_charge::text/)
    expect(sqlOf()).toMatch(/rp\.cancellation_fee::text/)
    await listAdminRentalPackages(7)
    expect(sqlOf(1)).toMatch(/rp\.stop_charge::text/)
    expect(sqlOf(1)).toMatch(/rp\.cancellation_fee::text/)
  })
})
