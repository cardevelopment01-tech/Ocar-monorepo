import { describe, it, expect, vi } from 'vitest'

const client = { query: vi.fn(), release: vi.fn() }
vi.mock('@/db/client', () => ({ pool: { query: vi.fn(), connect: vi.fn(() => Promise.resolve(client)) }, withTransaction: vi.fn() }))
vi.mock('@/db/redis', () => ({ client: {}, withTimeout: vi.fn() }))
vi.mock('@/lib/storage', () => ({ deleteFile: vi.fn() }))
vi.mock('@/lib/audit-log', () => ({ recordAuditLog: vi.fn() }))
vi.mock('@/lib/cache/reference-cache', () => ({ invalidate: vi.fn(), cachedRead: vi.fn() }))
vi.mock('@/modules/drivers/drivers.repository', () => ({ hasApprovedRequiredDocs: vi.fn() }))
vi.mock('@/modules/pricing/pricing.repository', () => ({ invalidateSurgeCache: vi.fn() }))

import { deleteDriver } from '@/modules/admin/admin.repository'

describe('deleteDriver', () => {
  it('clears wallet_topup_orders (FK without ON DELETE) before deleting the driver row', async () => {
    client.query.mockImplementation(async (q: string) =>
      q.includes('SELECT * FROM drivers') ? { rows: [{ id: '42' }], rowCount: 1 } : { rows: [], rowCount: 0 })
    await deleteDriver(42n, 1n, 'test', null)
    const sqls = client.query.mock.calls.map(c => c[0] as string)
    const topup = sqls.indexOf('DELETE FROM wallet_topup_orders WHERE driver_id = $1')
    const driver = sqls.indexOf('DELETE FROM drivers WHERE id = $1')
    expect(topup).toBeGreaterThan(-1)
    expect(driver).toBeGreaterThan(topup)
    expect(client.query.mock.calls[topup]![1]).toEqual([42n])
    expect(sqls).toContain('COMMIT')
  })
})
