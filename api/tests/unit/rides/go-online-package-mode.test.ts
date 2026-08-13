import { describe, it, expect, vi, beforeEach } from 'vitest'

const poolQuery = vi.fn()
vi.mock('@/db/client', () => ({
  pool: { query: (...args: unknown[]) => poolQuery(...args) },
}))
vi.mock('@/modules/drivers/driver-verification.repository', () => ({
  getTodayStatus: vi.fn(() => Promise.resolve({ selfieDone: true, plateDone: true })),
}))
vi.mock('@/websocket/socket.server', () => ({ socketEvents: { sendAdminDriverUpdate: vi.fn() } }))
vi.mock('@/modules/rides/rides.repository', () => ({
  getActiveSession: vi.fn(() => Promise.resolve(null)),
  createSession: vi.fn(() => Promise.resolve({ id: '1' })),
  upsertDriverLocation: vi.fn(() => Promise.resolve()),
  setDriverAvailability: vi.fn(() => Promise.resolve()),
}))
const getMinWalletBalance = vi.fn(() => Promise.resolve(500))
const getDriverWallet = vi.fn(() => Promise.resolve({ balance: '0', is_frozen: false }))
vi.mock('@/modules/payments/payments.service', () => ({
  getMinWalletBalance: (...a: unknown[]) => getMinWalletBalance(...a),
  getDriverWallet: (...a: unknown[]) => getDriverWallet(...a),
}))

import { goOnline } from '@/modules/rides/rides.service'

describe('goOnline — package-mode city skips wallet-balance gate', () => {
  beforeEach(() => vi.clearAllMocks())

  it('allows a zero-balance driver online when nearest city is package-mode', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [{ billing_mode: 'package' }] }) // nearest-city lookup

    await expect(goOnline(BigInt(1), {
      mode: 'standard', vehicleId: BigInt(1), categoryId: BigInt(1), lat: 20.29, lng: 85.82,
    })).resolves.toBeDefined()
  })

  it('still blocks a zero-balance driver in a commission-mode city', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [{ billing_mode: 'commission' }] })

    await expect(goOnline(BigInt(1), {
      mode: 'standard', vehicleId: BigInt(1), categoryId: BigInt(1), lat: 20.29, lng: 85.82,
    })).rejects.toThrow()
  })
})
