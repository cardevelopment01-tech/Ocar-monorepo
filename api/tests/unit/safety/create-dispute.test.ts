import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/modules/safety/safety.repository', () => ({
  getRideBasic: vi.fn(),
  insertDispute: vi.fn(),
}))
vi.mock('@/db/client', () => ({ pool: { query: vi.fn(), connect: vi.fn() } }))
vi.mock('@/modules/geo/geo.service', () => ({ getRoute: vi.fn() }))

import * as repo from '@/modules/safety/safety.repository'
import { createDispute } from '@/modules/safety/disputes.service'

describe('createDispute', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(repo.insertDispute).mockResolvedValue({ id: 1n } as never)
  })

  const base = { rideId: 5n, type: 'fare', description: 'overcharged', initiator: 'user' as const }

  it('throws 404 when the ride does not exist', async () => {
    vi.mocked(repo.getRideBasic).mockResolvedValue(null)
    await expect(createDispute({ ...base, initiatedByUserId: 7n })).rejects.toMatchObject({ httpStatus: 404 })
    expect(repo.insertDispute).not.toHaveBeenCalled()
  })

  it('throws 400 RIDE_NOT_COMPLETED for a non-completed ride', async () => {
    vi.mocked(repo.getRideBasic).mockResolvedValue({ id: 5n, status: 'in_progress', user_id: 7n, driver_id: 42n } as never)
    await expect(createDispute({ ...base, initiatedByUserId: 7n })).rejects.toMatchObject({
      httpStatus: 400, appCode: 'RIDE_NOT_COMPLETED',
    })
    expect(repo.insertDispute).not.toHaveBeenCalled()
  })

  it('throws 403 NOT_RIDE_PARTICIPANT when the caller is not on the ride', async () => {
    vi.mocked(repo.getRideBasic).mockResolvedValue({ id: 5n, status: 'completed', user_id: 7n, driver_id: 42n } as never)
    await expect(createDispute({ ...base, initiatedByUserId: 999n })).rejects.toMatchObject({
      httpStatus: 403, appCode: 'NOT_RIDE_PARTICIPANT',
    })
    expect(repo.insertDispute).not.toHaveBeenCalled()
  })

  it('creates the dispute for the ride rider', async () => {
    vi.mocked(repo.getRideBasic).mockResolvedValue({ id: 5n, status: 'completed', user_id: 7n, driver_id: 42n } as never)
    const dispute = await createDispute({ ...base, initiatedByUserId: 7n })
    expect(dispute).toMatchObject({ id: 1n })
    expect(repo.insertDispute).toHaveBeenCalledWith(expect.objectContaining({ ride_id: 5n }))
  })
})
