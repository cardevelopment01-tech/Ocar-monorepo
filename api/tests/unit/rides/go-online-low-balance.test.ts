import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks must be declared before any imports that trigger the module graph ───

vi.mock('@/modules/rides/rides.repository', () => ({
  getActiveSession:    vi.fn(),
  createSession:       vi.fn(),
  upsertDriverLocation: vi.fn(),
  endSession:          vi.fn(),
  setDriverAvailability: vi.fn(),
}))

vi.mock('@/modules/drivers/driver-verification.repository', () => ({
  getTodayStatus: vi.fn(),
}))

vi.mock('@/modules/payments/payments.service', () => ({
  getDriverWallet:     vi.fn(),
  getMinWalletBalance: vi.fn(),
  createPaymentRecord: vi.fn(),
  deductCommission:    vi.fn(),
  creditCashback:      vi.fn(),
  confirmRidePayment:  vi.fn(),
  payFromUserWallet:   vi.fn(),
  createRidePaymentOrder: vi.fn(),
}))

vi.mock('@/modules/notifications/notifications.service', () => ({
  notifyRidePaymentFailed: vi.fn(),
}))

vi.mock('@/websocket/socket.server', () => ({
  socketEvents: { sendAdminDriverUpdate: vi.fn() },
}))

vi.mock('@/db/client', () => ({
  pool: { query: vi.fn() },
}))

// ── Import after mocks ─────────────────────────────────────────────────────────

import * as repo from '@/modules/rides/rides.repository'
import { getTodayStatus } from '@/modules/drivers/driver-verification.repository'
import { getDriverWallet, getMinWalletBalance } from '@/modules/payments/payments.service'
import { pool } from '@/db/client'
import { goOnline } from '@/modules/rides/rides.service'

const DRIVER_ID = BigInt(42)
const BASE_PARAMS = {
  mode: 'standard' as const,
  vehicleId: BigInt(1),
  categoryId: BigInt(2),
  lat: 20.29,
  lng: 85.82,
}

describe('goOnline — wallet balance gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getTodayStatus).mockResolvedValue({ selfieDone: true, plateDone: true } as never)
    vi.mocked(getMinWalletBalance).mockResolvedValue(500)
    vi.mocked(repo.getActiveSession).mockResolvedValue(null)
    vi.mocked(repo.createSession).mockResolvedValue({ id: 9 } as never)
    vi.mocked(repo.upsertDriverLocation).mockResolvedValue(undefined as never)
    // nearest-city billing-mode lookup — these tests assert commission-mode gate behavior
    vi.mocked(pool.query).mockResolvedValue({ rows: [{ billing_mode: 'commission' }] } as never)
  })

  it('balance below minimum → throws LOW_WALLET_BALANCE (402), no session created', async () => {
    vi.mocked(getDriverWallet).mockResolvedValue({ balance: '400.00' } as never)

    await expect(goOnline(DRIVER_ID, BASE_PARAMS)).rejects.toMatchObject({
      httpStatus: 402,
      appCode: 'LOW_WALLET_BALANCE',
    })
    expect(repo.createSession).not.toHaveBeenCalled()
  })

  it('no wallet row at all → treated as balance 0, blocked', async () => {
    vi.mocked(getDriverWallet).mockResolvedValue(null)

    await expect(goOnline(DRIVER_ID, BASE_PARAMS)).rejects.toMatchObject({
      appCode: 'LOW_WALLET_BALANCE',
    })
  })

  it('balance at or above minimum → session created', async () => {
    vi.mocked(getDriverWallet).mockResolvedValue({ balance: '500.00' } as never)

    const session = await goOnline(DRIVER_ID, BASE_PARAMS)
    expect(session).toEqual({ id: 9 })
    expect(repo.createSession).toHaveBeenCalledOnce()
  })

  it('wallet frozen, even with sufficient balance → throws WALLET_FROZEN (403), no session created', async () => {
    vi.mocked(getDriverWallet).mockResolvedValue({ balance: '900.00', is_frozen: true } as never)

    await expect(goOnline(DRIVER_ID, BASE_PARAMS)).rejects.toMatchObject({
      httpStatus: 403,
      appCode: 'WALLET_FROZEN',
    })
    expect(repo.createSession).not.toHaveBeenCalled()
  })

  it('reconnecting with an existing session deactivates its return_cab_routes, not just ends it', async () => {
    vi.mocked(getDriverWallet).mockResolvedValue({ balance: '500.00' } as never)
    vi.mocked(repo.getActiveSession).mockResolvedValue({ id: 7, status: 'online' } as never)

    await goOnline(DRIVER_ID, BASE_PARAMS)

    expect(repo.endSession).toHaveBeenCalledWith(BigInt(7), 'reconnected')
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE return_cab_routes'),
      [BigInt(7)]
    )
  })
})
