import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db/client', () => ({ pool: { query: vi.fn() } }))

import { pool } from '@/db/client'
import { findNearbyDrivers, findReturnCabDrivers } from '@/modules/rides/rides.repository'

function lastSql(): string {
  return vi.mocked(pool.query).mock.calls[0]![0] as unknown as string
}

describe('candidate-matching queries exclude ineligible drivers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(pool.query).mockResolvedValue({ rows: [] } as never)
  })

  it('findNearbyDrivers filters out drivers with a doc issue', async () => {
    await findNearbyDrivers({ lat: 20.29, lng: 85.82, categoryIds: [BigInt(2)], minWalletBalance: 0 })
    const sql = lastSql()
    expect(sql).toContain('NOT EXISTS')
    expect(sql).toContain('driver_vehicle_documents')
    expect(sql).toContain('ds.driver_id')
  })

  it('findReturnCabDrivers filters out drivers with a doc issue', async () => {
    await findReturnCabDrivers({
      pickupLat: 20.29, pickupLng: 85.82, dropLat: 19.8, dropLng: 85.83,
      categoryIds: [BigInt(2)], minWalletBalance: 0,
    })
    const sql = lastSql()
    expect(sql).toContain('NOT EXISTS')
    expect(sql).toContain('rcr.driver_id')
  })
})
