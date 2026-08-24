import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/modules/admin/admin.repository', () => ({
  approveDriverDoc: vi.fn(),
  approveVehicleDoc: vi.fn(),
  syncDriverStatusAfterDocChange: vi.fn(),
}))
vi.mock('@/lib/audit-log', () => ({ recordAuditLog: vi.fn() }))

import * as repo from '@/modules/admin/admin.repository'
import { approveDriverDoc } from '@/modules/admin/admin.service'

const DOC_ID = BigInt(10)
const ADMIN_ID = BigInt(1)
const SEEN = '2026-08-24T10:00:00.000Z'
const VERIFIED = '2030-01-01'

describe('approveDriverDoc — verified expiry requirement', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rejects approval with no verified expiry date', async () => {
    await expect(approveDriverDoc(DOC_ID, ADMIN_ID, '', SEEN, null))
      .rejects.toMatchObject({ httpStatus: 422 })
    expect(repo.approveDriverDoc).not.toHaveBeenCalled()
  })

  it('passes the verified expiry through to the repository on a valid approval', async () => {
    vi.mocked(repo.approveDriverDoc).mockResolvedValue({ driver_id: '42' })
    await approveDriverDoc(DOC_ID, ADMIN_ID, VERIFIED, SEEN, '1.2.3.4')
    expect(repo.approveDriverDoc).toHaveBeenCalledWith(DOC_ID, ADMIN_ID, VERIFIED, SEEN)
    expect(repo.syncDriverStatusAfterDocChange).toHaveBeenCalledWith(BigInt(42), ADMIN_ID)
  })
})
