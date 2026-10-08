import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

vi.mock('@/config', () => ({
  config: { USER_APP_URL: 'https://app.example', DRIVER_APP_URL: 'https://driver.example', PAYU_KEY: 'k', PAYU_SALT: 's', NODE_ENV: 'test' },
}))
vi.mock('@/db/client', () => ({ pool: { query: vi.fn() } }))
vi.mock('@/db/redis', () => ({ client: { get: vi.fn(), set: vi.fn(), del: vi.fn() } }))
vi.mock('@/middleware/auth.middleware', () => ({
  authenticate: () => (req: { driver?: { id: bigint } }, _r: unknown, n: () => void) => { req.driver = { id: 7n }; n() },
}))
vi.mock('@/middleware/role.middleware', () => ({ requireDriver: () => (_q: unknown, _r: unknown, n: () => void) => n() }))
vi.mock('@/middleware/rateLimit.middleware', () => ({
  payuHashLimiter: (_q: unknown, _r: unknown, n: () => void) => n(),
  payuConfirmLimiter: (_q: unknown, _r: unknown, n: () => void) => n(),
}))
vi.mock('@/lib/logger', () => ({ logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) } }))
vi.mock('@/lib/payu', () => ({ payuConfigured: () => true }))
const m = vi.hoisted(() => ({
  handle: vi.fn(), topup: vi.fn(), pkg: vi.fn(), enabled: vi.fn(), sign: vi.fn(), confirm: vi.fn(),
}))
vi.mock('@/modules/payments/payments.service', () => ({ handlePayuNotification: m.handle, createDriverTopupOrder: m.topup }))
vi.mock('@/modules/packages/packages.service', () => ({ createPackagePurchaseOrder: m.pkg }))
vi.mock('@/modules/packages/packages.repository', () => ({}))
vi.mock('@/modules/payments/payu-sdk', () => ({
  assertMobilePaymentsEnabled: m.enabled,
  withSdkParams: (o: object) => ({ ...o, sdk: { transactionId: 'W7x' } }),
  signSdkHash: m.sign,
  confirmSdkPayment: m.confirm,
}))

import router from '@/modules/payments/payments.routes'
import { errorMiddleware } from '@/middleware/error.middleware'

const app = express()
app.use(express.urlencoded({ extended: true }))
app.use(express.json())
app.use('/api/v1/payments', router)
app.use(errorMiddleware)

const P = '/api/v1/payments'
const forbidden = () => Object.assign(new Error('In-app payments are not available right now'), { httpStatus: 403 })

beforeEach(() => { Object.values(m).forEach((f) => f.mockReset()) })

describe('order endpoints with client:"sdk"', () => {
  it('top-up: gated by the flag, SDK params added', async () => {
    m.topup.mockResolvedValue({ payu: { action: 'a', fields: {} }, amount: 500 })
    const res = await request(app).post(`${P}/wallet/driver/topup/order`).send({ amount: 500, client: 'sdk' })
    expect(m.enabled).toHaveBeenCalled()
    expect(m.topup).toHaveBeenCalledWith(7n, 500)
    expect(res.body.sdk).toEqual({ transactionId: 'W7x' })
  })
  it('top-up: flag off -> 403 and no order is created', async () => {
    m.enabled.mockRejectedValue(forbidden())
    const res = await request(app).post(`${P}/wallet/driver/topup/order`).send({ amount: 500, client: 'sdk' })
    expect(res.status).toBe(403)
    expect(m.topup).not.toHaveBeenCalled()
  })
  it('top-up without client behaves exactly as before (web form only, no flag check)', async () => {
    m.topup.mockResolvedValue({ payu: { action: 'a', fields: {} }, amount: 500 })
    const res = await request(app).post(`${P}/wallet/driver/topup/order`).send({ amount: 500 })
    expect(m.enabled).not.toHaveBeenCalled()
    expect(m.topup).toHaveBeenCalledWith(7n, 500)
    expect(res.body).not.toHaveProperty('sdk')
  })
  it('package: sdk order gated and flagged; dev credit passes through untouched', async () => {
    m.pkg.mockResolvedValue({ payu: { action: 'a', fields: {} }, amount: 999 })
    let res = await request(app).post(`${P}/packages/purchase/order`).send({ tierId: 3, client: 'sdk' })
    expect(m.pkg).toHaveBeenCalledWith(7n, 3n)
    expect(res.body.sdk).toEqual({ transactionId: 'W7x' })
    m.pkg.mockResolvedValue({ dev: true, credited: 1000 })
    res = await request(app).post(`${P}/packages/purchase/order`).send({ tierId: 3, client: 'sdk' })
    expect(res.body).toEqual({ dev: true, credited: 1000 })
  })
})

describe('POST /payu/sdk-hash and /payu/confirm', () => {
  it('sdk-hash returns the signature for the authenticated driver', async () => {
    m.sign.mockResolvedValue('abc123')
    const res = await request(app).post(`${P}/payu/sdk-hash`).send({ hashName: 'payment_source', hashString: 'k|W7x|1' })
    expect(res.body).toEqual({ hash: 'abc123' })
    expect(m.sign).toHaveBeenCalledWith(7n, 'payment_source', 'k|W7x|1')
  })
  it('sdk-hash is refused when the kill switch is off and signs nothing', async () => {
    m.enabled.mockRejectedValue(forbidden())
    const res = await request(app).post(`${P}/payu/sdk-hash`).send({ hashName: 'payment_source', hashString: 'x' })
    expect(res.status).toBe(403)
    expect(m.sign).not.toHaveBeenCalled()
  })
  it('sdk-hash surfaces validation failures as 400', async () => {
    m.sign.mockRejectedValue(Object.assign(new Error('Invalid hash request'), { httpStatus: 400 }))
    const res = await request(app).post(`${P}/payu/sdk-hash`).send({ hashName: 'verify_payment', hashString: 'x' })
    expect(res.status).toBe(400)
  })
  it('confirm works even when the kill switch is off (recovery must never be blocked)', async () => {
    m.enabled.mockRejectedValue(forbidden())
    m.confirm.mockResolvedValue({ result: 'success' })
    const res = await request(app).post(`${P}/payu/confirm`).send({ txnId: 'W7x' })
    expect(res.body).toEqual({ result: 'success' })
    expect(m.confirm).toHaveBeenCalledWith(7n, 'W7x')
  })
})
