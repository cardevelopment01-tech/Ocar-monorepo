import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db/client', () => ({ pool: { query: vi.fn() } }))
vi.mock('@/db/redis', () => ({ client: { set: vi.fn(), del: vi.fn() } }))
vi.mock('@/lib/otp', () => ({
  generateOtp: vi.fn(() => '5678'),
  deriveRideEndOtp: vi.fn(() => '5678'),
  hashOtp: vi.fn(() => 'HASH'),
  checkRideOtpAttempts: vi.fn().mockResolvedValue(1),
  clearRideOtpAttempts: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/websocket/socket.server', () => ({
  socketEvents: { sendRideStatusUpdate: vi.fn(), sendUserUpdate: vi.fn() },
  getIO: vi.fn(() => ({ to: vi.fn(() => ({ emit: vi.fn() })) })),
}))
vi.mock('@/jobs/queues', () => ({
  queues: { scheduler: { add: vi.fn().mockResolvedValue(undefined) }, notifications: { add: vi.fn() } },
  QUEUE_NAMES: { SCHEDULER: 'scheduler', NOTIFICATIONS: 'notifications' },
  gpsFlushQueue: { add: vi.fn() },
}))
vi.mock('@/lib/gps-buffer', () => ({ enqueueBreadcrumb: vi.fn(), flushBreadcrumbs: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/modules/rides/rides.repository', () => ({
  getRideCoreForDriverAction: vi.fn(),
  updateRideStatus: vi.fn().mockResolvedValue(undefined),
  updateRideStatusCAS: vi.fn().mockResolvedValue({ id: 1n }),
  logStatusHistory: vi.fn().mockResolvedValue(undefined),
  getTripWindowInputs: vi.fn().mockResolvedValue({ ride_type: 'one_way' }),
  getPickupWaitTerms: vi.fn(),
  getPickupWaitMinutes: vi.fn(),
  recordPickupWait: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/modules/payments/payments.service', () => ({
  createPaymentRecord: vi.fn(), deductCommission: vi.fn(), creditCashback: vi.fn(),
  confirmRidePayment: vi.fn(), payFromUserWallet: vi.fn(), createRidePaymentOrder: vi.fn(),
}))
vi.mock('@/lib/system-config', () => ({ getConfigValue: vi.fn().mockResolvedValue('1') }))
vi.mock('@/modules/notifications/notifications.service', () => ({
  notifyRideEvent: vi.fn(), notifyRidePaymentFailed: vi.fn(), notifyAllAdmins: vi.fn(), notifyOwner: vi.fn(),
}))

import * as repo from '@/modules/rides/rides.repository'
import { pool } from '@/db/client'
import { verifyStartOTP } from '@/modules/rides/rides.service'
import { pickupWaitCharge } from '@/lib/fare'
import { PICKUP_WAIT_RADIUS_METRES } from '@/constants/limits'

const ARRIVED = '2026-10-01T05:50:00.000Z'

describe('pickupWaitCharge', () => {
  it('charges only the minutes past the free window, in whole rupees', () => {
    expect(pickupWaitCharge(2, 3, 3)).toBe(0)
    expect(pickupWaitCharge(3, 3, 3)).toBe(0)
    expect(pickupWaitCharge(11, 3, 3)).toBe(24) // the client sheet charged every minute (33); the rule is minutes after the free ones
    expect(pickupWaitCharge(5, 8, 2)).toBe(0) // a rental package with 8 free minutes
    expect(pickupWaitCharge(12, 8, 2)).toBe(8)
  })

  it('never goes negative and is zero when waiting is free after the window', () => {
    expect(pickupWaitCharge(0, 3, 3)).toBe(0)
    expect(pickupWaitCharge(30, 3, 0)).toBe(0)
  })
})

describe('verifyStartOTP records the wait at the pickup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(pool.query).mockResolvedValue({ rows: [], rowCount: 1 } as never)
    vi.mocked(repo.getTripWindowInputs).mockResolvedValue({ ride_type: 'one_way' } as never)
    vi.mocked(repo.getRideCoreForDriverAction).mockResolvedValue({
      id: BigInt(303), driver_id: 9, user_id: 42, status: 'driver_arrived', driver_arrived_at: ARRIVED,
      start_otp_hash: 'HASH', origin_lat: 20.3, origin_lng: 85.8, dest_lat: null, dest_lng: null,
    } as never)
    vi.mocked(repo.getPickupWaitTerms).mockResolvedValue({ freeMin: 3, perMin: 3 })
  })

  it('stores the minutes and the charge for the minutes after the free ones', async () => {
    vi.mocked(repo.getPickupWaitMinutes).mockResolvedValue(11)
    await verifyStartOTP(BigInt(9), BigInt(303), '1234')
    expect(repo.recordPickupWait).toHaveBeenCalledWith(303n, 11, 24)
  })

  it('stores the wait with no charge inside the free window', async () => {
    vi.mocked(repo.getPickupWaitMinutes).mockResolvedValue(2.5)
    await verifyStartOTP(BigInt(9), BigInt(303), '1234')
    expect(repo.recordPickupWait).toHaveBeenCalledWith(303n, 2.5, 0)
  })

  it('measures from the arrival at the pickup within the allowed distance', async () => {
    vi.mocked(repo.getPickupWaitMinutes).mockResolvedValue(4)
    await verifyStartOTP(BigInt(9), BigInt(303), '1234')
    expect(repo.getPickupWaitMinutes).toHaveBeenCalledWith(303n, new Date(ARRIVED), 20.3, 85.8, PICKUP_WAIT_RADIUS_METRES)
  })

  it('charges nothing when no position was ever recorded at the pickup (an "arrived" tap from far away)', async () => {
    vi.mocked(repo.getPickupWaitMinutes).mockResolvedValue(null)
    await verifyStartOTP(BigInt(9), BigInt(303), '1234')
    expect(repo.recordPickupWait).not.toHaveBeenCalled()
  })

  it('charges nothing for a ride booked before waiting charges existed', async () => {
    vi.mocked(repo.getPickupWaitTerms).mockResolvedValue(null)
    await verifyStartOTP(BigInt(9), BigInt(303), '1234')
    expect(repo.getPickupWaitMinutes).not.toHaveBeenCalled()
    expect(repo.recordPickupWait).not.toHaveBeenCalled()
  })

  it('a failure while measuring never stops the trip from starting', async () => {
    vi.mocked(repo.getPickupWaitMinutes).mockRejectedValue(new Error('db down'))
    await expect(verifyStartOTP(BigInt(9), BigInt(303), '1234')).resolves.toEqual({ success: true })
  })
})
