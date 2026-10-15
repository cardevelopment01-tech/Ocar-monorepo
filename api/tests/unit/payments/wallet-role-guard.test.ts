import { describe, it, expect, vi } from 'vitest'
import express from 'express'
import request from 'supertest'

vi.mock('@/config', () => ({
  config: { USER_APP_URL: 'https://app.example', DRIVER_APP_URL: 'https://driver.example', PAYU_KEY: 'k', PAYU_SALT: 's', NODE_ENV: 'test' },
}))
vi.mock('@/db/client', () => ({ pool: { query: vi.fn() } }))
vi.mock('@/db/redis', () => ({ client: { get: vi.fn(), set: vi.fn(), del: vi.fn() } }))
// A fake authenticate that sets only the principal the test header asks for, like the real one does.
vi.mock('@/middleware/auth.middleware', () => ({
  authenticate: () => (req: { headers: Record<string, string>; user?: unknown; driver?: unknown }, _r: unknown, n: () => void) => {
    if (req.headers['x-role'] === 'user') req.user = { id: 1n, status: 'active' }
    if (req.headers['x-role'] === 'driver') req.driver = { id: 2n, status: 'active' }
    n()
  },
}))
vi.mock('@/middleware/rateLimit.middleware', () => ({
  payuHashLimiter: (_q: unknown, _r: unknown, n: () => void) => n(),
  payuConfirmLimiter: (_q: unknown, _r: unknown, n: () => void) => n(),
}))
vi.mock('@/lib/logger', () => ({ logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) } }))
vi.mock('@/lib/payu', () => ({ payuConfigured: () => true }))
const m = vi.hoisted(() => ({ driverWallet: vi.fn(), userWallet: vi.fn(), minBalance: vi.fn() }))
vi.mock('@/modules/payments/payments.service', () => ({ getDriverWallet: m.driverWallet, getUserWallet: m.userWallet, getMinWalletBalance: m.minBalance }))
vi.mock('@/modules/packages/packages.service', () => ({}))
vi.mock('@/modules/packages/packages.repository', () => ({ listTiers: vi.fn(), getDriverPackageWallet: vi.fn() }))
vi.mock('@/modules/payments/payu-sdk', () => ({}))

import router from '@/modules/payments/payments.routes'
import { errorMiddleware } from '@/middleware/error.middleware'

const app = express()
app.use(express.json())
app.use('/p', router)
app.use(errorMiddleware)

describe('wallet and package routes refuse a token of the wrong role', () => {
  it('rider token on the driver wallet is refused, not a 500', async () => {
    const res = await request(app).get('/p/wallet/driver').set('x-role', 'user')
    expect(res.status).toBe(401)
    expect(m.driverWallet).not.toHaveBeenCalled()
  })
  it('driver token on the rider wallet is refused, not a 500', async () => {
    const res = await request(app).get('/p/wallet/user').set('x-role', 'driver')
    expect(res.status).toBe(401)
    expect(m.userWallet).not.toHaveBeenCalled()
  })
  it.each([
    ['get', '/p/packages/tiers'],
    ['get', '/p/packages/wallet'],
    ['post', '/p/packages/purchase/order'],
    ['post', '/p/wallet/driver/topup/order'],
    ['post', '/p/wallet/driver/topup/verify'],
  ] as const)('rider token on %s %s is refused', async (method, path) => {
    const res = await request(app)[method](path).set('x-role', 'user').send({})
    expect(res.status).toBe(401)
  })
  it('the right role still gets through', async () => {
    m.driverWallet.mockResolvedValue({ balance: '5.00', recent_ledger: [] })
    m.userWallet.mockResolvedValue({ balance: '7.00', recent_ledger: [] })
    m.minBalance.mockResolvedValue(500)
    const dw = await request(app).get('/p/wallet/driver').set('x-role', 'driver')
    expect(dw.status).toBe(200)
    expect(dw.body.min_balance).toBe(500) // the app reads its go-online minimum from here
    expect((await request(app).get('/p/wallet/user').set('x-role', 'user')).status).toBe(200)
  })
})
