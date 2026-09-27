import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockQuery = vi.fn()
vi.mock('@/db/client', () => ({
  pool: { query: (...args: unknown[]) => mockQuery(...args) },
}))

import { updateRidePickup } from './rides.repository'

describe('updateRidePickup', () => {
  beforeEach(() => { mockQuery.mockReset() })

  it('builds a parameterized PostGIS point update scoped to the allowed statuses', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: '5', driver_id: '9', origin_lat: 20.3, origin_lng: 85.8, origin_address: 'New spot', status: 'accepted' }],
      rowCount: 1,
    })

    const result = await updateRidePickup(5n, 20.3, 85.8, 'New spot', ['requested', 'accepted'])

    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('ST_SetSRID(ST_MakePoint($2::float8, $3::float8), 4326)::geography')
    expect(sql).toContain('status = ANY($5::ride_status[])')
    expect(sql).not.toContain('${') // never string-built geography (CLAUDE.md invariant)
    expect(params).toEqual([5n, 85.8, 20.3, 'New spot', ['requested', 'accepted']])
    expect(result).toEqual({ id: '5', driver_id: '9', origin_lat: 20.3, origin_lng: 85.8, origin_address: 'New spot', status: 'accepted' })
  })

  it('returns null when no row matches (status changed concurrently)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 })

    const result = await updateRidePickup(5n, 20.3, 85.8, null, ['requested', 'accepted'])

    expect(result).toBeNull()
  })
})
