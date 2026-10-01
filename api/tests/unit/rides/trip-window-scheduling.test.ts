import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/db/client', () => ({ pool: { query: vi.fn() } }))
vi.mock('@/db/redis', () => ({ client: { set: vi.fn(), del: vi.fn() } }))
vi.mock('@/lib/otp', () => ({
  generateOtp: vi.fn(() => '5678'),
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
vi.mock('@/modules/rides/rides.repository', () => ({
  getRideCoreForDriverAction: vi.fn(),
  updateRideStatus:   vi.fn().mockResolvedValue(undefined),
  logStatusHistory:   vi.fn().mockResolvedValue(undefined),
  getTripWindowInputs: vi.fn(),
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
import { queues } from '@/jobs/queues'
import { verifyStartOTP } from '@/modules/rides/rides.service'

const NOW = new Date('2026-10-01T06:00:00Z')
const add = () => vi.mocked((queues as unknown as { scheduler: { add: ReturnType<typeof vi.fn> } }).scheduler.add)

const window6h = {
  ride_type: 'round_trip', status: 'in_progress', started_at: NOW.toISOString(), trip_hours: 6,
  pricing_version: 2, round_trip_hour_rate: 60,
}

describe('verifyStartOTP: booked-window nudges', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    vi.mocked(pool.query).mockResolvedValue({ rows: [], rowCount: 1 } as never)
    vi.mocked(repo.getRideCoreForDriverAction).mockResolvedValue({
      id: BigInt(303), driver_id: 9, user_id: 42, status: 'driver_arrived',
      start_otp_hash: 'HASH', origin_lat: 20.3, origin_lng: 85.8, dest_lat: null, dest_lng: null,
    } as never)
  })
  afterEach(() => vi.useRealTimers())

  it('schedules a T-15 and an end job with fixed ids and the right delays', async () => {
    vi.mocked(repo.getTripWindowInputs).mockResolvedValue(window6h as never)
    await verifyStartOTP(BigInt(9), BigInt(303), '1234')
    const six = 6 * 3_600_000
    expect(add()).toHaveBeenCalledTimes(2)
    expect(add()).toHaveBeenCalledWith('trip_window_nudge', { rideId: '303', kind: 't15' },
      expect.objectContaining({ delay: six - 15 * 60_000, jobId: 'trip-window-303-t15' }))
    expect(add()).toHaveBeenCalledWith('trip_window_nudge', { rideId: '303', kind: 'end' },
      expect.objectContaining({ delay: six, jobId: 'trip-window-303-end' }))
  })

  it.each([
    ['a one-way ride', { ride_type: 'one_way' }],
    ['a legacy (version 1) round trip', { pricing_version: 1 }],
    ['a booking over 24h', { trip_hours: 30 }],
  ])('schedules nothing for %s', async (_n, over) => {
    vi.mocked(repo.getTripWindowInputs).mockResolvedValue({ ...window6h, ...over } as never)
    await verifyStartOTP(BigInt(9), BigInt(303), '1234')
    expect(add()).not.toHaveBeenCalled()
  })

  it('a queue failure never fails starting the trip', async () => {
    vi.mocked(repo.getTripWindowInputs).mockResolvedValue(window6h as never)
    add().mockRejectedValueOnce(new Error('redis down'))
    await expect(verifyStartOTP(BigInt(9), BigInt(303), '1234')).resolves.toEqual({ success: true })
  })
})
