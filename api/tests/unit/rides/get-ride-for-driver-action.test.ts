import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db/client', () => ({ pool: { query: vi.fn() } }))

import { pool } from '@/db/client'
import { getRideForDriverAction } from '@/modules/rides/rides.repository'

describe('getRideForDriverAction', () => {
  beforeEach(() => vi.clearAllMocks())

  it('scopes the query by BOTH ride id and driver id', async () => {
    vi.mocked(pool.query).mockResolvedValue({ rows: [{ id: BigInt(101) }], rowCount: 1 } as never)

    await getRideForDriverAction(BigInt(101), BigInt(9))

    const [sql, params] = vi.mocked(pool.query).mock.calls[0]!
    expect(sql).toContain('r.driver_id = $2')
    expect(sql).toContain('WHERE r.id = $1')
    expect(params).toEqual([BigInt(101), BigInt(9)])
  })

  it('keeps the computed origin/destination columns from the shared SELECT', async () => {
    vi.mocked(pool.query).mockResolvedValue({ rows: [], rowCount: 0 } as never)

    await getRideForDriverAction(BigInt(101), BigInt(9))

    const [sql] = vi.mocked(pool.query).mock.calls[0]!
    expect(sql).toContain('AS origin_lat')
    expect(sql).toContain('AS dest_lat')
    expect(sql).toContain('fs.total_estimated')
  })

  it('returns null when no row matches (wrong driver or unknown ride)', async () => {
    vi.mocked(pool.query).mockResolvedValue({ rows: [], rowCount: 0 } as never)
    const result = await getRideForDriverAction(BigInt(101), BigInt(9))
    expect(result).toBeNull()
  })

  it('returns the row when it matches', async () => {
    vi.mocked(pool.query).mockResolvedValue({ rows: [{ id: BigInt(101), driver_id: 9 }], rowCount: 1 } as never)
    const result = await getRideForDriverAction(BigInt(101), BigInt(9))
    expect(result).toMatchObject({ id: BigInt(101) })
  })
})
