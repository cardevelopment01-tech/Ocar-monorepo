import { describe, it, expect, vi, beforeEach } from 'vitest'

const client = { query: vi.fn(), release: vi.fn() }
vi.mock('@/db/client', () => ({ pool: { query: vi.fn(), connect: vi.fn(() => Promise.resolve(client)) }, withTransaction: vi.fn() }))
vi.mock('@/db/redis', () => ({ client: {}, withTimeout: vi.fn() }))
vi.mock('@/lib/storage', () => ({ deleteFile: vi.fn() }))
vi.mock('@/lib/audit-log', () => ({ recordAuditLog: vi.fn() }))
vi.mock('@/lib/cache/reference-cache', () => ({ invalidate: vi.fn(), cachedRead: vi.fn() }))
vi.mock('@/modules/drivers/drivers.repository', () => ({ hasApprovedRequiredDocs: vi.fn() }))
vi.mock('@/modules/pricing/pricing.repository', () => ({ invalidateSurgeCache: vi.fn() }))

import { updateDriverStatus } from '@/modules/admin/admin.repository'

const vehicleSqls = () => client.query.mock.calls.map(c => c[0] as string).filter(q => q.includes('UPDATE driver_vehicles'))

describe('updateDriverStatus vehicle activation', () => {
  beforeEach(() => {
    client.query.mockReset()
    client.query.mockResolvedValue({ rows: [{ id: '42' }], rowCount: 1 })
  })

  it('activates only the primary pending vehicle when the driver is approved', async () => {
    await updateDriverStatus(42n, 1n, 'pending_approval', 'active')
    const [sql] = vehicleSqls()
    expect(vehicleSqls()).toHaveLength(1)
    expect(sql).toContain("is_primary = true AND status = 'pending'")
  })

  it('does not touch vehicles for any other status change', async () => {
    await updateDriverStatus(42n, 1n, 'active', 'suspended')
    expect(vehicleSqls()).toHaveLength(0)
  })
})
