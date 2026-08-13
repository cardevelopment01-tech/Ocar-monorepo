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
const RETURN_CAB_PARAMS = {
  mode: 'return_cab' as const,
  vehicleId: BigInt(1),
  categoryId: BigInt(2),
  lat: 20.29,
  lng: 85.82,
  destinationCityId: BigInt(3),
}

describe('goOnline — return_cab destination_city_id persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getTodayStatus).mockResolvedValue({ selfieDone: true, plateDone: true } as never)
    vi.mocked(getMinWalletBalance).mockResolvedValue(500)
    vi.mocked(getDriverWallet).mockResolvedValue({ balance: '500.00' } as never)
    vi.mocked(repo.getActiveSession).mockResolvedValue(null)
    vi.mocked(repo.createSession).mockResolvedValue({ id: 9 } as never)
    vi.mocked(repo.upsertDriverLocation).mockResolvedValue(undefined as never)
    vi.mocked(pool.query)
      .mockResolvedValueOnce({ rows: [{ billing_mode: 'commission' }] } as never) // nearest-city billing lookup
      .mockResolvedValueOnce({ rows: [{ dest_lat: 19.81, dest_lng: 85.83 }] } as never) // destination centroid lookup
  })

  it('inserts destination_city_id into return_cab_routes', async () => {
    await goOnline(DRIVER_ID, RETURN_CAB_PARAMS)

    const insertCall = vi.mocked(pool.query).mock.calls.find(call =>
      typeof call[0] === 'string' && call[0].includes('INSERT INTO return_cab_routes')
    )

    expect(insertCall).toBeDefined()
    expect(insertCall![0]).toContain('INSERT INTO return_cab_routes')
    expect(insertCall![0]).toContain('destination_city_id')
    expect(insertCall![1]).toEqual([
      9, DRIVER_ID, BigInt(3),
      RETURN_CAB_PARAMS.lat, RETURN_CAB_PARAMS.lng,
      19.81, 85.83,
    ])
  })
})
