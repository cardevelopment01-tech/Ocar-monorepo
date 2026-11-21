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
  queues: { notifications: { add: vi.fn().mockResolvedValue(undefined) }, scheduler: { add: vi.fn().mockResolvedValue(undefined) } },
  QUEUE_NAMES: { NOTIFICATIONS: 'notifications', SCHEDULER: 'scheduler' },
  gpsFlushQueue: { add: vi.fn().mockResolvedValue(undefined) },
}))
vi.mock('@/modules/rides/rides.repository', () => ({
  getRideCoreForDriverAction: vi.fn(),
  updateRideStatus:       vi.fn().mockResolvedValue(undefined),
  updateRideStatusCAS: vi.fn().mockResolvedValue({ id: 1n }),
  reissueStartOtpHash:    vi.fn().mockResolvedValue(true),
  logStatusHistory:       vi.fn().mockResolvedValue(undefined),
  getPickupWaitTerms:     vi.fn(),
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
import { markArrived } from '@/modules/rides/rides.service'
import { queues } from '@/jobs/queues'

const add = () => vi.mocked((queues as unknown as { scheduler: { add: ReturnType<typeof vi.fn> } }).scheduler.add)

describe('markArrived: the push for the end of the free waiting minutes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(repo.getRideCoreForDriverAction).mockResolvedValue({ id: BigInt(101), driver_id: 9, user_id: 42 } as never)
    vi.mocked(repo.updateRideStatusCAS).mockResolvedValue({ id: 1n } as never)
    vi.mocked(repo.getPickupWaitTerms).mockResolvedValue({ freeMin: 3, perMin: 3 })
  })

  it('schedules one check for when the free minutes would end, with a fixed id', async () => {
    await markArrived(BigInt(9), BigInt(101))
    expect(add()).toHaveBeenCalledTimes(1)
    expect(add()).toHaveBeenCalledWith('pickup_wait_nudge', { rideId: '101', attempt: 0 },
      expect.objectContaining({ delay: 180_000, jobId: 'pickup-wait-101-0' }))
  })

  it('uses the free minutes the ride was booked with', async () => {
    vi.mocked(repo.getPickupWaitTerms).mockResolvedValue({ freeMin: 8, perMin: 2 })
    await markArrived(BigInt(9), BigInt(101))
    expect(add()).toHaveBeenCalledWith('pickup_wait_nudge', expect.anything(), expect.objectContaining({ delay: 480_000 }))
  })

  it.each([
    ['booked before waiting charges', null],
    ['no free minutes', { freeMin: 0, perMin: 3 }],
    ['waiting free after the window', { freeMin: 3, perMin: 0 }],
  ])('schedules nothing for a ride with %s', async (_n, terms) => {
    vi.mocked(repo.getPickupWaitTerms).mockResolvedValue(terms as never)
    await markArrived(BigInt(9), BigInt(101))
    expect(add()).not.toHaveBeenCalled()
  })

  it('a retry that lost the status race schedules nothing (the first tap already did)', async () => {
    vi.mocked(repo.updateRideStatusCAS).mockResolvedValue(null as never)
    vi.mocked(repo.getRideCoreForDriverAction).mockResolvedValue({ id: BigInt(101), driver_id: 9, user_id: 42, status: 'driver_arrived' } as never)
    await markArrived(BigInt(9), BigInt(101))
    expect(add()).not.toHaveBeenCalled()
  })

  it('a failure while scheduling never stops the arrival', async () => {
    add().mockRejectedValueOnce(new Error('redis down'))
    await expect(markArrived(BigInt(9), BigInt(101))).resolves.toEqual({ success: true })
  })
})
