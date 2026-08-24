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
})
