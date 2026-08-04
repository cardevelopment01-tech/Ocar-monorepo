import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db/client', () => ({ pool: { query: vi.fn() } }))
vi.mock('@/db/redis', () => ({ client: { del: vi.fn() } }))
vi.mock('@/websocket/socket.server', () => ({
  socketEvents: { sendRideStatusUpdate: vi.fn() },
  getIO: vi.fn(() => ({ to: vi.fn(() => ({ emit: vi.fn() })) })),
}))
vi.mock('@/jobs/queues', () => ({
  queues: { notifications: { add: vi.fn().mockResolvedValue(undefined) } },
  QUEUE_NAMES: { NOTIFICATIONS: 'notifications' },
  gpsFlushQueue: { add: vi.fn().mockResolvedValue(undefined) },
}))
vi.mock('@/modules/rides/rides.repository', () => ({
  getRideById:      vi.fn(),
  getRideStops:     vi.fn(),
  getStopWaitTotal: vi.fn().mockResolvedValue(0),
  updateRideStatus: vi.fn().mockResolvedValue(undefined),
  logStatusHistory: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/modules/payments/payments.service', () => ({
  createPaymentRecord:    vi.fn().mockResolvedValue(undefined),
  deductCommission:       vi.fn().mockResolvedValue(undefined),
  creditCashback:         vi.fn().mockResolvedValue(undefined),
  confirmRidePayment:     vi.fn().mockResolvedValue(true),
  payFromUserWallet:      vi.fn().mockResolvedValue(true),
  createRidePaymentOrder: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/lib/system-config', () => ({ getConfigValue: vi.fn().mockResolvedValue('true') }))
vi.mock('@/modules/notifications/notifications.service', () => ({
  notifyRidePaymentFailed: vi.fn().mockResolvedValue(undefined),
  notifyAllAdmins:         vi.fn().mockResolvedValue(undefined),
  notifyOwner:             vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/otp', () => ({ generateOtp: vi.fn(() => '1234'), hashOtp: vi.fn(() => 'HASH') }))

import * as repo from '@/modules/rides/rides.repository'
import { verifyEndOTP } from '@/modules/rides/rides.service'

function baseRide(over: Record<string, unknown> = {}) {
  return {
    id: BigInt(303), status: 'in_progress', end_otp_hash: 'HASH',
    ride_type: 'one_way', user_id: 42, user_phone: null,
    origin_lat: 20.2961, origin_lng: 85.8245,
    ...over,
  }
}

describe('verifyEndOTP — pending stops guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(repo.getStopWaitTotal).mockResolvedValue(0)
  })

  it('rejects with 409 when a stop is still pending', async () => {
    vi.mocked(repo.getRideById).mockResolvedValue(baseRide() as never)
    vi.mocked(repo.getRideStops).mockResolvedValue([
      { id: BigInt(1), sequence: 1, status: 'reached' },
      { id: BigInt(2), sequence: 2, status: 'pending' },
    ] as never)

    await expect(verifyEndOTP(BigInt(9), BigInt(303), '1234'))
      .rejects.toMatchObject({ httpStatus: 409 })
    expect(repo.updateRideStatus).not.toHaveBeenCalled()
  })

  it('allows completion when every stop is reached or skipped', async () => {
    vi.mocked(repo.getRideById).mockResolvedValue(baseRide() as never)
    vi.mocked(repo.getRideStops).mockResolvedValue([
      { id: BigInt(1), sequence: 1, status: 'reached' },
      { id: BigInt(2), sequence: 2, status: 'skipped' },
    ] as never)

    const result = await verifyEndOTP(BigInt(9), BigInt(303), '1234')
    expect(result.success).toBe(true)
    expect(repo.updateRideStatus).toHaveBeenCalledWith(BigInt(303), 'completed', expect.anything())
  })

  it('allows completion when the ride has no stops at all', async () => {
    vi.mocked(repo.getRideById).mockResolvedValue(baseRide() as never)
    vi.mocked(repo.getRideStops).mockResolvedValue([] as never)

    const result = await verifyEndOTP(BigInt(9), BigInt(303), '1234')
    expect(result.success).toBe(true)
  })
})
