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
  getPickupWaitStartedAt: vi.fn(),
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
import { withPickupWait } from '@/modules/rides/rides.service'
import { PICKUP_WAIT_RADIUS_METRES } from '@/constants/limits'

const ARRIVED = '2026-10-01T05:50:00.000Z'
const ride = (over: Record<string, unknown> = {}) => ({
  id: 303n, status: 'driver_arrived', driver_arrived_at: ARRIVED, origin_lat: 20.3, origin_lng: 85.8, pickup_free_wait_min: 3, ...over,
})

describe('withPickupWait: when the wait clock started, for the apps', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('adds the clock start while the driver is at the pickup', async () => {
    vi.mocked(repo.getPickupWaitStartedAt).mockResolvedValue('2026-10-01T05:51:10.000Z')
    const out = await withPickupWait(ride())
    expect(out.pickup_wait_started_at).toBe('2026-10-01T05:51:10.000Z')
    expect(repo.getPickupWaitStartedAt).toHaveBeenCalledWith(303n, new Date(ARRIVED), 20.3, 85.8, PICKUP_WAIT_RADIUS_METRES)
  })

  it('says the clock has not started (null) when no position was recorded at the pickup', async () => {
    vi.mocked(repo.getPickupWaitStartedAt).mockResolvedValue(null)
    expect((await withPickupWait(ride())).pickup_wait_started_at).toBeNull()
  })

  it.each([
    ['the driver has not arrived', { status: 'accepted' }],
    ['the trip has started', { status: 'in_progress' }],
    ['the ride was booked before waiting charges existed', { pickup_free_wait_min: null }],
    ['there is no arrival time', { driver_arrived_at: null }],
  ])('adds nothing and queries nothing when %s', async (_n, over) => {
    const r = ride(over)
    expect(await withPickupWait(r)).toBe(r)
    expect(repo.getPickupWaitStartedAt).not.toHaveBeenCalled()
  })

  it('never fails the ride fetch', async () => {
    vi.mocked(repo.getPickupWaitStartedAt).mockRejectedValue(new Error('db down'))
    const r = ride()
    expect(await withPickupWait(r)).toBe(r)
  })
})
