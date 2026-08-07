import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/modules/call-masking/call-masking.repository')
vi.mock('@/lib/system-config')
vi.mock('@/modules/call-masking/call-masking.exotel-client')
vi.mock('@/modules/rides/rides.repository')

import * as repo from '@/modules/call-masking/call-masking.repository'
import * as sysConfig from '@/lib/system-config'
import * as exotel from '@/modules/call-masking/call-masking.exotel-client'
import * as ridesRepo from '@/modules/rides/rides.repository'
import * as service from '@/modules/call-masking/call-masking.service'

// Minimal ride shape — triggerCall only reads user_id/driver_id off it.
const rideFor = (userId: string, driverId: string | null) =>
  ({ user_id: userId, driver_id: driverId }) as unknown as Awaited<ReturnType<typeof ridesRepo.getRideById>>

describe('call-masking service — triggerCall', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: caller (userId 1n) is the ride's rider — most tests aren't
    // exercising the ownership check itself.
    vi.mocked(ridesRepo.getRideById).mockResolvedValue(rideFor('1', '9'))
  })

  it('throws RIDE_NOT_FOUND when the ride does not exist', async () => {
    vi.mocked(ridesRepo.getRideById).mockResolvedValue(null)
    await expect(
      service.triggerCall({ rideId: 1n, callerRole: 'user', callerId: 1n })
    ).rejects.toMatchObject({ appCode: 'RIDE_NOT_FOUND' })
  })

  it('throws AUTH_FORBIDDEN when the caller is not this ride\'s rider or driver', async () => {
    vi.mocked(ridesRepo.getRideById).mockResolvedValue(rideFor('1', '9'))
    await expect(
      service.triggerCall({ rideId: 1n, callerRole: 'user', callerId: 999n })
    ).rejects.toMatchObject({ appCode: 'AUTH_FORBIDDEN' })
    await expect(
      service.triggerCall({ rideId: 1n, callerRole: 'driver', callerId: 999n })
    ).rejects.toMatchObject({ appCode: 'AUTH_FORBIDDEN' })
  })

  it('throws MASKING_DISABLED when the kill switch is off', async () => {
    vi.mocked(sysConfig.getConfigValue).mockResolvedValue('false')
    await expect(
      service.triggerCall({ rideId: 1n, callerRole: 'user', callerId: 1n })
    ).rejects.toMatchObject({
      code: 'MASKING_DISABLED',
    })
  })

  it('throws CALL_LIMIT_REACHED when the ride has hit its per-ride call cap', async () => {
    vi.mocked(sysConfig.getConfigValue).mockImplementation(async (key: string) =>
      key === 'exotel_masking_enabled' ? 'true' : key === 'exotel_max_calls_per_ride' ? '5' : '600'
    )
    vi.mocked(repo.getActiveMaskForRide).mockResolvedValue({
      id: 1n,
      rideId: 1n,
      virtualNumber: '+911111111111',
      driverPhone: '+919000000001',
      riderPhone: '+919000000002',
      callCount: 5,
      expiresAt: new Date(Date.now() + 60_000),
    })
    await expect(
      service.triggerCall({ rideId: 1n, callerRole: 'user', callerId: 1n })
    ).rejects.toMatchObject({
      code: 'CALL_LIMIT_REACHED',
    })
  })

  it('throws MASK_EXPIRED when the active mask is past its TTL', async () => {
    vi.mocked(sysConfig.getConfigValue).mockImplementation(async (key: string) =>
      key === 'exotel_masking_enabled' ? 'true' : key === 'exotel_max_calls_per_ride' ? '5' : '600'
    )
    vi.mocked(repo.getActiveMaskForRide).mockResolvedValue({
      id: 1n,
      rideId: 1n,
      virtualNumber: '+911111111111',
      driverPhone: '+919000000001',
      riderPhone: '+919000000002',
      callCount: 0,
      expiresAt: new Date(Date.now() - 60_000),
    })
    await expect(
      service.triggerCall({ rideId: 1n, callerRole: 'user', callerId: 1n })
    ).rejects.toMatchObject({
      code: 'MASK_EXPIRED',
    })
  })

  it('calls Exotel with the rider as From and the driver as To when the rider taps call', async () => {
    vi.mocked(sysConfig.getConfigValue).mockImplementation(async (key: string) =>
      key === 'exotel_masking_enabled' ? 'true' : key === 'exotel_max_calls_per_ride' ? '5' : '600'
    )
    vi.mocked(repo.getActiveMaskForRide).mockResolvedValue({
      id: 1n,
      rideId: 1n,
      virtualNumber: '+911111111111',
      driverPhone: '+919000000001',
      riderPhone: '+919000000002',
      callCount: 0,
      expiresAt: new Date(Date.now() + 60_000),
    })
    vi.mocked(exotel.connectTwoNumbers).mockResolvedValue({ sid: 'CAxxx', status: 'in-progress' })

    await service.triggerCall({ rideId: 1n, callerRole: 'user', callerId: 1n })

    expect(exotel.connectTwoNumbers).toHaveBeenCalledWith(
      expect.objectContaining({
        from: '+919000000002',
        to: '+919000000001',
        callerId: '+911111111111',
      })
    )
    expect(repo.incrementCallCount).toHaveBeenCalledWith(1n)
  })
})
