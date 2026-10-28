import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db/client', () => ({ pool: { query: vi.fn() } }))
const { redisMock } = vi.hoisted(() => ({
  redisMock: { del: vi.fn(), mget: vi.fn(), set: vi.fn() },
}))
vi.mock('@/db/redis', () => ({ client: redisMock }))
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
  notifyRideEvent: vi.fn(), notifyRidePaymentFailed: vi.fn(), notifyAllAdmins: vi.fn(), notifyDriverLowWalletBalance: vi.fn(),
}))

import { pool } from '@/db/client'
import * as repo from '@/modules/rides/rides.repository'
import { settleStrandedRideCompletions } from '@/modules/rides/rides.service'

describe('settleStrandedRideCompletions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    redisMock.mget.mockImplementation(async (...keys: string[]) => keys.map(() => null))
    redisMock.set.mockResolvedValue('OK')
  })

  it('only looks at completed online/wallet rides with no payment row (cash is excluded on purpose)', async () => {
    vi.mocked(pool.query).mockResolvedValue({ rows: [], rowCount: 0 } as never)
    await settleStrandedRideCompletions()
    const sql = vi.mocked(pool.query).mock.calls[0]![0] as string
    expect(sql).toContain("r.status = 'completed'")
    expect(sql).toContain("r.payment_channel IN ('online', 'wallet')")
    expect(sql).toContain('NOT EXISTS (SELECT 1 FROM payments p WHERE p.ride_id = r.id)')
  })

  it('picks candidates in RANDOM order, not oldest-first (permanently failing rides must not starve newer ones)', async () => {
    vi.mocked(pool.query).mockResolvedValue({ rows: [], rowCount: 0 } as never)
    await settleStrandedRideCompletions()
    const sql = vi.mocked(pool.query).mock.calls[0]![0] as string
    expect(sql).toContain('ORDER BY random()')
    expect(sql).not.toMatch(/ORDER BY r\.completed_at/)
  })

  it('scans only the last 6 hours on a normal tick and the full 3 days once an hour (minutes 0-4)', async () => {
    vi.mocked(pool.query).mockResolvedValue({ rows: [], rowCount: 0 } as never)
    await settleStrandedRideCompletions(new Date('2026-10-28T10:20:00Z'))
    await settleStrandedRideCompletions(new Date('2026-10-28T10:02:00Z'))
    await settleStrandedRideCompletions(new Date('2026-10-28T10:05:00Z'))
    const sqls = vi.mocked(pool.query).mock.calls.map(c => c[0] as string)
    expect(sqls[0]).toContain("now() - interval '6 hours'")
    expect(sqls[1]).toContain("now() - interval '3 days'")
    expect(sqls[2]).toContain("now() - interval '6 hours'")
  })

  it('puts a ride that fails on a 30-minute cooldown so it is not retried every tick', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ id: '11', driver_id: '9' }], rowCount: 1 } as never)
    vi.mocked(repo.getRideCoreById).mockRejectedValueOnce(new Error('missing fare snapshot'))

    await settleStrandedRideCompletions()

    expect(redisMock.set).toHaveBeenCalledWith('stranded-settle:cooldown:11', '1', 'EX', 30 * 60)
  })

  it('skips rides that are cooling down and spends its attempts on others', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({
      rows: [{ id: '11', driver_id: '9' }, { id: '12', driver_id: '9' }], rowCount: 2,
    } as never)
    redisMock.mget.mockImplementation(async (...keys: string[]) => keys.map(k => (k.endsWith(':11') ? '1' : null)))
    vi.mocked(repo.getRideCoreById).mockResolvedValue({ id: 12n, payment_channel: 'wallet', user_id: 42 } as never)
    vi.mocked(pool.query).mockResolvedValue({ rows: [{ amount: '0' }], rowCount: 1 } as never)

    const settled = await settleStrandedRideCompletions()

    expect(settled).toBe(1)
    expect(createPaymentRecord).toHaveBeenCalledTimes(1)
    expect(createPaymentRecord).toHaveBeenCalledWith(12n, 'platform_wallet', { status: 'pending' })
  })

  it('reads every cooldown flag in ONE Redis round trip, not one call per candidate', async () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({ id: String(200 + i), driver_id: '9' }))
    vi.mocked(pool.query).mockResolvedValueOnce({ rows, rowCount: 40 } as never)
    vi.mocked(repo.getRideCoreById).mockRejectedValue(new Error('boom'))
    await settleStrandedRideCompletions()
    expect(redisMock.mget).toHaveBeenCalledTimes(1)
    expect(redisMock.mget.mock.calls[0]).toHaveLength(40)
  })

  it('cools down a ride whose settlement returns WITHOUT throwing (it would otherwise be re-run every tick)', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ id: '31', driver_id: '9' }], rowCount: 1 } as never)
    vi.mocked(repo.getRideCoreById).mockResolvedValue({ id: 31n, payment_channel: 'wallet', user_id: null } as never) // no user -> returns early, no payment row
    vi.mocked(pool.query).mockResolvedValue({ rows: [{ amount: '0' }], rowCount: 1 } as never)
    await settleStrandedRideCompletions()
    expect(redisMock.set).toHaveBeenCalledWith('stranded-settle:cooldown:31', '1', 'EX', 30 * 60)
  })

  it('a Redis outage on the cooldown read does not stop the sweep (nothing is treated as cooling)', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ id: '41', driver_id: '9' }], rowCount: 1 } as never)
    redisMock.mget.mockRejectedValueOnce(new Error('redis down'))
    vi.mocked(repo.getRideCoreById).mockResolvedValue({ id: 41n, payment_channel: 'wallet', user_id: 42 } as never)
    vi.mocked(pool.query).mockResolvedValue({ rows: [{ amount: '0' }], rowCount: 1 } as never)
    expect(await settleStrandedRideCompletions()).toBe(1)
  })

  it('attempts at most 25 rides per tick even when more candidates come back', async () => {
    const rows = Array.from({ length: 60 }, (_, i) => ({ id: String(100 + i), driver_id: '9' }))
    vi.mocked(pool.query).mockResolvedValueOnce({ rows, rowCount: 60 } as never)
    vi.mocked(repo.getRideCoreById).mockRejectedValue(new Error('boom')) // every attempt fails
    await settleStrandedRideCompletions()
    expect(vi.mocked(repo.getRideCoreById).mock.calls.length).toBeLessThanOrEqual(25)
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
