import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockQuery = vi.fn()
const mockConnect = vi.fn()
vi.mock('@/db/client', () => ({
  pool: {
    query: (...args: unknown[]) => mockQuery(...args),
    connect: () => mockConnect(),
  },
}))

import {
  getCityBillingMode,
  hasRideGpsActivity,
  getAssignCandidates,
  setForceAssignGraceJob,
  clearForceAssignGraceJob,
  revertForceAssign,
} from './rides.repository'

describe('getCityBillingMode', () => {
  beforeEach(() => { mockQuery.mockReset() })

  it('returns the billing_mode for a known city', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ billing_mode: 'commission' }] })
    const result = await getCityBillingMode(1n)
    expect(result).toBe('commission')
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('FROM cities'), [1n])
  })

  it('throws a 404-shaped error when the city does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })
    await expect(getCityBillingMode(999n)).rejects.toMatchObject({ httpStatus: 404 })
  })
})

describe('hasRideGpsActivity', () => {
  beforeEach(() => { mockQuery.mockReset() })

  it('returns true when gps_tracks has a row for the ride', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ exists: true }] })
    const result = await hasRideGpsActivity(42n)
    expect(result).toBe(true)
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('FROM gps_tracks'), [42n])
  })

  it('returns false when there are no rows', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ exists: false }] })
    const result = await hasRideGpsActivity(42n)
    expect(result).toBe(false)
  })
})

describe('getAssignCandidates', () => {
  beforeEach(() => { mockQuery.mockReset() })

  it('marks eligible = true only when online, category_ok, and wallet_ok all hold', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { driver_id: '1', driver_name: 'A', driver_phone: '111', session_id: '10', category_id: '2', category_name: 'Sedan', is_online: true, category_ok: true, wallet_ok: true, distance_metres: 1200 },
        { driver_id: '2', driver_name: 'B', driver_phone: '222', session_id: null, category_id: null, category_name: null, is_online: false, category_ok: true, wallet_ok: true, distance_metres: null },
        { driver_id: '3', driver_name: 'C', driver_phone: '333', session_id: '11', category_id: '3', category_name: 'SUV', is_online: true, category_ok: false, wallet_ok: true, distance_metres: 5000 },
      ],
    })

    const result = await getAssignCandidates({
      cityId: 1n, rideLat: 20.29, rideLng: 85.82, categoryIds: [2n], minWalletBalance: 500,
    })

    expect(result.map(r => r.eligible)).toEqual([true, false, false])

    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('ds.category_id = ANY($4::bigint[])')
    expect(params[0]).toBe(1n) // cityId
    expect(params[3]).toEqual([2n]) // categoryIds
  })
})

describe('setForceAssignGraceJob / clearForceAssignGraceJob', () => {
  beforeEach(() => { mockQuery.mockReset() })

  it('sets the job id', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })
    await setForceAssignGraceJob(5n, 'job-123')
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('force_assign_grace_job_id = $2'), [5n, 'job-123'])
  })

  it('clears the job id', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })
    await clearForceAssignGraceJob(5n)
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('force_assign_grace_job_id = NULL'), [5n])
  })
})

describe('revertForceAssign', () => {
  beforeEach(() => {
    mockQuery.mockReset()
    mockConnect.mockReset()
  })

  it('returns false and rolls back when the ride is no longer accepted by that driver', async () => {
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // UPDATE ... RETURNING id (no match)
        .mockResolvedValueOnce({}), // ROLLBACK
      release: vi.fn(),
    }
    mockConnect.mockResolvedValueOnce(client)

    const result = await revertForceAssign(5n, 9n)

    expect(result).toBe(false)
    expect(client.query).toHaveBeenCalledWith('ROLLBACK')
  })

  it('reverts the ride and driver session, then commits', async () => {
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: '5' }] }) // UPDATE rides
        .mockResolvedValueOnce({}) // UPDATE driver_sessions
        .mockResolvedValueOnce({}) // UPDATE driver_location_snapshots
        .mockResolvedValueOnce({}), // COMMIT
      release: vi.fn(),
    }
    mockConnect.mockResolvedValueOnce(client)

    const result = await revertForceAssign(5n, 9n)

    expect(result).toBe(true)
    expect(client.query).toHaveBeenCalledWith('COMMIT')
  })
})
