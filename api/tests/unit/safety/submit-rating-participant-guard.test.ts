import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/modules/safety/safety.repository', () => ({
  getRideBasic: vi.fn(),
  ratingExists: vi.fn(),
  insertRating: vi.fn(),
  insertRatingTags: vi.fn(),
  updateDriverRatingAvg: vi.fn(),
  updateUserRatingAvg: vi.fn(),
}))
vi.mock('@/db/client', () => ({ pool: { query: vi.fn(), connect: vi.fn() } }))

import * as repo from '@/modules/safety/safety.repository'
import { submitRating } from '@/modules/safety/ratings.service'

describe('submitRating', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(repo.insertRating).mockResolvedValue({ id: 1n } as never)
  })

  const base = { rideId: 5n, direction: 'user_to_driver' as const, score: 5 }

  it('throws 401 when no principal is present', async () => {
    vi.mocked(repo.getRideBasic).mockResolvedValue({ id: 5n, status: 'completed', user_id: 7n, driver_id: 42n } as never)
    await expect(submitRating({ ...base })).rejects.toMatchObject({ httpStatus: 401 })
    expect(repo.insertRating).not.toHaveBeenCalled()
  })

  it('throws 403 NOT_RIDE_PARTICIPANT when the caller is not on the ride', async () => {
    vi.mocked(repo.getRideBasic).mockResolvedValue({ id: 5n, status: 'completed', user_id: 7n, driver_id: 42n } as never)
    await expect(submitRating({ ...base, fromUserId: 999n })).rejects.toMatchObject({
      httpStatus: 403, appCode: 'NOT_RIDE_PARTICIPANT',
    })
    expect(repo.insertRating).not.toHaveBeenCalled()
  })

  it('submits the rating for the ride rider rating the driver', async () => {
    vi.mocked(repo.getRideBasic).mockResolvedValue({ id: 5n, status: 'completed', user_id: 7n, driver_id: 42n } as never)
    const rating = await submitRating({ ...base, fromUserId: 7n })
    expect(rating).toMatchObject({ id: 1n })
    expect(repo.insertRating).toHaveBeenCalledWith(expect.objectContaining({
      ride_id: 5n,
      direction: 'user_to_driver',
      from_user_id: 7n,
      from_driver_id: null,
      to_driver_id: 42n,
      to_user_id: null,
    }))
  })
})
