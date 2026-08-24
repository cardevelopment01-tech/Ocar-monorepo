import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db/client', () => ({ pool: { query: vi.fn() } }))
vi.mock('@/db/redis', () => ({ client: { set: vi.fn(), del: vi.fn() } }))
vi.mock('@/lib/otp', () => ({
  generateOtp: vi.fn(() => '5678'),
  hashOtp: vi.fn((v: string) => (v === '1234' ? 'HASH' : 'WRONG')),
  checkRideOtpAttempts: vi.fn().mockResolvedValue(1),
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
  getRideForDriverAction: vi.fn(),
  updateRideStatus:       vi.fn().mockResolvedValue(undefined),
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
import { pool } from '@/db/client'
import * as otpLib from '@/lib/otp'
import { verifyStartOTP } from '@/modules/rides/rides.service'

function baseRide(over: Record<string, unknown> = {}) {
  return {
    id: BigInt(303), driver_id: 9, user_id: 42, status: 'driver_arrived',
    start_otp_hash: 'HASH', origin_lat: 20.3, origin_lng: 85.8,
    dest_lat: null, dest_lng: null,
    ...over,
  }
}

describe('verifyStartOTP — ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(pool.query).mockResolvedValue({ rows: [], rowCount: 1 } as never)
  })

  it('throws 404 when the owner-scoped fetch returns null (not this driver)', async () => {
    vi.mocked(repo.getRideForDriverAction).mockResolvedValue(null)
    await expect(verifyStartOTP(BigInt(9), BigInt(303), '1234')).rejects.toMatchObject({ httpStatus: 404 })
    expect(repo.updateRideStatus).not.toHaveBeenCalled()
  })

  it('throws 403 (defense-in-depth) if a mismatched-driver row is returned', async () => {
    vi.mocked(repo.getRideForDriverAction).mockResolvedValue(baseRide({ driver_id: 999 }) as never)
    await expect(verifyStartOTP(BigInt(9), BigInt(303), '1234')).rejects.toMatchObject({ httpStatus: 403 })
  })

  it('completes for the owning driver with a valid OTP', async () => {
    vi.mocked(repo.getRideForDriverAction).mockResolvedValue(baseRide() as never)
    const res = await verifyStartOTP(BigInt(9), BigInt(303), '1234')
    expect(res).toEqual({ success: true })
    expect(repo.updateRideStatus).toHaveBeenCalledWith(BigInt(303), 'in_progress', expect.anything())
  })

  it('locks out with 429 when the attempt limiter throws (over the cap)', async () => {
    vi.mocked(repo.getRideForDriverAction).mockResolvedValue(baseRide() as never)
    vi.mocked(otpLib.checkRideOtpAttempts).mockRejectedValueOnce(
      Object.assign(new Error('Too many incorrect attempts. Try again later.'), {
        httpStatus: 429, appCode: 'RIDE_OTP_LOCKED',
      })
    )
    await expect(verifyStartOTP(BigInt(9), BigInt(303), '1234')).rejects.toMatchObject({ httpStatus: 429 })
    // hash comparison / status flip must not happen once locked out
    expect(repo.updateRideStatus).not.toHaveBeenCalled()
  })

  it('records the real attempt_number (from the limiter) in ride_otp_events, not a hardcoded 1', async () => {
    vi.mocked(repo.getRideForDriverAction).mockResolvedValue(baseRide() as never)
    vi.mocked(otpLib.checkRideOtpAttempts).mockResolvedValueOnce(3)
    await verifyStartOTP(BigInt(9), BigInt(303), '1234')

    const insert = vi.mocked(pool.query).mock.calls.find(
      c => /INSERT INTO ride_otp_events/.test(c[0] as string)
    )
    expect(insert).toBeTruthy()
    expect(insert![1]).toEqual([BigInt(303), 'verified', 3])
    expect(otpLib.clearRideOtpAttempts).toHaveBeenCalledWith(BigInt(303), 'start')
  })
})
