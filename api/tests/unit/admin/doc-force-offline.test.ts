import { describe, it, expect, vi, beforeEach } from 'vitest'

const { fakeClient } = vi.hoisted(() => ({ fakeClient: { query: vi.fn() } }))

vi.mock('@/db/client', () => ({
  pool: { query: vi.fn() },
  withTransaction: async (fn: (c: typeof fakeClient) => unknown) => fn(fakeClient),
}))
vi.mock('@/modules/drivers/drivers.repository', () => ({
  hasApprovedRequiredDocs: vi.fn(),
}))
vi.mock('@/lib/audit-log', () => ({ recordAuditLog: vi.fn() }))

import { hasApprovedRequiredDocs } from '@/modules/drivers/drivers.repository'
import { syncDriverStatusAfterDocChange } from '@/modules/admin/admin.repository'

const DRIVER_ID = BigInt(42)
const ADMIN_ID = BigInt(1)

describe('syncDriverStatusAfterDocChange — force offline on revocation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fakeClient.query.mockImplementation((sql: string) => {
      if (String(sql).includes('SELECT status FROM drivers')) {
        return Promise.resolve({ rows: [{ status: 'active' }] })
      }
      return Promise.resolve({ rows: [] })
    })
  })

  it('ends any online session when an active driver becomes ineligible', async () => {
    vi.mocked(hasApprovedRequiredDocs).mockResolvedValue(false)

    await syncDriverStatusAfterDocChange(DRIVER_ID, ADMIN_ID)

    const sessionCall = fakeClient.query.mock.calls.find(c =>
      String(c[0]).includes('UPDATE driver_sessions'))
    expect(sessionCall).toBeTruthy()
    expect(String(sessionCall![0])).toContain("status = 'offline'")
    expect(String(sessionCall![0])).toContain("status = 'online'")
    expect(sessionCall![1]).toEqual([DRIVER_ID])
  })

  it('does NOT end sessions when the driver remains eligible', async () => {
    vi.mocked(hasApprovedRequiredDocs).mockResolvedValue(true)

    await syncDriverStatusAfterDocChange(DRIVER_ID, ADMIN_ID)

    const sessionCall = fakeClient.query.mock.calls.find(c =>
      String(c[0]).includes('UPDATE driver_sessions'))
    expect(sessionCall).toBeUndefined()
  })

  // Regression: the reinstate UPDATE referenced $2 (approved_by) but was given only [driverId], so
  // Postgres threw "bind message supplies 1 parameters, but prepared statement requires 2", the
  // transaction rolled back, and a driver whose rejected doc was re-approved stayed docs_rejected.
  // A mocked client never notices a placeholder/param mismatch, so assert it explicitly.
  it('reinstates a docs_rejected driver when all docs are approved, binding every placeholder', async () => {
    vi.mocked(hasApprovedRequiredDocs).mockResolvedValue(true)
    fakeClient.query.mockImplementation((sql: string) =>
      Promise.resolve({ rows: String(sql).includes('SELECT status FROM drivers') ? [{ status: 'docs_rejected' }] : [] }))

    await syncDriverStatusAfterDocChange(DRIVER_ID, ADMIN_ID)

    const update = fakeClient.query.mock.calls.find(c => String(c[0]).includes("SET status = 'active'"))
    expect(update).toBeTruthy()
    for (const [sql, params] of fakeClient.query.mock.calls as [string, unknown[]][]) {
      const highest = Math.max(0, ...[...String(sql).matchAll(/\$(\d+)/g)].map(m => Number(m[1])))
      expect(params?.length ?? 0, String(sql)).toBeGreaterThanOrEqual(highest)
    }
    expect(update![1]).toEqual([DRIVER_ID, ADMIN_ID])
  })
})
