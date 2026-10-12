import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db/client', () => ({ pool: { query: vi.fn() } }))
vi.mock('@/db/redis', () => ({ client: { get: vi.fn(), set: vi.fn(), del: vi.fn() } }))

import { pool } from '@/db/client'
import { createRideAssignment } from '@/modules/rides/rides.repository'

describe('createRideAssignment - re-offering to a driver who already has a row', () => {
  beforeEach(() => vi.clearAllMocks())

  async function whereClause(): Promise<string> {
    vi.mocked(pool.query).mockResolvedValue({ rows: [], rowCount: 1 } as never)
    await createRideAssignment({
      rideId: 1n, driverId: 2n, sessionId: 3n, expiresAt: new Date(), broadcastRound: 0,
    })
    const sql = vi.mocked(pool.query).mock.calls[0]![0] as string
    return sql.slice(sql.indexOf('WHERE ride_assignments.status'))
  }

  it('reopens a CANCELLED row: admin assign calls cancelAllAssignments() first, which cancels the chosen driver\'s own open offer', async () => {
    expect(await whereClause()).toMatch(/'cancelled'/)
  })

  it('still reopens offered, declined and expired rows', async () => {
    const where = await whereClause()
    for (const status of ['offered', 'declined', 'expired']) expect(where).toContain(`'${status}'`)
  })

  it('never resurrects an offer for a ride that is no longer requested (stale broadcast after another driver won)', async () => {
    const where = await whereClause()
    expect(where).toMatch(/EXISTS \(SELECT 1 FROM rides r WHERE r\.id = ride_assignments\.ride_id AND r\.status = 'requested'\)/)
  })

  it('clears cancelled_at when it reopens a row', async () => {
    vi.mocked(pool.query).mockResolvedValue({ rows: [], rowCount: 1 } as never)
    await createRideAssignment({ rideId: 1n, driverId: 2n, sessionId: 3n, expiresAt: new Date(), broadcastRound: 1 })
    expect(vi.mocked(pool.query).mock.calls[0]![0] as string).toMatch(/cancelled_at = NULL/)
  })

  it('never reopens an ACCEPTED row', async () => {
    expect(await whereClause()).not.toContain("'accepted'")
  })
})
