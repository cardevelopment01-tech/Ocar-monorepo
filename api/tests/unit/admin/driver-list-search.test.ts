import { describe, it, expect, vi, beforeEach } from 'vitest'

const query = vi.fn()
vi.mock('@/db/redis', () => ({ client: {}, withTimeout: vi.fn() }))
vi.mock('@/db/client', () => ({ pool: { query: (...a: unknown[]) => query(...a), connect: vi.fn() }, withTransaction: vi.fn() }))
vi.mock('@/lib/storage', () => ({ deleteFile: vi.fn() }))
vi.mock('@/lib/audit-log', () => ({ recordAuditLog: vi.fn() }))
vi.mock('@/lib/cache/reference-cache', () => ({ invalidate: vi.fn(), cachedRead: vi.fn() }))
vi.mock('@/modules/drivers/drivers.repository', () => ({ hasApprovedRequiredDocs: vi.fn() }))
vi.mock('@/modules/pricing/pricing.repository', () => ({ invalidateSurgeCache: vi.fn() }))

import { listDrivers } from '@/modules/admin/admin.repository'

describe('listDrivers search', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    query.mockResolvedValue({ rows: [{ total: '0' }] })
  })

  it('also matches the vehicle number, ignoring spaces and dashes', async () => {
    await listDrivers({ search: 'OD 02-ab 1234', limit: 20, offset: 0 })
    const [sql, params] = query.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain("regexp_replace(sv.number_plate, '[^A-Za-z0-9]', '', 'g') ILIKE $2")
    expect(params.slice(0, 2)).toEqual(['%OD 02-ab 1234%', '%OD02ab1234%'])
  })

  it('falls back to the raw text when the search has no letters or digits', async () => {
    await listDrivers({ search: '--', limit: 20, offset: 0 })
    const [, params] = query.mock.calls[0] as [string, unknown[]]
    expect(params.slice(0, 2)).toEqual(['%--%', '%--%'])
  })
})
