import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/modules/rides/rides.repository', () => ({
  getActiveSession: vi.fn(), createSession: vi.fn(), upsertDriverLocation: vi.fn(),
  endSession: vi.fn(), setDriverAvailability: vi.fn(),
}))
vi.mock('@/modules/drivers/driver-verification.repository', () => ({ getTodayStatus: vi.fn() }))
vi.mock('@/modules/drivers/drivers.repository', () => ({ hasApprovedRequiredDocs: vi.fn(() => Promise.resolve(true)) }))
vi.mock('@/modules/payments/payments.service', () => ({
  getDriverWallet: vi.fn(), getMinWalletBalance: vi.fn(), createPaymentRecord: vi.fn(), deductCommission: vi.fn(),
  creditCashback: vi.fn(), confirmRidePayment: vi.fn(), payFromUserWallet: vi.fn(), createRidePaymentOrder: vi.fn(),
}))
vi.mock('@/websocket/socket.server', () => ({
  socketEvents: { sendAdminDriverUpdate: vi.fn(), sendRideStatusUpdate: vi.fn() },
  getIO: vi.fn(() => ({ to: vi.fn(() => ({ emit: vi.fn() })) })),
}))
vi.mock('@/jobs/queues', () => ({
  queues: { notifications: { add: vi.fn() }, dispatch: { add: vi.fn() } },
  QUEUE_NAMES: { NOTIFICATIONS: 'notifications', DISPATCH: 'dispatch' },
}))
vi.mock('@/db/redis', () => ({ client: { get: vi.fn(), set: vi.fn(), del: vi.fn() } }))
vi.mock('@/lib/system-config', () => ({ getConfigValue: vi.fn().mockResolvedValue('1') }))
vi.mock('@/db/client', () => ({ pool: { query: vi.fn() } }))

import * as repo from '@/modules/rides/rides.repository'
import { getTodayStatus } from '@/modules/drivers/driver-verification.repository'
import { getDriverWallet, getMinWalletBalance } from '@/modules/payments/payments.service'
import { pool } from '@/db/client'
import { goOnline } from '@/modules/rides/rides.service'

const PARAMS = () => ({ mode: 'standard' as const, vehicleId: BigInt(1), categoryId: BigInt(2), lat: 20.29, lng: 85.82 })

// pool.query answers: 1st = driver's city (billing mode), 2nd = owned-vehicle lookup
function scriptQueries(vehicleRows: Array<{ category_id: string | null }>) {
  vi.mocked(pool.query)
    .mockResolvedValueOnce({ rows: [{ billing_mode: 'commission' }] } as never)
    .mockResolvedValueOnce({ rows: vehicleRows } as never)
}

describe('goOnline - the vehicle must be the driver\'s own', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(pool.query).mockReset()
    vi.mocked(getTodayStatus).mockResolvedValue({ selfieDone: true, plateDone: true } as never)
    vi.mocked(getMinWalletBalance).mockResolvedValue(500)
    vi.mocked(getDriverWallet).mockResolvedValue({ balance: '900.00' } as never)
    vi.mocked(repo.getActiveSession).mockResolvedValue(null)
    vi.mocked(repo.createSession).mockResolvedValue({ id: 9 } as never)
    vi.mocked(repo.upsertDriverLocation).mockResolvedValue({ owned: true, ended: false })
  })

  it('refuses a vehicle that is not on the account (or is blacklisted) with 422 and creates no session', async () => {
    scriptQueries([])
    await expect(goOnline(BigInt(42), PARAMS())).rejects.toMatchObject({ httpStatus: 422, appCode: 'VEHICLE_NOT_ELIGIBLE' })
    expect(repo.createSession).not.toHaveBeenCalled()
  })

  it('takes the session category from the vehicle, ignoring a higher category claimed by the client', async () => {
    scriptQueries([{ category_id: '1' }])
    await goOnline(BigInt(42), PARAMS()) // client claims category 2
    expect(repo.createSession).toHaveBeenCalledWith(expect.objectContaining({ categoryId: BigInt(1) }))
  })

  it('a vehicle with NO category (the column is nullable) is rejected - it must not be allowed to claim any class', async () => {
    scriptQueries([{ category_id: null }])
    await expect(goOnline(BigInt(42), PARAMS())).rejects.toMatchObject({ httpStatus: 422, appCode: 'VEHICLE_NOT_ELIGIBLE' })
    expect(repo.createSession).not.toHaveBeenCalled()
  })

  it('the ownership lookup is scoped by BOTH vehicle id and driver id', async () => {
    scriptQueries([{ category_id: '2' }])
    await goOnline(BigInt(42), PARAMS())
    const call = vi.mocked(pool.query).mock.calls[1]!
    expect(call[0]).toContain('driver_vehicles')
    expect(call[0]).toContain('driver_id = $2')
    expect(call[1]).toEqual([BigInt(1), BigInt(42)])
  })
})
