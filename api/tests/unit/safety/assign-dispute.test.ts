import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/modules/safety/safety.repository', () => ({
  getDisputeCoreById:   vi.fn(),
  updateDisputeStatus:  vi.fn(),
  insertDisputeAction:  vi.fn(),
}))

import * as repo from '@/modules/safety/safety.repository'
import { assignDispute } from '@/modules/safety/disputes.service'

describe('assignDispute', () => {
  beforeEach(() => vi.clearAllMocks())

  it('throws 404 when the dispute does not exist (existence check via the join-free fetch)', async () => {
    vi.mocked(repo.getDisputeCoreById).mockResolvedValue(null)
    await expect(assignDispute(1n, 9n)).rejects.toMatchObject({ httpStatus: 404, appCode: 'DISPUTE_NOT_FOUND' })
    expect(repo.updateDisputeStatus).not.toHaveBeenCalled()
  })

  it('assigns an existing dispute to the admin and logs the action', async () => {
    vi.mocked(repo.getDisputeCoreById).mockResolvedValue({ id: 1n, ride_id: 5n, status: 'open' } as never)
    vi.mocked(repo.updateDisputeStatus).mockResolvedValue({ id: 1n, status: 'under_review' } as never)

    const result = await assignDispute(1n, 9n)

    expect(repo.updateDisputeStatus).toHaveBeenCalledWith(1n, 'under_review', 9n)
    expect(repo.insertDisputeAction).toHaveBeenCalledWith(
      expect.objectContaining({ dispute_id: 1n, admin_id: 9n, action_type: 'assigned' })
    )
    expect(result).toEqual({ id: 1n, status: 'under_review' })
  })
})
