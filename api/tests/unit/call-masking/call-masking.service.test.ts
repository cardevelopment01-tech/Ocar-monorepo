import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/system-config')
vi.mock('@/config', () => ({
  config: { BULKSMSPLANS_API_ID: 'id', BULKSMSPLANS_API_PASSWORD: 'pw', BULKSMSPLANS_IVR_NUMBER: '0800000000' },
}))
vi.mock('@/modules/call-masking/call-masking.bulksmsplans-client')
vi.mock('@/modules/rides/rides.repository')
vi.mock('@/db/client', () => ({ pool: { query: vi.fn() } }))
vi.mock('@/db/redis', () => ({ client: { incr: vi.fn(async () => 1), expire: vi.fn(), decr: vi.fn(async () => 0) } }))
vi.mock('@/lib/cache/reference-cache', () => ({ invalidate: vi.fn() }))
vi.mock('@/modules/notifications/notifications.service', () => ({ notifyAllAdmins: vi.fn() }))

import * as sysConfig from '@/lib/system-config'
import * as ivr from '@/modules/call-masking/call-masking.bulksmsplans-client'
import * as ridesRepo from '@/modules/rides/rides.repository'
import { client as redis } from '@/db/redis'
import { pool } from '@/db/client'
import { notifyAllAdmins } from '@/modules/notifications/notifications.service'
import * as service from '@/modules/call-masking/call-masking.service'

// Minimal ride shape — triggerCall only reads a handful of fields off it.
const rideFor = (overrides: Partial<{
  user_id: string
  driver_id: string | null
  status: string
  rider_phone: string | null
  user_phone: string | null
  driver_phone: string | null
}>) =>
  ({
    user_id: '1',
    driver_id: '9',
    status: 'in_progress',
    rider_phone: null,
    user_phone: '+919000000002',
    driver_phone: '+919000000001',
    ...overrides,
  }) as unknown as Awaited<ReturnType<typeof ridesRepo.getRideById>>

function mockConfig(overrides: Record<string, string>) {
  vi.mocked(sysConfig.getConfigValue).mockImplementation(async (key: string, fallback: string) =>
    overrides[key] ?? fallback
  )
}

describe('call-masking service — triggerCall', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockConfig({ call_masking_enabled: 'true' })
    vi.mocked(ridesRepo.getRideById).mockResolvedValue(rideFor({}))
    vi.mocked(redis.incr).mockResolvedValue(1)
  })

  it('throws RIDE_NOT_FOUND when the ride does not exist', async () => {
    vi.mocked(ridesRepo.getRideById).mockResolvedValue(null)
    await expect(
      service.triggerCall({ rideId: 1n, callerRole: 'user', callerId: 1n })
    ).rejects.toMatchObject({ appCode: 'RIDE_NOT_FOUND' })
  })

  it('throws AUTH_FORBIDDEN when the caller is not this ride\'s rider or driver', async () => {
    await expect(
      service.triggerCall({ rideId: 1n, callerRole: 'user', callerId: 999n })
    ).rejects.toMatchObject({ appCode: 'AUTH_FORBIDDEN' })
    await expect(
      service.triggerCall({ rideId: 1n, callerRole: 'driver', callerId: 999n })
    ).rejects.toMatchObject({ appCode: 'AUTH_FORBIDDEN' })
  })

  it('throws MASKING_DISABLED when the kill switch is off', async () => {
    mockConfig({ call_masking_enabled: 'false' })
    await expect(
      service.triggerCall({ rideId: 1n, callerRole: 'user', callerId: 1n })
    ).rejects.toMatchObject({ code: 'MASKING_DISABLED' })
  })

  it('throws CALL_NOT_AVAILABLE when the ride is not in an active status', async () => {
    vi.mocked(ridesRepo.getRideById).mockResolvedValue(rideFor({ status: 'completed' }))
    await expect(
      service.triggerCall({ rideId: 1n, callerRole: 'user', callerId: 1n })
    ).rejects.toMatchObject({ code: 'CALL_NOT_AVAILABLE' })
  })

  it('throws CALL_LIMIT_REACHED once the per-ride call cap is exceeded', async () => {
    mockConfig({ call_masking_enabled: 'true', call_masking_max_calls_per_ride: '5' })
    vi.mocked(redis.incr).mockResolvedValue(6)
    await expect(
      service.triggerCall({ rideId: 1n, callerRole: 'user', callerId: 1n })
    ).rejects.toMatchObject({ code: 'CALL_LIMIT_REACHED' })
  })

  it('dials with the rider as agent_number and driver as receiver_number when the rider taps call', async () => {
    vi.mocked(ivr.makeCall).mockResolvedValue(undefined)

    await service.triggerCall({ rideId: 1n, callerRole: 'user', callerId: 1n })

    expect(ivr.makeCall).toHaveBeenCalledWith({
      receiverNumber: '+919000000001', // driver
      agentNumber: '+919000000002', // rider (falls back to user_phone since rider_phone is null)
      dial: 'Customer',
    })
  })

  it('dials with the driver as agent_number and rider as receiver_number when the driver taps call', async () => {
    vi.mocked(ivr.makeCall).mockResolvedValue(undefined)

    await service.triggerCall({ rideId: 1n, callerRole: 'driver', callerId: 9n })

    expect(ivr.makeCall).toHaveBeenCalledWith({
      receiverNumber: '+919000000002',
      agentNumber: '+919000000001',
      dial: 'Agent',
    })
  })

  it('throws CALL_FAILED when the vendor call fails', async () => {
    vi.mocked(ivr.makeCall).mockRejectedValue(new Error('vendor down'))
    await expect(
      service.triggerCall({ rideId: 1n, callerRole: 'user', callerId: 1n })
    ).rejects.toMatchObject({ code: 'CALL_FAILED' })
  })

  it('gives the attempt back when the vendor call fails', async () => {
    vi.mocked(ivr.makeCall).mockRejectedValue(new Error('vendor down'))
    await expect(
      service.triggerCall({ rideId: 1n, callerRole: 'user', callerId: 1n })
    ).rejects.toMatchObject({ code: 'CALL_FAILED' })
    expect(redis.decr).toHaveBeenCalledWith('callcount:ride:1')
  })

  it('falls back to the default cap when the configured cap is non-numeric', async () => {
    mockConfig({ call_masking_enabled: 'true', call_masking_max_calls_per_ride: 'abc' })
    vi.mocked(redis.incr).mockResolvedValue(11)
    await expect(
      service.triggerCall({ rideId: 1n, callerRole: 'user', callerId: 1n })
    ).rejects.toMatchObject({ code: 'CALL_LIMIT_REACHED' })
  })
})

describe('call-masking service — checkCreditBalance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockConfig({ call_masking_credit_floor: '500' })
  })

  it('flips the kill switch and notifies admins on the first tick that crosses the floor', async () => {
    vi.mocked(ivr.checkCredit).mockResolvedValue(100)
    vi.mocked(pool.query).mockResolvedValue({ rowCount: 1 } as never)

    await service.checkCreditBalance()

    expect(pool.query).toHaveBeenCalledTimes(1)
    expect(notifyAllAdmins).toHaveBeenCalledTimes(1)
  })

  it('does not re-notify on a later tick once the switch is already off', async () => {
    vi.mocked(ivr.checkCredit).mockResolvedValue(100)
    vi.mocked(pool.query).mockResolvedValue({ rowCount: 0 } as never)

    await service.checkCreditBalance()

    expect(pool.query).toHaveBeenCalledTimes(1)
    expect(notifyAllAdmins).not.toHaveBeenCalled()
  })

  it('does nothing when credit is above the floor', async () => {
    vi.mocked(ivr.checkCredit).mockResolvedValue(1000)

    await service.checkCreditBalance()

    expect(pool.query).not.toHaveBeenCalled()
    expect(notifyAllAdmins).not.toHaveBeenCalled()
  })

  it('does nothing when the credit check itself fails', async () => {
    vi.mocked(ivr.checkCredit).mockRejectedValue(new Error('network error'))

    await service.checkCreditBalance()

    expect(pool.query).not.toHaveBeenCalled()
    expect(notifyAllAdmins).not.toHaveBeenCalled()
  })
})
