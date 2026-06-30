import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the entire repository so no DB connection is needed
vi.mock('@/modules/admin/admin.repository', () => ({
  listAdminRentalPackages:  vi.fn(),
  updateAdminRentalPackage: vi.fn(),
  createAdminRentalPackage: vi.fn(),
}))

import * as repo from '@/modules/admin/admin.repository'
import {
  listAdminRentalPackages,
  updateAdminRentalPackage,
  createAdminRentalPackage,
} from '@/modules/admin/admin.service'

const ADMIN_ID = BigInt(1)

// ─── createAdminRentalPackage ─────────────────────────────────────────────────

describe('createAdminRentalPackage', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('rejects invalid duration_hours (3 is not in 1,2,4,6,8,10)', async () => {
    await expect(createAdminRentalPackage(
      { category_id: 1, duration_hours: 3, package_fare: 200, extra_per_km: 10, extra_per_min: 1 },
      ADMIN_ID,
    )).rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining('duration_hours') })
  })

  it('rejects duration_hours = 0', async () => {
    await expect(createAdminRentalPackage(
      { category_id: 1, duration_hours: 0, package_fare: 200, extra_per_km: 10, extra_per_min: 1 },
      ADMIN_ID,
    )).rejects.toMatchObject({ statusCode: 400 })
  })

  it('rejects package_fare = 0', async () => {
    await expect(createAdminRentalPackage(
      { category_id: 1, duration_hours: 4, package_fare: 0, extra_per_km: 10, extra_per_min: 1 },
      ADMIN_ID,
    )).rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining('package_fare') })
  })

  it('rejects negative package_fare', async () => {
    await expect(createAdminRentalPackage(
      { category_id: 1, duration_hours: 4, package_fare: -50, extra_per_km: 10, extra_per_min: 1 },
      ADMIN_ID,
    )).rejects.toMatchObject({ statusCode: 400 })
  })

  it('rejects extra_per_km = 0', async () => {
    await expect(createAdminRentalPackage(
      { category_id: 1, duration_hours: 4, package_fare: 300, extra_per_km: 0, extra_per_min: 1 },
      ADMIN_ID,
    )).rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining('extra_per_km') })
  })

  it('rejects negative extra_per_min', async () => {
    await expect(createAdminRentalPackage(
      { category_id: 1, duration_hours: 4, package_fare: 300, extra_per_km: 10, extra_per_min: -1 },
      ADMIN_ID,
    )).rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining('extra_per_min') })
  })

  it('allows extra_per_min = 0 (valid — no per-minute overage charge)', async () => {
    vi.mocked(repo.createAdminRentalPackage).mockResolvedValue({
      id: 1, category_id: 1, duration_hours: 4, km_limit: 40,
      package_fare: '300.00', extra_per_km: '10.00', extra_per_min: '0.00',
      is_active: true, updated_by: 1, created_at: '', updated_at: '',
    })
    const result = await createAdminRentalPackage(
      { category_id: 1, duration_hours: 4, package_fare: 300, extra_per_km: 10, extra_per_min: 0 },
      ADMIN_ID,
    )
    expect(result.duration_hours).toBe(4)
    expect(repo.createAdminRentalPackage).toHaveBeenCalledOnce()
  })

  it('accepts all valid duration slots', async () => {
    vi.mocked(repo.createAdminRentalPackage).mockResolvedValue({
      id: 2, category_id: 1, duration_hours: 8, km_limit: 80,
      package_fare: '600.00', extra_per_km: '12.00', extra_per_min: '1.50',
      is_active: true, updated_by: 1, created_at: '', updated_at: '',
    })
    for (const h of [1, 2, 4, 6, 8, 10]) {
      await expect(createAdminRentalPackage(
        { category_id: 1, duration_hours: h, package_fare: 200, extra_per_km: 10, extra_per_min: 1 },
        ADMIN_ID,
      )).resolves.not.toThrow()
    }
  })
})

// ─── updateAdminRentalPackage ─────────────────────────────────────────────────

describe('updateAdminRentalPackage', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('rejects package_fare = 0 on update', async () => {
    await expect(updateAdminRentalPackage(
      BigInt(1), { package_fare: 0 }, ADMIN_ID,
    )).rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining('package_fare') })
  })

  it('rejects extra_per_km <= 0 on update', async () => {
    await expect(updateAdminRentalPackage(
      BigInt(1), { extra_per_km: -5 }, ADMIN_ID,
    )).rejects.toMatchObject({ statusCode: 400 })
  })

  it('rejects negative extra_per_min on update', async () => {
    await expect(updateAdminRentalPackage(
      BigInt(1), { extra_per_min: -0.5 }, ADMIN_ID,
    )).rejects.toMatchObject({ statusCode: 400 })
  })

  it('returns 404 when package does not exist', async () => {
    vi.mocked(repo.updateAdminRentalPackage).mockResolvedValue(undefined)
    await expect(updateAdminRentalPackage(
      BigInt(999), { is_active: false }, ADMIN_ID,
    )).rejects.toMatchObject({ statusCode: 404 })
  })

  it('toggle is_active = false succeeds without fare validation', async () => {
    const row = {
      id: 5, category_id: 2, duration_hours: 4, km_limit: 40,
      package_fare: '299.00', extra_per_km: '11.00', extra_per_min: '1.20',
      is_active: false, updated_by: 1, created_at: '', updated_at: '',
    }
    vi.mocked(repo.updateAdminRentalPackage).mockResolvedValue(row)
    const result = await updateAdminRentalPackage(BigInt(5), { is_active: false }, ADMIN_ID)
    expect(result.is_active).toBe(false)
    expect(repo.updateAdminRentalPackage).toHaveBeenCalledWith(BigInt(5), { is_active: false }, ADMIN_ID)
  })

  it('partial update — only supplied fields forwarded to repo', async () => {
    const row = {
      id: 3, category_id: 1, duration_hours: 2, km_limit: 20,
      package_fare: '350.00', extra_per_km: '10.00', extra_per_min: '1.00',
      is_active: true, updated_by: 1, created_at: '', updated_at: '',
    }
    vi.mocked(repo.updateAdminRentalPackage).mockResolvedValue(row)
    await updateAdminRentalPackage(BigInt(3), { package_fare: 350 }, ADMIN_ID)
    expect(repo.updateAdminRentalPackage).toHaveBeenCalledWith(
      BigInt(3), { package_fare: 350 }, ADMIN_ID,
    )
  })
})

// ─── listAdminRentalPackages ──────────────────────────────────────────────────

describe('listAdminRentalPackages', () => {
  it('returns repo result directly', async () => {
    const rows = [{ id: 1, duration_hours: 4, is_active: true }]
    vi.mocked(repo.listAdminRentalPackages).mockResolvedValue(rows as never)
    const result = await listAdminRentalPackages()
    expect(result).toBe(rows)
    expect(repo.listAdminRentalPackages).toHaveBeenCalledOnce()
  })
})
