import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/modules/admin/admin.repository', () => ({
  listAdminRentalPackages:  vi.fn(),
  updateAdminRentalPackage: vi.fn(),
  createAdminRentalPackage: vi.fn(),
}))

import * as repo from '@/modules/admin/admin.repository'
import { createAdminRentalPackage, updateAdminRentalPackage } from '@/modules/admin/admin.service'

const ADMIN_ID = BigInt(1)
const BASE = { category_id: 1, duration_minutes: 240, km_limit: 40, package_fare: 500, extra_per_km: 8, extra_per_min: 1 }
const ROW = {
  id: 1, category_id: 1, duration_minutes: 240, km_limit: 40, display_order: 100,
  package_fare: '500.00', extra_per_km: '8.00', extra_per_min: '1.00', stop_charge: '15.00', cancellation_fee: '50.00',
  is_active: true, city_id: null, updated_by: 1, created_at: '', updated_at: '',
}

describe('createAdminRentalPackage: the fees', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('requires both fees, so a forgotten field never becomes a free cancellation', async () => {
    await expect(createAdminRentalPackage({ ...BASE, stop_charge: 15 } as never, ADMIN_ID))
      .rejects.toMatchObject({ httpStatus: 400, message: expect.stringContaining('cancellation_fee') })
    await expect(createAdminRentalPackage({ ...BASE, cancellation_fee: 50 } as never, ADMIN_ID))
      .rejects.toMatchObject({ httpStatus: 400, message: expect.stringContaining('stop_charge') })
    expect(repo.createAdminRentalPackage).not.toHaveBeenCalled()
  })

  it.each([[-1], [5001], [NaN]])('rejects a fee of %s', async (bad) => {
    await expect(createAdminRentalPackage({ ...BASE, stop_charge: bad, cancellation_fee: 50 }, ADMIN_ID))
      .rejects.toMatchObject({ httpStatus: 400, message: expect.stringContaining('stop_charge') })
    await expect(createAdminRentalPackage({ ...BASE, stop_charge: 15, cancellation_fee: bad }, ADMIN_ID))
      .rejects.toMatchObject({ httpStatus: 400, message: expect.stringContaining('cancellation_fee') })
  })

  it('accepts 0 for both (free stops, free cancellation chosen on purpose) and passes them to the repository', async () => {
    vi.mocked(repo.createAdminRentalPackage).mockResolvedValue(ROW as never)
    await createAdminRentalPackage({ ...BASE, stop_charge: 0, cancellation_fee: 0 }, ADMIN_ID)
    expect(repo.createAdminRentalPackage).toHaveBeenCalledWith(expect.objectContaining({ stop_charge: 0, cancellation_fee: 0 }), ADMIN_ID)
  })
})

describe('updateAdminRentalPackage: the fees', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('rejects a negative or oversized fee', async () => {
    await expect(updateAdminRentalPackage(BigInt(1), { cancellation_fee: -5 }, ADMIN_ID))
      .rejects.toMatchObject({ httpStatus: 400, message: expect.stringContaining('cancellation_fee') })
    await expect(updateAdminRentalPackage(BigInt(1), { stop_charge: 5001 }, ADMIN_ID))
      .rejects.toMatchObject({ httpStatus: 400, message: expect.stringContaining('stop_charge') })
  })

  it('changes only the fee that was sent', async () => {
    vi.mocked(repo.updateAdminRentalPackage).mockResolvedValue(ROW as never)
    await updateAdminRentalPackage(BigInt(1), { cancellation_fee: 75 }, ADMIN_ID)
    const sent = vi.mocked(repo.updateAdminRentalPackage).mock.calls[0]![1]
    expect(sent).toEqual({ cancellation_fee: 75 })
  })

  it('leaves both fees alone when neither is sent', async () => {
    vi.mocked(repo.updateAdminRentalPackage).mockResolvedValue(ROW as never)
    await updateAdminRentalPackage(BigInt(1), { is_active: false }, ADMIN_ID)
    const sent = vi.mocked(repo.updateAdminRentalPackage).mock.calls[0]![1] as Record<string, unknown>
    expect('stop_charge' in sent).toBe(false)
    expect('cancellation_fee' in sent).toBe(false)
  })
})
