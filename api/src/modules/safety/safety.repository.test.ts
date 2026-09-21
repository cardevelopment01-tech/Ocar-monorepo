import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockQuery = vi.fn()
vi.mock('@/db/client', () => ({
  pool: { query: (...args: unknown[]) => mockQuery(...args) },
}))

import { getDisputeById, getDisputeCoreById } from './safety.repository'

describe('getDisputeCoreById', () => {
  beforeEach(() => { mockQuery.mockReset() })

  it('queries disputes directly with no joins', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: '1', ride_id: '5' }] })

    await getDisputeCoreById(1n)

    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]]
    expect(sql).not.toContain('JOIN')
    expect(sql).toContain('FROM disputes')
    expect(sql).toContain('WHERE id = $1')
    expect(params).toEqual([1n])
  })

  it('returns null when no row matches', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })
    const result = await getDisputeCoreById(999n)
    expect(result).toBeNull()
  })
})

describe('getDisputeById', () => {
  beforeEach(() => { mockQuery.mockReset() })

  it('joins rides/users/drivers/admins for the admin detail view', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: '1' }] })

    await getDisputeById(1n)

    const [sql] = mockQuery.mock.calls[0] as [string]
    expect(sql).toContain('JOIN rides')
    expect(sql).toContain('user_name')
    expect(sql).toContain('driver_name')
  })
})
