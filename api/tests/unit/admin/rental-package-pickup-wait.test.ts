import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/modules/admin/admin.repository', () => ({
  listAdminRentalPackages:  vi.fn(),
  updateAdminRentalPackage: vi.fn(),
  createAdminRentalPackage: vi.fn(),
}))

import * as repo from '@/modules/admin/admin.repository'
import { createAdminRentalPackage, updateAdminRentalPackage } from '@/modules/admin/admin.service'

const ADMIN_ID = BigInt(1)
const BASE = {
  category_id: 1, duration_minutes: 240, km_limit: 40, package_fare: 500, extra_per_km: 8, extra_per_min: 1,
  stop_charge: 15, cancellation_fee: 50,
}

describe('rental package waiting terms (free minutes and rate at the pickup)', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('a package may leave both blank: null means use the rate card', async () => {
    vi.mocked(repo.createAdminRentalPackage).mockResolvedValue({} as never)
    await createAdminRentalPackage({ ...BASE, pickup_free_wait_min: null, pickup_wait_per_min: null }, ADMIN_ID)
    expect(repo.createAdminRentalPackage).toHaveBeenCalledWith(expect.objectContaining({ pickup_free_wait_min: null, pickup_wait_per_min: null }), ADMIN_ID)
  })

  it('accepts its own values, including 0 free minutes', async () => {
    vi.mocked(repo.createAdminRentalPackage).mockResolvedValue({} as never)
    await createAdminRentalPackage({ ...BASE, pickup_free_wait_min: 0, pickup_wait_per_min: 2.5 }, ADMIN_ID)
    expect(repo.createAdminRentalPackage).toHaveBeenCalledWith(expect.objectContaining({ pickup_free_wait_min: 0, pickup_wait_per_min: 2.5 }), ADMIN_ID)
  })

  it.each([[-1], [121], [2.5], [NaN]])('rejects %s free minutes', async (bad) => {
    await expect(createAdminRentalPackage({ ...BASE, pickup_free_wait_min: bad }, ADMIN_ID))
      .rejects.toMatchObject({ httpStatus: 400, message: expect.stringContaining('pickup_free_wait_min') })
    await expect(updateAdminRentalPackage(BigInt(1), { pickup_free_wait_min: bad }, ADMIN_ID))
      .rejects.toMatchObject({ httpStatus: 400, message: expect.stringContaining('pickup_free_wait_min') })
    expect(repo.createAdminRentalPackage).not.toHaveBeenCalled()
    expect(repo.updateAdminRentalPackage).not.toHaveBeenCalled()
  })

  it.each([[-1], [1000], [NaN]])('rejects a rate of %s a minute', async (bad) => {
    await expect(updateAdminRentalPackage(BigInt(1), { pickup_wait_per_min: bad }, ADMIN_ID))
      .rejects.toMatchObject({ httpStatus: 400, message: expect.stringContaining('pickup_wait_per_min') })
  })

  it('an update can clear an override back to the rate card with null', async () => {
    vi.mocked(repo.updateAdminRentalPackage).mockResolvedValue({} as never)
    await updateAdminRentalPackage(BigInt(1), { pickup_free_wait_min: null, pickup_wait_per_min: null }, ADMIN_ID)
    expect(repo.updateAdminRentalPackage).toHaveBeenCalledWith(BigInt(1), { pickup_free_wait_min: null, pickup_wait_per_min: null }, ADMIN_ID)
  })
})
