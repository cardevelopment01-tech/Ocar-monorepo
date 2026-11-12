import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/modules/admin/admin.repository', () => ({ createAdminRateCard: vi.fn().mockResolvedValue({ id: 1 }) }))

import * as repo from '@/modules/admin/admin.repository'
import { createAdminRateCard } from '@/modules/admin/admin.service'

const BASE = { categoryId: 2, rideType: 'one_way', ratePerKm: 9, ratePerMin: 1, minFare: 100, adminId: 1n }

describe('createAdminRateCard: trip mode', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('passes a city one-way card through', async () => {
    await createAdminRateCard({ ...BASE, tripMode: 'city' })
    expect(repo.createAdminRateCard).toHaveBeenCalledWith(expect.objectContaining({ tripMode: 'city' }))
  })

  it('leaves the mode out when none is sent (old admin screens create standard cards)', async () => {
    await createAdminRateCard(BASE)
    expect(vi.mocked(repo.createAdminRateCard).mock.calls[0]![0]).not.toHaveProperty('tripMode')
  })

  it('refuses an unknown mode, and a city card that is not a one-way card', async () => {
    await expect(createAdminRateCard({ ...BASE, tripMode: 'bogus' as never })).rejects.toMatchObject({ httpStatus: 422 })
    await expect(createAdminRateCard({ ...BASE, rideType: 'rental', tripMode: 'city' })).rejects.toMatchObject({ httpStatus: 422 })
    await expect(createAdminRateCard({ ...BASE, rideType: 'round_trip', tripMode: 'city' })).rejects.toMatchObject({ httpStatus: 422 })
    expect(repo.createAdminRateCard).not.toHaveBeenCalled()
  })
})
