import { describe, it, expect, vi, beforeEach } from 'vitest'

// admin.service / admin.controller pull in a lot; mock the repository and the service edge so only the
// base_fare validation is exercised.
const repoCreate = vi.fn()
vi.mock('@/modules/admin/admin.repository', () => ({ createAdminRateCard: (...a: unknown[]) => repoCreate(...a) }))
vi.mock('@/db/client', () => ({ pool: { query: vi.fn(), connect: vi.fn() }, withTransaction: vi.fn() }))
vi.mock('@/db/redis', () => ({ client: {}, withTimeout: vi.fn() }))

import { createAdminRateCard } from '@/modules/admin/admin.service'

const BASE = { categoryId: 1, ratePerKm: 10, ratePerMin: 1, minFare: 100, adminId: 1n }

describe('createAdminRateCard base_fare validation', () => {
  beforeEach(() => { vi.clearAllMocks(); repoCreate.mockResolvedValue({ id: 1 }) })

  it('accepts a base fare on one_way and round_trip', async () => {
    await createAdminRateCard({ ...BASE, rideType: 'one_way', baseFare: 150 })
    await createAdminRateCard({ ...BASE, rideType: 'round_trip', baseFare: 0 })
    expect(repoCreate).toHaveBeenCalledTimes(2)
  })

  it('rejects a base fare above 0 on a rental card (never charged there)', async () => {
    await expect(createAdminRateCard({ ...BASE, rideType: 'rental', baseFare: 150 })).rejects.toBeTruthy()
    expect(repoCreate).not.toHaveBeenCalled()
  })

  it('still allows 0 / omitted on a rental card', async () => {
    await createAdminRateCard({ ...BASE, rideType: 'rental', baseFare: 0 })
    await createAdminRateCard({ ...BASE, rideType: 'rental' })
    expect(repoCreate).toHaveBeenCalledTimes(2)
  })

  it('rejects NaN (what the controller produces for a non-number), negatives and huge values', async () => {
    for (const baseFare of [NaN, -1, 100000]) {
      await expect(createAdminRateCard({ ...BASE, rideType: 'one_way', baseFare })).rejects.toBeTruthy()
    }
    expect(repoCreate).not.toHaveBeenCalled()
  })
})
