import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/modules/admin-audit/admin-audit.repository', () => ({
  listAuditLog: vi.fn(),
  listAuditLogForTarget: vi.fn(),
}))

import * as repo from '@/modules/admin-audit/admin-audit.repository'
import { listAuditLog, listAuditLogForTarget } from '@/modules/admin-audit/admin-audit.service'

describe('listAuditLog', () => {
  beforeEach(() => vi.clearAllMocks())

  it('defaults to page 1, limit 50 when neither is provided', async () => {
    vi.mocked(repo.listAuditLog).mockResolvedValue({ rows: [], total: 0 } as never)

    await listAuditLog({})

    expect(repo.listAuditLog).toHaveBeenCalledWith({ limit: 50, offset: 0 })
  })

  it('clamps limit to a maximum of 100 even if a larger value is requested', async () => {
    vi.mocked(repo.listAuditLog).mockResolvedValue({ rows: [], total: 0 } as never)

    await listAuditLog({ limit: 5000 })

    expect(repo.listAuditLog).toHaveBeenCalledWith({ limit: 100, offset: 0 })
  })

  it('clamps page to a minimum of 1 even if 0 or a negative value is requested', async () => {
    vi.mocked(repo.listAuditLog).mockResolvedValue({ rows: [], total: 0 } as never)

    await listAuditLog({ page: -5 })

    expect(repo.listAuditLog).toHaveBeenCalledWith({ limit: 50, offset: 0 })
  })

  it('computes offset correctly for page > 1, and returns the pagination metadata shape', async () => {
    vi.mocked(repo.listAuditLog).mockResolvedValue({ rows: [{ id: '1' }], total: 205 } as never)

    const result = await listAuditLog({ page: 3, limit: 50 })

    expect(repo.listAuditLog).toHaveBeenCalledWith({ limit: 50, offset: 100 }) // (3-1)*50
    expect(result).toEqual({
      entries: [{ id: '1' }],
      pagination: { total: 205, page: 3, limit: 50, pages: 5 }, // ceil(205/50)
    })
  })
})

describe('listAuditLogForTarget', () => {
  beforeEach(() => vi.clearAllMocks())

  it('defaults to a tighter limit of 20 (not 50) when scoped to a single target', async () => {
    vi.mocked(repo.listAuditLogForTarget).mockResolvedValue({ rows: [], total: 0 } as never)

    await listAuditLogForTarget('drivers', 42n, {})

    expect(repo.listAuditLogForTarget).toHaveBeenCalledWith({
      targetTable: 'drivers', targetId: 42n, limit: 20, offset: 0,
    })
  })

  it('still clamps limit to 100 for a target-scoped query', async () => {
    vi.mocked(repo.listAuditLogForTarget).mockResolvedValue({ rows: [], total: 0 } as never)

    await listAuditLogForTarget('drivers', 42n, { limit: 500 })

    expect(repo.listAuditLogForTarget).toHaveBeenCalledWith({
      targetTable: 'drivers', targetId: 42n, limit: 100, offset: 0,
    })
  })
})
