import { describe, it, expect, vi, beforeEach } from 'vitest'

// Value: protects=the admin API refuses a bad plan with a message the page can show, writes who changed a plan to the audit log, judges an
// edit against the plan as it would become (not just the fields sent), and never creates two identical active plans; fails_when=editing only
// the price lets a ride value fall below it, a duplicate plan is saved, or a price change leaves no audit trail; why_new=plans carry GST,
// validity and a vehicle group; seam=repo and audit log mocked; no_claim=SQL and the HTTP layer.

const { repo, audit } = vi.hoisted(() => ({
  repo: { getPackageTierById: vi.fn(), packageTierDuplicateExists: vi.fn(), createPackageTier: vi.fn(), updatePackageTier: vi.fn() },
  audit: vi.fn(),
}))
vi.mock('@/db/client', () => ({ pool: { query: vi.fn() }, analyticsPool: { query: vi.fn() } }))
vi.mock('@/db/redis', () => ({ client: { get: vi.fn(), set: vi.fn(), del: vi.fn() } }))
vi.mock('@/modules/admin/admin.repository', () => repo)
vi.mock('@/lib/audit-log', () => ({ recordAuditLog: (...a: unknown[]) => audit(...a) }))
vi.mock('@/modules/packages/packages.service', () => ({ getPackageGstPercent: vi.fn().mockResolvedValue(18) }))
vi.mock('@/modules/rides/rides.service', () => ({}))
vi.mock('@/modules/rides/rides.repository', () => ({}))
vi.mock('@/modules/ride-chat/ride-chat.repository', () => ({}))
vi.mock('@/modules/notifications/notifications.service', () => ({}))
vi.mock('@/modules/notifications/templates.service', () => ({}))
vi.mock('@/lib/storage', () => ({}))

import { createPackageTier, updatePackageTier } from '@/modules/admin/admin.service'

const saved = { id: '7', label: 'Starter', price: '40.00', threshold_value: '550.00', is_active: true, vehicle_group: 'cab', validity_days: 365 }
const body = { label: 'Starter', price: 40, thresholdValue: 550, vehicleGroup: 'cab' as const, validityDays: 365, createdBy: BigInt(1) }

describe('createPackageTier', () => {
  beforeEach(() => { vi.clearAllMocks(); repo.packageTierDuplicateExists.mockResolvedValue(false); repo.createPackageTier.mockResolvedValue(saved) })

  it('saves a good plan with a trimmed name and records who made it', async () => {
    await createPackageTier({ ...body, label: '  Starter  ' }, '10.0.0.1')
    expect(repo.createPackageTier).toHaveBeenCalledWith(expect.objectContaining({ label: 'Starter' }))
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ adminId: BigInt(1), action: 'package_tier.create', targetTable: 'package_tiers', ipAddress: '10.0.0.1' }))
  })
  it('refuses a plan worth less than its price, with a 422 and the reason', async () => {
    await expect(createPackageTier({ ...body, price: 550, thresholdValue: 40 })).rejects.toMatchObject({ httpStatus: 422, message: expect.stringMatching(/at least the price/) })
    expect(repo.createPackageTier).not.toHaveBeenCalled()
    expect(audit).not.toHaveBeenCalled()
  })
  it('refuses a price with a third decimal place, a too-long name and an out-of-range validity', async () => {
    await expect(createPackageTier({ ...body, price: 40.123 })).rejects.toMatchObject({ httpStatus: 422 })
    await expect(createPackageTier({ ...body, label: 'x'.repeat(101) })).rejects.toMatchObject({ httpStatus: 422 })
    await expect(createPackageTier({ ...body, validityDays: 4000 })).rejects.toMatchObject({ httpStatus: 422 })
  })
  it('refuses a second active plan with the same drivers, price and ride value (409)', async () => {
    repo.packageTierDuplicateExists.mockResolvedValue(true)
    await expect(createPackageTier(body)).rejects.toMatchObject({ httpStatus: 409, message: expect.stringMatching(/same price and ride value/) })
    expect(repo.createPackageTier).not.toHaveBeenCalled()
  })
})

describe('updatePackageTier', () => {
  beforeEach(() => { vi.clearAllMocks(); repo.getPackageTierById.mockResolvedValue(saved); repo.packageTierDuplicateExists.mockResolvedValue(false); repo.updatePackageTier.mockResolvedValue({ ...saved, price: '60.00' }) })

  it('judges the edit against the saved plan: raising only the price above the ride value is refused', async () => {
    await expect(updatePackageTier(BigInt(7), { price: 600 }, BigInt(1))).rejects.toMatchObject({ httpStatus: 422, message: expect.stringMatching(/at least the price/) })
    expect(repo.updatePackageTier).not.toHaveBeenCalled()
  })
  it('a price change is saved and the audit log carries the before and after', async () => {
    await updatePackageTier(BigInt(7), { price: 60 }, BigInt(2), '10.0.0.2')
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      adminId: BigInt(2), action: 'package_tier.update', targetId: BigInt(7), ipAddress: '10.0.0.2',
      beforeState: expect.objectContaining({ price: '40.00' }), afterState: expect.objectContaining({ price: '60.00' }),
    }))
  })
  it('switching a plan off never trips the duplicate check, switching it on does', async () => {
    repo.packageTierDuplicateExists.mockResolvedValue(true)
    repo.updatePackageTier.mockResolvedValue({ ...saved, is_active: false })
    await expect(updatePackageTier(BigInt(7), { isActive: false }, BigInt(1))).resolves.toMatchObject({ is_active: false })
    repo.getPackageTierById.mockResolvedValue({ ...saved, is_active: false })
    await expect(updatePackageTier(BigInt(7), { isActive: true }, BigInt(1))).rejects.toMatchObject({ httpStatus: 409 })
  })
  it('an unknown plan is a 404, not a crash', async () => {
    repo.getPackageTierById.mockResolvedValue(null)
    await expect(updatePackageTier(BigInt(99), { isActive: false }, BigInt(1))).rejects.toMatchObject({ httpStatus: 404 })
  })
})
