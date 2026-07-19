import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db/client', () => ({ pool: { query: vi.fn() } }))
vi.mock('@/db/redis', () => ({ client: { del: vi.fn() } }))
vi.mock('@/lib/otp', () => ({ generateOtp: vi.fn(() => '1234'), hashOtp: vi.fn(() => 'h') }))
vi.mock('@/websocket/socket.server', () => ({
  socketEvents: { sendRideStatusUpdate: vi.fn(), broadcastNewRide: vi.fn(), notifyUserRideUpdate: vi.fn() },
  getIO: vi.fn(() => ({ to: vi.fn(() => ({ emit: vi.fn() })) })),
}))
vi.mock('@/jobs/queues', () => ({
  queues: { notifications: { add: vi.fn().mockResolvedValue(undefined) } },
  QUEUE_NAMES: { NOTIFICATIONS: 'notifications' },
  gpsFlushQueue: { add: vi.fn().mockResolvedValue(undefined) },
}))
vi.mock('@/modules/rides/rides.repository', () => ({ getRideById: vi.fn() }))
vi.mock('@/modules/payments/payments.service', () => ({
  createPaymentRecord: vi.fn(),
  createRidePaymentOrder: vi.fn(),
  payFromUserWallet: vi.fn(),
  confirmRidePayment: vi.fn(),
  deductCommission: vi.fn(),
  creditCashback: vi.fn(),
}))
vi.mock('@/modules/notifications/notifications.service', () => ({ notifyRidePaymentFailed: vi.fn() }))

import { settleRideCompletionPayment } from '@/modules/rides/rides.service'
import * as repo from '@/modules/rides/rides.repository'
import * as payments from '@/modules/payments/payments.service'
import { notifyRidePaymentFailed } from '@/modules/notifications/notifications.service'
import { pool } from '@/db/client'

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(pool.query).mockResolvedValue({ rows: [{ amount: '500' }], rowCount: 1 } as never)
})

describe('settleRideCompletionPayment (wallet channel)', () => {
  it('insufficient wallet balance → notifies the rider', async () => {
    vi.mocked(repo.getRideById).mockResolvedValue({ user_id: 42n, payment_channel: 'wallet' } as never)
    vi.mocked(payments.payFromUserWallet).mockResolvedValue(false as never)

    await settleRideCompletionPayment(101n, 9n)

    expect(payments.confirmRidePayment).not.toHaveBeenCalled()
    expect(notifyRidePaymentFailed).toHaveBeenCalledWith(42n, 101n, 500)
  })

  it('sufficient wallet balance → confirms, does not notify', async () => {
    vi.mocked(repo.getRideById).mockResolvedValue({ user_id: 42n, payment_channel: 'wallet' } as never)
    vi.mocked(payments.payFromUserWallet).mockResolvedValue(true as never)

    await settleRideCompletionPayment(101n, 9n)

    expect(payments.confirmRidePayment).toHaveBeenCalledWith(101n)
    expect(notifyRidePaymentFailed).not.toHaveBeenCalled()
  })
})
