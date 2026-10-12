import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db/client', () => ({ pool: { query: vi.fn() } }))
vi.mock('@/db/redis', () => ({ client: { set: vi.fn(), del: vi.fn() } }))
vi.mock('@/lib/otp', () => ({ generateOtp: vi.fn(() => '1234'), hashOtp: vi.fn(() => 'HASH') }))
vi.mock('@/websocket/socket.server', () => ({
  socketEvents: { sendRideStatusUpdate: vi.fn(), sendUserUpdate: vi.fn() },
  getIO: vi.fn(() => ({ to: vi.fn(() => ({ emit: vi.fn() })) })),
}))
vi.mock('@/jobs/queues', () => ({
  queues: { notifications: { add: vi.fn().mockResolvedValue(undefined) } },
  QUEUE_NAMES: { NOTIFICATIONS: 'notifications' },
  gpsFlushQueue: { add: vi.fn().mockResolvedValue(undefined) },
}))
vi.mock('@/modules/rides/rides.repository', () => ({
  getRideCoreForDriverAction: vi.fn(),
  updateRideStatus:       vi.fn().mockResolvedValue(undefined),
  updateRideStatusCAS: vi.fn().mockResolvedValue({ id: 1n }),
  reissueStartOtpHash:    vi.fn().mockResolvedValue(true),
  logStatusHistory:       vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/modules/payments/payments.service', () => ({
  createPaymentRecord: vi.fn(), deductCommission: vi.fn(), creditCashback: vi.fn(),
  confirmRidePayment: vi.fn(), payFromUserWallet: vi.fn(), createRidePaymentOrder: vi.fn(),
}))
vi.mock('@/lib/system-config', () => ({ getConfigValue: vi.fn().mockResolvedValue('1') }))
vi.mock('@/modules/notifications/notifications.service', () => ({
  notifyRidePaymentFailed: vi.fn(), notifyAllAdmins: vi.fn(), notifyOwner: vi.fn(),
}))

import * as repo from '@/modules/rides/rides.repository'
import { markArrived } from '@/modules/rides/rides.service'
import { client as redis } from '@/db/redis'
import { socketEvents } from '@/websocket/socket.server'

describe('markArrived — ownership', () => {
  beforeEach(() => vi.clearAllMocks())

  it('throws 404 when the ride is not assigned to this driver (owner-scoped fetch returns null)', async () => {
    vi.mocked(repo.getRideCoreForDriverAction).mockResolvedValue(null)
    await expect(markArrived(BigInt(9), BigInt(101))).rejects.toMatchObject({ httpStatus: 404 })
    expect(repo.updateRideStatusCAS).not.toHaveBeenCalled()
  })

  it('throws 403 (defense-in-depth guard) if a mismatched-driver row is somehow returned', async () => {
    vi.mocked(repo.getRideCoreForDriverAction).mockResolvedValue({ id: BigInt(101), driver_id: 999, user_id: 42 } as never)
    await expect(markArrived(BigInt(9), BigInt(101))).rejects.toMatchObject({ httpStatus: 403 })
    expect(repo.updateRideStatusCAS).not.toHaveBeenCalled()
  })

  it('proceeds for the owning driver', async () => {
    vi.mocked(repo.getRideCoreForDriverAction).mockResolvedValue({ id: BigInt(101), driver_id: 9, user_id: 42 } as never)
    const res = await markArrived(BigInt(9), BigInt(101))
    expect(res).toEqual({ success: true })
    expect(repo.updateRideStatusCAS).toHaveBeenCalledWith(BigInt(101), 'accepted', 'driver_arrived', expect.anything())
  })

  it('RETRY after a half-finished arrive: ride already driver_arrived -> re-issues a fresh PIN instead of 409', async () => {
    // First attempt flipped the status but the PIN never reached Redis/the rider. The retry loses the CAS...
    vi.mocked(repo.getRideCoreForDriverAction)
      .mockResolvedValueOnce({ id: BigInt(101), driver_id: 9, user_id: 42, status: 'accepted' } as never)      // initial read
      .mockResolvedValueOnce({ id: BigInt(101), driver_id: 9, user_id: 42, status: 'driver_arrived' } as never) // re-read after losing the CAS
    vi.mocked(repo.updateRideStatusCAS).mockResolvedValueOnce(null as never)

    const res = await markArrived(BigInt(9), BigInt(101))

    expect(res).toEqual({ success: true })
    expect(repo.reissueStartOtpHash).toHaveBeenCalledWith(BigInt(101), 'HASH')
    expect(redis.set).toHaveBeenCalledWith(expect.stringContaining('101'), '1234', 'EX', 7200)
    expect(socketEvents.sendUserUpdate).toHaveBeenCalledWith('42', { status: 'driver_arrived', startOtp: '1234' })
    expect(repo.logStatusHistory).not.toHaveBeenCalled() // it is not a second transition
  })

  it('a retry does NOT re-issue for a ride that has moved on (in_progress/completed/cancelled) - still 409, no PIN written', async () => {
    vi.mocked(repo.getRideCoreForDriverAction)
      .mockResolvedValueOnce({ id: BigInt(101), driver_id: 9, user_id: 42, status: 'accepted' } as never)
      .mockResolvedValueOnce({ id: BigInt(101), driver_id: 9, user_id: 42, status: 'in_progress' } as never)
    vi.mocked(repo.updateRideStatusCAS).mockResolvedValueOnce(null as never)

    await expect(markArrived(BigInt(9), BigInt(101))).rejects.toMatchObject({ httpStatus: 409 })
    expect(repo.reissueStartOtpHash).not.toHaveBeenCalled()
    expect(redis.set).not.toHaveBeenCalled()
  })

  it('throws 409 and sends nothing when the ride is no longer accepted (completed/cancelled/started)', async () => {
    vi.mocked(repo.getRideCoreForDriverAction).mockResolvedValue({ id: BigInt(101), driver_id: 9, user_id: 42 } as never)
    vi.mocked(repo.updateRideStatusCAS).mockResolvedValueOnce(null as never)
    await expect(markArrived(BigInt(9), BigInt(101))).rejects.toMatchObject({ httpStatus: 409, appCode: 'RIDE_NOT_ACCEPTED' })
    expect(repo.logStatusHistory).not.toHaveBeenCalled()
  })
})
