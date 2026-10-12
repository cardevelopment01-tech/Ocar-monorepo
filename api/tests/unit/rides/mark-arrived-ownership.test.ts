import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db/client', () => ({ pool: { query: vi.fn() } }))
vi.mock('@/db/redis', () => ({ client: { get: vi.fn(), set: vi.fn(), del: vi.fn() } }))
vi.mock('@/lib/otp', () => ({
  generateOtp: vi.fn(() => '1234'), hashOtp: vi.fn(() => 'HASH'),
  clearRideOtpAttempts: vi.fn().mockResolvedValue(undefined),
}))
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
import { clearRideOtpAttempts } from '@/lib/otp'
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

  function loseTheCasOnADriverArrivedRide() {
    vi.mocked(repo.getRideCoreForDriverAction)
      .mockResolvedValueOnce({ id: BigInt(101), driver_id: 9, user_id: 42, status: 'accepted' } as never)      // initial read
      .mockResolvedValueOnce({ id: BigInt(101), driver_id: 9, user_id: 42, status: 'driver_arrived' } as never) // re-read after losing the CAS
    vi.mocked(repo.updateRideStatusCAS).mockResolvedValueOnce(null as never)
  }

  it('RETRY (double tap) while the PIN is still in Redis: RE-SENDS that same PIN, does not invalidate the rider\'s', async () => {
    loseTheCasOnADriverArrivedRide()
    vi.mocked(redis.get).mockResolvedValueOnce('4321') // the PIN the rider is already looking at

    const res = await markArrived(BigInt(9), BigInt(101))

    expect(res).toEqual({ success: true })
    expect(repo.reissueStartOtpHash).not.toHaveBeenCalled() // the stored hash is untouched
    expect(clearRideOtpAttempts).not.toHaveBeenCalled()
    expect(socketEvents.sendUserUpdate).toHaveBeenCalledWith('42', { status: 'driver_arrived', startOtp: '4321' })
    expect(redis.set).toHaveBeenCalledWith(expect.stringContaining('101'), '4321', 'EX', 7200)
    expect(repo.logStatusHistory).not.toHaveBeenCalled() // it is not a second transition
  })

  it('RETRY after the PIN was lost (Redis key gone): mints a fresh PIN, replaces the hash and clears the attempt counter', async () => {
    loseTheCasOnADriverArrivedRide()
    vi.mocked(redis.get).mockResolvedValueOnce(null)

    const res = await markArrived(BigInt(9), BigInt(101))

    expect(res).toEqual({ success: true })
    expect(repo.reissueStartOtpHash).toHaveBeenCalledWith(BigInt(101), 'HASH')
    expect(clearRideOtpAttempts).toHaveBeenCalledWith(BigInt(101), 'start')
    expect(redis.set).toHaveBeenCalledWith(expect.stringContaining('101'), '1234', 'EX', 7200)
    expect(socketEvents.sendUserUpdate).toHaveBeenCalledWith('42', { status: 'driver_arrived', startOtp: '1234' })
  })

  it('RETRY while Redis is unreachable behaves like a missing PIN (re-issues) rather than failing the tap', async () => {
    loseTheCasOnADriverArrivedRide()
    vi.mocked(redis.get).mockRejectedValueOnce(new Error('redis down'))
    await expect(markArrived(BigInt(9), BigInt(101))).resolves.toEqual({ success: true })
    expect(repo.reissueStartOtpHash).toHaveBeenCalled()
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
