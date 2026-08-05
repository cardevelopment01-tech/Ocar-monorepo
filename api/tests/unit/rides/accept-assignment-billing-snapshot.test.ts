import { describe, it, expect, vi, beforeEach } from 'vitest'

const client = { query: vi.fn(), release: vi.fn() }
vi.mock('@/db/client', () => ({
  pool: { connect: vi.fn(() => Promise.resolve(client)) },
}))

import { acceptAssignment } from '@/modules/rides/rides.repository'

describe('acceptAssignment — billing_mode_snapshot', () => {
  beforeEach(() => vi.clearAllMocks())

  it('writes billing_mode_snapshot atomically with the ride acceptance UPDATE', async () => {
    client.query.mockImplementation((sql: string) => {
      if (sql.includes('UPDATE rides')) return Promise.resolve({ rows: [{ id: 1 }], rowCount: 1 })
      if (sql.includes('SELECT id FROM driver_sessions')) return Promise.resolve({ rows: [{ id: 5 }] })
      if (sql.includes('UPDATE ride_assignments SET status = \'cancelled\'')) return Promise.resolve({ rows: [] })
      return Promise.resolve({ rows: [], rowCount: 0 })
    })

    await acceptAssignment(BigInt(1), BigInt(42), 'package')

    const rideUpdateCall = client.query.mock.calls.find((c: unknown[]) => (c[0] as string).includes('UPDATE rides'))
    expect(rideUpdateCall?.[0]).toContain('billing_mode_snapshot')
    expect(rideUpdateCall?.[1]).toEqual([BigInt(1), BigInt(42), 'package'])
  })
})
