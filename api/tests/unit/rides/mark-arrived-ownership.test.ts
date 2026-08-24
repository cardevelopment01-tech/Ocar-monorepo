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
import { markArrived } from '@/modules/rides/rides.service'

describe('markArrived — ownership', () => {
  beforeEach(() => vi.clearAllMocks())

  it('throws 404 when the ride is not assigned to this driver (owner-scoped fetch returns null)', async () => {
    vi.mocked(repo.getRideForDriverAction).mockResolvedValue(null)
    await expect(markArrived(BigInt(9), BigInt(101))).rejects.toMatchObject({ httpStatus: 404 })
    expect(repo.updateRideStatus).not.toHaveBeenCalled()
  })

  it('throws 403 (defense-in-depth guard) if a mismatched-driver row is somehow returned', async () => {
    vi.mocked(repo.getRideForDriverAction).mockResolvedValue({ id: BigInt(101), driver_id: 999, user_id: 42 } as never)
    await expect(markArrived(BigInt(9), BigInt(101))).rejects.toMatchObject({ httpStatus: 403 })
    expect(repo.updateRideStatus).not.toHaveBeenCalled()
  })

  it('proceeds for the owning driver', async () => {
    vi.mocked(repo.getRideForDriverAction).mockResolvedValue({ id: BigInt(101), driver_id: 9, user_id: 42 } as never)
    const res = await markArrived(BigInt(9), BigInt(101))
    expect(res).toEqual({ success: true })
    expect(repo.updateRideStatus).toHaveBeenCalledWith(BigInt(101), 'driver_arrived', expect.anything())
  })
})
