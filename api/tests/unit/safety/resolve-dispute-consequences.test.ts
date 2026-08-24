import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/modules/safety/safety.repository', () => ({
  getRideBasic: vi.fn(),
  insertDriverWarning: vi.fn(),
  countRecentDriverWarnings: vi.fn(),
  getDriverStatus: vi.fn(),
}))
vi.mock('@/db/client', () => ({ pool: { query: vi.fn(), connect: vi.fn() } }))
vi.mock('@/modules/geo/geo.service', () => ({ getRoute: vi.fn() }))
vi.mock('@/modules/admin/admin.repository', () => ({ updateDriverStatus: vi.fn() }))
vi.mock('@/modules/notifications/notifications.service', () => ({ notifyOwner: vi.fn(), notifyAllAdmins: vi.fn() }))
vi.mock('@/lib/system-config', () => ({ getConfigValue: vi.fn() }))

import * as repo from '@/modules/safety/safety.repository'
import * as adminRepo from '@/modules/admin/admin.repository'
import { notifyOwner } from '@/modules/notifications/notifications.service'
import { getConfigValue } from '@/lib/system-config'
import { applyDisputeOutcomeConsequences } from '@/modules/safety/disputes.service'

const dispute = { id: 1n, ride_id: 5n }

describe('applyDisputeOutcomeConsequences', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(repo.getRideBasic).mockResolvedValue({ id: 5n, status: 'completed', user_id: 7n, driver_id: 42n } as never)
    vi.mocked(repo.getDriverStatus).mockResolvedValue('active')
    vi.mocked(getConfigValue).mockImplementation(async (key: string, fallback: string) => fallback)
  })

  it('does nothing for a non-driver outcome', async () => {
    await applyDisputeOutcomeConsequences(dispute, 'full_refund', 9n, 'refunded')
    expect(repo.insertDriverWarning).not.toHaveBeenCalled()
    expect(adminRepo.updateDriverStatus).not.toHaveBeenCalled()
  })

  it('inserts a warning on driver_warned and notifies the driver, no suspend below threshold', async () => {
    vi.mocked(repo.countRecentDriverWarnings).mockResolvedValue(2)
    await applyDisputeOutcomeConsequences(dispute, 'driver_warned', 9n, 'rude to rider')

    expect(repo.insertDriverWarning).toHaveBeenCalledWith(expect.objectContaining({
      driver_id: 42n, issued_by: 9n, dispute_id: 1n, ride_id: 5n, description: 'rude to rider',
    }))
    expect(notifyOwner).toHaveBeenCalledWith(expect.objectContaining({ ownerType: 'driver', ownerId: 42n }))
    expect(adminRepo.updateDriverStatus).not.toHaveBeenCalled()
  })

  it('auto-suspends when warning count reaches the threshold', async () => {
    vi.mocked(repo.countRecentDriverWarnings).mockResolvedValue(3)
    await applyDisputeOutcomeConsequences(dispute, 'driver_warned', 9n, 'third strike')

    expect(adminRepo.updateDriverStatus).toHaveBeenCalledWith(
      42n, 9n, 'active', 'suspended', expect.stringContaining('warning'), undefined, null
    )
  })

  it('reads a custom threshold from system_config', async () => {
    vi.mocked(getConfigValue).mockImplementation(async (key: string) =>
      key === 'driver_warning_suspend_threshold' ? '2' : '90')
    vi.mocked(repo.countRecentDriverWarnings).mockResolvedValue(2)
    await applyDisputeOutcomeConsequences(dispute, 'driver_warned', 9n, 'second strike, tuned threshold')

    expect(adminRepo.updateDriverStatus).toHaveBeenCalled()
  })

  it('suspends directly on driver_suspended outcome', async () => {
    await applyDisputeOutcomeConsequences(dispute, 'driver_suspended', 9n, 'severe misconduct')
    expect(adminRepo.updateDriverStatus).toHaveBeenCalledWith(
      42n, 9n, 'active', 'suspended', 'severe misconduct', undefined, null
    )
    expect(repo.insertDriverWarning).not.toHaveBeenCalled()
  })

  it('no-ops when the ride has no driver assigned', async () => {
    vi.mocked(repo.getRideBasic).mockResolvedValue({ id: 5n, status: 'completed', user_id: 7n, driver_id: null } as never)
    await applyDisputeOutcomeConsequences(dispute, 'driver_warned', 9n, 'no driver')
    expect(repo.insertDriverWarning).not.toHaveBeenCalled()
  })

  it('does not re-suspend an already-suspended driver', async () => {
    vi.mocked(repo.getDriverStatus).mockResolvedValue('suspended')
    await applyDisputeOutcomeConsequences(dispute, 'driver_suspended', 9n, 'already out')
    expect(adminRepo.updateDriverStatus).not.toHaveBeenCalled()
  })
})
