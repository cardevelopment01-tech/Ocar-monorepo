import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db/client', () => ({ pool: { query: vi.fn() } }))
vi.mock('@/db/redis', () => ({ client: { del: vi.fn() } }))
vi.mock('@/websocket/socket.server', () => ({
  socketEvents: { sendRideStatusUpdate: vi.fn() },
  getIO: vi.fn(() => ({ to: vi.fn(() => ({ emit: vi.fn() })) })),
}))
vi.mock('@/jobs/queues', () => ({
  queues: { notifications: { add: vi.fn() }, dispatch: { add: vi.fn() } },
  QUEUE_NAMES: { NOTIFICATIONS: 'notifications', DISPATCH: 'dispatch' },
  gpsFlushQueue: { add: vi.fn() },
}))
vi.mock('@/modules/rides/rides.repository', () => ({ getRideCoreById: vi.fn() }))
const createPaymentRecord = vi.fn().mockResolvedValue(undefined)
vi.mock('@/modules/payments/payments.service', () => ({
  createPaymentRecord: (...a: unknown[]) => createPaymentRecord(...a),
  deductCommission: vi.fn(), creditCashback: vi.fn(), confirmRidePayment: vi.fn(),
  payFromUserWallet: vi.fn(), createRidePaymentOrder: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/lib/system-config', () => ({ getConfigValue: vi.fn().mockResolvedValue('true') }))
vi.mock('@/modules/notifications/notifications.service', () => ({
  notifyRidePaymentFailed: vi.fn(), notifyAllAdmins: vi.fn(), notifyDriverLowWalletBalance: vi.fn(),
}))

import { pool } from '@/db/client'
import * as repo from '@/modules/rides/rides.repository'
import { settleStrandedRideCompletions } from '@/modules/rides/rides.service'

describe('settleStrandedRideCompletions', () => {
  beforeEach(() => vi.clearAllMocks())

  it('only looks at completed online/wallet rides with no payment row (cash is excluded on purpose)', async () => {
    vi.mocked(pool.query).mockResolvedValue({ rows: [], rowCount: 0 } as never)
    await settleStrandedRideCompletions()
    const sql = vi.mocked(pool.query).mock.calls[0]![0] as string
    expect(sql).toContain("r.status = 'completed'")
    expect(sql).toContain("r.payment_channel IN ('online', 'wallet')")
    expect(sql).toContain('NOT EXISTS (SELECT 1 FROM payments p WHERE p.ride_id = r.id)')
  })

  it('re-runs settlement for each stranded ride and keeps going when one fails', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({
      rows: [{ id: '11', driver_id: '9' }, { id: '12', driver_id: '9' }], rowCount: 2,
    } as never)
    vi.mocked(repo.getRideCoreById)
      .mockRejectedValueOnce(new Error('db blip')) // first ride blows up inside settlement
      .mockResolvedValueOnce({ id: 12n, payment_channel: 'wallet', user_id: 42, billing_mode_snapshot: null } as never)
    vi.mocked(pool.query).mockResolvedValue({ rows: [{ amount: '0' }], rowCount: 1 } as never) // fare lookups

    const settled = await settleStrandedRideCompletions()

    expect(settled).toBe(1) // ride 11 failed, ride 12 went through
    expect(createPaymentRecord).toHaveBeenCalledWith(12n, 'platform_wallet', { status: 'pending' })
  })
})
